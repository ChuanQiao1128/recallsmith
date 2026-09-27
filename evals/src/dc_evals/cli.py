"""dc-evals command line: seed, run (paid, owner only) and score."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import uuid
from pathlib import Path

from .dataset import SEEDED_PATH, load_dataset
from .report import build_report, file_stem, read_run, run_header, write_run_files
from .score import gate_passes

DRY_RUN_INPUT_TOKENS = 3000
DRY_RUN_OUTPUT_TOKENS = 1500


def _review_date(text: str) -> str:
    try:
        return dt.date.fromisoformat(text).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dc-evals", description="Seeded-defect eval harness for the AI QA gate.")
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed", help="regenerate data/seeded-v1.jsonl from the exported decks")
    seed.add_argument("--check", action="store_true", help="exit 1 if the file differs from a fresh build")
    seed.add_argument("--output", type=Path, default=SEEDED_PATH, help=argparse.SUPPRESS)

    run = sub.add_parser("run", help="review the dataset with the real model (spends money; owner only)")
    run.add_argument(
        "--provider",
        required=True,
        choices=("bedrock", "anthropic", "claude-cli"),
        help="claude-cli = the owner's local Claude Code CLI (their subscription, this machine only)",
    )
    run.add_argument("--model", required=True)
    run.add_argument("--limit", type=int, default=None, help="review only the first N rows")
    run.add_argument("--concurrency", type=int, default=4)
    run.add_argument("--max-cost-usd", type=float, default=30.0)
    run.add_argument("--review-date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    run.add_argument("--dry-run", action="store_true", help="print row count and cost estimate; no client")
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--dataset", type=Path, default=SEEDED_PATH, help=argparse.SUPPRESS)

    score = sub.add_parser("score", help="print the report JSON for a run file")
    score.add_argument("run_file", type=Path)
    score.add_argument("--gate", action="store_true", help="exit 1 unless recall and precision pass")
    return parser


def _seed(args: argparse.Namespace) -> int:
    from .seed import seed

    return seed(args.output, check=args.check)


def _run(args: argparse.Namespace) -> int:
    from ai_qa.prompts import PROMPT_VERSION
    from ai_qa.providers import make_client
    from ai_qa.settings import ConfigError, load_settings

    local_cli = args.provider == "claude-cli"
    env = {**os.environ, "AI_PROVIDER": "anthropic" if local_cli else args.provider, "AI_MODEL": args.model}
    if local_cli:
        env["AI_STRUCTURED_OUTPUTS"] = "off"  # the Bedrock path: validated plain JSON + one repair turn
    provider_label = args.provider
    try:
        settings = load_settings(env)
    except ConfigError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    rows = load_dataset(args.dataset)
    if args.limit is not None:
        rows = rows[: max(args.limit, 0)]

    if args.dry_run:
        estimate = (
            len(rows)
            * (
                DRY_RUN_INPUT_TOKENS * settings.price_input_per_mtok
                + DRY_RUN_OUTPUT_TOKENS * settings.price_output_per_mtok
            )
            / 1_000_000
        )
        print(f"rows: {len(rows)}")
        print(
            f"estimated cost: ${estimate:.2f} ({DRY_RUN_INPUT_TOKENS} input + {DRY_RUN_OUTPUT_TOKENS} output "
            f"tokens per row at ${settings.price_input_per_mtok}/${settings.price_output_per_mtok} per MTok; "
            f"ceiling ${args.max_cost_usd:.2f})"
        )
        return 0

    from .runner import run_eval

    try:
        if local_cli:
            from .claude_cli import ClaudeCliClient

            client = ClaudeCliClient(settings.model)
        else:
            client = make_client(settings, api_key=os.environ.get("ANTHROPIC_API_KEY"))
    except ConfigError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    started = dt.datetime.now(dt.UTC)
    review_date = args.review_date or started.date().isoformat()
    records = run_eval(
        rows,
        client=client,
        settings=settings,
        review_date=review_date,
        concurrency=args.concurrency,
        max_cost_usd=args.max_cost_usd,
    )
    header = run_header(
        run_id=str(uuid.uuid4()),
        started_at=started.isoformat().replace("+00:00", "Z"),
        provider=provider_label,
        model=settings.model,
        prompt_version=PROMPT_VERSION,
        n=len(records),
    )
    stem = file_stem(started.date().isoformat(), provider_label, settings.model, PROMPT_VERSION)
    paths = write_run_files(args.out, stem, header, records)
    if len(records) < len(rows):
        print(f"stopped at the ${args.max_cost_usd:.2f} cost ceiling after {len(records)} of {len(rows)} rows")
    for path in paths:
        print(path)
    return 0


def _score(args: argparse.Namespace) -> int:
    header, records = read_run(args.run_file)
    report = build_report(header, records)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.gate and not gate_passes(report):
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    handlers = {"seed": _seed, "run": _run, "score": _score}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

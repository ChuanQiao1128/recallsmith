"""dc-evals command line: seed, run (paid, owner only) and score."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import uuid
from pathlib import Path

from .dataset import DATASETS, file_sha256, load_dataset
from .report import build_report, file_stem, read_run, run_header, write_run_files
from .score import gate_failures

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

    seed = sub.add_parser("seed", help="regenerate data/seeded-<version>.jsonl from the exported decks")
    seed.add_argument("--dataset", choices=sorted(DATASETS), default="v1", help="dataset version (default v1)")
    seed.add_argument("--check", action="store_true", help="exit 1 if the file differs from a fresh build")
    seed.add_argument("--output", type=Path, default=None, help=argparse.SUPPRESS)

    sources = sub.add_parser("export-sources", help="regenerate data/sources-<deck>.jsonl from the deck ledgers")
    sources.add_argument("--check", action="store_true", help="exit 1 if a file differs from a fresh export")

    run = sub.add_parser("run", help="review the dataset with the real model (spends money; owner only)")
    run.add_argument(
        "--provider",
        required=True,
        choices=("bedrock", "anthropic", "claude-cli"),
        help="claude-cli = the owner's local Claude Code CLI (their subscription, this machine only)",
    )
    run.add_argument("--model", required=True)
    run.add_argument("--limit", type=int, default=None, help="review only the first N rows (never gate evidence)")
    run.add_argument(
        "--reps", type=int, default=2, help="review the dataset N times (default 2, the gate's minimum)"
    )
    run.add_argument("--concurrency", type=int, default=4)
    run.add_argument("--max-cost-usd", type=float, default=30.0)
    run.add_argument("--review-date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    run.add_argument("--dry-run", action="store_true", help="print row count and cost estimate; no client")
    run.add_argument("--out", required=True, type=Path)
    run.add_argument("--dataset", choices=sorted(DATASETS), default="v3", help="dataset version (default v3)")

    score = sub.add_parser("score", help="print the report JSON for a run file")
    score.add_argument("run_file", type=Path)
    score.add_argument("--gate", action="store_true", help="exit 1 unless every rollout gate condition passes")
    return parser


def _seed(args: argparse.Namespace) -> int:
    from .seed import seed

    spec = DATASETS[args.dataset]
    return seed(args.output or spec.path, check=args.check, dataset=spec)


def _export_sources(args: argparse.Namespace) -> int:
    from .sources import export_sources

    return export_sources(check=args.check)


def _run(args: argparse.Namespace) -> int:
    from ai_qa.prompts import PROMPT_VERSION
    from ai_qa.providers import make_client, structured_outputs_on
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
    if args.reps < 1:
        print("dc-evals: --reps must be at least 1", file=sys.stderr)
        return 2
    spec = DATASETS[args.dataset]
    rows = load_dataset(spec.path)
    dataset_rows = len(rows)
    if args.limit is not None:
        rows = rows[: max(args.limit, 0)]

    if args.dry_run:
        estimate = (
            len(rows)
            * args.reps
            * (
                DRY_RUN_INPUT_TOKENS * settings.price_input_per_mtok
                + DRY_RUN_OUTPUT_TOKENS * settings.price_output_per_mtok
            )
            / 1_000_000
        )
        print(f"rows: {len(rows)}" + (f" x {args.reps} reps" if args.reps > 1 else ""))
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
    structured_at_start = structured_outputs_on(settings)
    records: list[dict] = []
    spent = 0.0
    for rep in range(1, args.reps + 1):
        batch = run_eval(
            rows,
            client=client,
            settings=settings,
            review_date=review_date,
            concurrency=args.concurrency,
            max_cost_usd=args.max_cost_usd - spent,
            rep=rep,
        )
        records += batch
        spent += sum(float(r["estimatedCostUsd"] or 0.0) for r in batch)
        if len(batch) < len(rows):
            break
    header = run_header(
        run_id=str(uuid.uuid4()),
        started_at=started.isoformat().replace("+00:00", "Z"),
        provider=provider_label,
        model=settings.model,
        prompt_version=PROMPT_VERSION,
        n=len(records),
        dataset=spec.name,
        dataset_sha256=file_sha256(spec.path),
        dataset_rows=dataset_rows,
        reps=args.reps,
        review_date=review_date,
        effort=settings.effort,
        structured_outputs=settings.structured_outputs,
        structured_outputs_at_start=structured_at_start,
    )
    stem = file_stem(started.date().isoformat(), provider_label, settings.model, PROMPT_VERSION)
    paths = write_run_files(args.out, stem, header, records)
    if len(records) < len(rows) * args.reps:
        print(
            f"stopped at the ${args.max_cost_usd:.2f} cost ceiling after {len(records)} of "
            f"{len(rows) * args.reps} items; the gate refuses this partial run"
        )
    for path in paths:
        print(path)
    return 0


def _score(args: argparse.Namespace) -> int:
    header, records = read_run(args.run_file)
    report = build_report(header, records)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.gate:
        failures = gate_failures(report)
        for reason in failures:
            print(f"gate: {reason}", file=sys.stderr)
        if failures:
            return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    handlers = {"seed": _seed, "export-sources": _export_sources, "run": _run, "score": _score}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

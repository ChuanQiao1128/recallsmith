"""dc-evals command line: seed, run (paid, owner only), score, and (Q03) author, jury and compare."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import uuid
from pathlib import Path

from ai_qa.settings import SECOND_MODEL_ENV, SECOND_PROVIDER_ENV, SECOND_SCOPE_ENV

from .author import DEFAULT_AUTHOR_MODEL
from .dataset import (
    AUTHORED,
    AUTHORED_SOURCES_PATH,
    AUTHORED_V2,
    AUTHORED_V2_SOURCES_PATH,
    DATASETS,
    REPORTS_DIR,
    RUN_DATASETS,
    load_rows,
    spec_sha256,
)
from .jury import DEFAULT_JURORS, JUROR_PROVIDERS
from .report import build_report, file_stem, read_run, run_header, write_run_files
from .score import SHIPPING_ENV_PATH, gate_failures

# A15: `author` / `jury --dataset` picks the authored set; it only chooses the default paths.
AUTHORED_SPECS = {AUTHORED.name: AUTHORED, AUTHORED_V2.name: AUTHORED_V2}
AUTHORED_SOURCES = {AUTHORED.name: AUTHORED_SOURCES_PATH, AUTHORED_V2.name: AUTHORED_V2_SOURCES_PATH}

# The second reviewer's providers (ai-qa AI_QA_SECOND_PROVIDER); claude-cli is local only.
SECOND_PROVIDERS = ("bedrock-converse", "bedrock", "anthropic")

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
        choices=("bedrock", "anthropic", "bedrock-converse", "claude-cli"),
        help=(
            "claude-cli = the owner's local Claude Code CLI (their subscription, this machine only); "
            "bedrock-converse = a non-Anthropic Bedrock model through the Converse API"
        ),
    )
    run.add_argument("--model", required=True)
    run.add_argument(
        "--second-provider",
        choices=SECOND_PROVIDERS,
        default=None,
        help="the second reviewer (ai-qa AI_QA_SECOND_PROVIDER); off when omitted",
    )
    run.add_argument("--second-model", default=None, help="the second reviewer's model (AI_QA_SECOND_MODEL)")
    run.add_argument(
        "--second-scope", default=None, help="AI_QA_SECOND_SCOPE: facts (default), all or a category list"
    )
    run.add_argument("--limit", type=int, default=None, help="review only the first N rows (never gate evidence)")
    run.add_argument(
        "--reps", type=int, default=2, help="review the dataset N times (default 2, the gate's minimum)"
    )
    run.add_argument("--concurrency", type=int, default=4)
    run.add_argument("--max-cost-usd", type=float, default=30.0)
    run.add_argument("--review-date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    run.add_argument("--dry-run", action="store_true", help="print row count and cost estimate; no client")
    run.add_argument("--out", required=True, type=Path)
    run.add_argument(
        "--dataset",
        choices=sorted(RUN_DATASETS),
        default="v3",
        help="dataset version (default v3); authored-v1 / authored-v2 = the jury-labeled authored cards",
    )

    author = sub.add_parser(
        "author", help="write the agent-authored card set with the local Claude CLI (owner's machine only)"
    )
    author.add_argument(
        "--dataset",
        choices=sorted(AUTHORED_SPECS),
        default=AUTHORED.name,
        help="the authored set whose default --sources and --output to use (default authored-v1)",
    )
    author.add_argument("--sources", type=Path, default=None, help="default data/authored-sources-<v>.json")
    author.add_argument("--model", default=DEFAULT_AUTHOR_MODEL, help=f"default {DEFAULT_AUTHOR_MODEL}")
    author.add_argument("--output", type=Path, default=None, help="default data/<dataset>.jsonl")
    author.add_argument("--limit", type=int, default=None, help="author from only the first N sources")

    jury = sub.add_parser("jury", help="label the authored cards with a jury of models (spends money; owner only)")
    jury.add_argument(
        "--jurors",
        default=DEFAULT_JURORS,
        help=f"comma-separated provider:model list (providers {', '.join(JUROR_PROVIDERS)}); default {DEFAULT_JURORS}",
    )
    jury.add_argument(
        "--dataset",
        choices=sorted(AUTHORED_SPECS),
        default=AUTHORED.name,
        help="the authored set whose default --input and --output to use (default authored-v1)",
    )
    jury.add_argument("--input", type=Path, default=None, help="default data/<dataset>.jsonl")
    jury.add_argument("--output", type=Path, default=None, help="default data/<dataset>.labels.jsonl")
    jury.add_argument("--limit", type=int, default=None, help="label only the first N rows")

    compare = sub.add_parser("compare", help="compare reviewer configurations across run files")
    compare.add_argument("run_files", type=Path, nargs="+")
    compare.add_argument("--name", required=True, help="the report name: <date>-compare-<name>.{json,md}")
    compare.add_argument("--out", type=Path, default=REPORTS_DIR)
    compare.add_argument("--date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    compare.add_argument(
        "--labels-summary",
        type=Path,
        default=None,
        help="the jury summary for authored-v1 runs (default: data/authored-v1.labels.summary.json)",
    )

    gate = sub.add_parser(
        "automation-gate",
        help="score the two automation-reviewer runs against the auto-decision gate (A00 §15; no model call)",
    )
    gate.add_argument("--seeded", required=True, type=Path, help="the seeded-v3 run file (.jsonl)")
    gate.add_argument("--authored", required=True, type=Path, help="the authored-v2 run file (.jsonl)")
    gate.add_argument("--date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    gate.add_argument("--out", type=Path, default=REPORTS_DIR)
    gate.add_argument("--ai-qa-env", type=Path, default=SHIPPING_ENV_PATH, help=argparse.SUPPRESS)

    score = sub.add_parser("score", help="print the report JSON for a run file")
    score.add_argument("run_file", type=Path)
    score.add_argument("--gate", action="store_true", help="exit 1 unless every rollout gate condition passes")
    score.add_argument(
        "--adjudications",
        type=Path,
        default=None,
        help="a human-adjudication file to score with (default: data/adjudications-<dataset>.json)",
    )
    return parser


def _seed(args: argparse.Namespace) -> int:
    from .seed import seed

    spec = DATASETS[args.dataset]
    return seed(args.output or spec.path, check=args.check, dataset=spec)


def _export_sources(args: argparse.Namespace) -> int:
    from .sources import export_sources

    return export_sources(check=args.check)


def _run(args: argparse.Namespace) -> int:
    from ai_qa import second_opinion
    from ai_qa.prompts import PROMPT_VERSION
    from ai_qa.providers import make_client, structured_outputs_on
    from ai_qa.settings import ConfigError, load_settings

    local_cli = args.provider == "claude-cli"
    env = {**os.environ, "AI_PROVIDER": "anthropic" if local_cli else args.provider, "AI_MODEL": args.model}
    if args.second_model and not args.second_provider:
        print("dc-evals: --second-model needs --second-provider", file=sys.stderr)
        return 2
    env.update(second_reviewer_env(args))
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
    spec = RUN_DATASETS[args.dataset]
    rows = load_rows(spec)
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
        second_client = (
            make_client(second_opinion.second_settings(settings), api_key=os.environ.get("ANTHROPIC_API_KEY"))
            if second_opinion.enabled(settings)
            else None
        )
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
            second_client=second_client,
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
        dataset_sha256=spec_sha256(spec),
        dataset_rows=dataset_rows,
        reps=args.reps,
        review_date=review_date,
        effort=settings.effort,
        structured_outputs=settings.structured_outputs,
        structured_outputs_at_start=structured_at_start,
        second_provider=settings.second_provider,
        second_model=settings.second_model,
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


def second_reviewer_env(args: argparse.Namespace) -> dict[str, str]:
    """The ai-qa second-opinion env keys for the in-process review: set from --second-provider /
    --second-model / --second-scope, and AI_QA_SECOND_PROVIDER empty (off) when no second
    reviewer is asked for, so an exported env var never turns it on silently."""
    if not args.second_provider:
        return {SECOND_PROVIDER_ENV: ""}
    env = {SECOND_PROVIDER_ENV: args.second_provider}
    if args.second_model:
        env[SECOND_MODEL_ENV] = args.second_model
    if args.second_scope:
        env[SECOND_SCOPE_ENV] = args.second_scope
    return env


def _author(args: argparse.Namespace) -> int:
    from .author import author

    spec = AUTHORED_SPECS[args.dataset]
    return author(
        sources_path=args.sources or AUTHORED_SOURCES[spec.name],
        output=args.output or spec.path,
        model=args.model,
        limit=args.limit,
    )


def _jury(args: argparse.Namespace) -> int:
    from .jury import jury, parse_jurors

    try:
        jurors = parse_jurors(args.jurors)
    except ValueError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    spec = AUTHORED_SPECS[args.dataset]
    return jury(
        input_path=args.input or spec.path,
        output=args.output or spec.labels_path,
        jurors=jurors,
        limit=args.limit,
        dataset=spec.name,
    )


def _automation_gate(args: argparse.Namespace) -> int:
    from .automation_gate import evaluate_gate, write_gate_report

    try:
        report = evaluate_gate(args.seeded, args.authored, env_path=args.ai_qa_env)
    except ValueError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    date = args.date or dt.datetime.now(dt.UTC).date().isoformat()
    for path in write_gate_report(report, args.out, date):
        print(path)
    for reason in report["failures"]:
        print(f"gate: {reason}", file=sys.stderr)
    return 0 if report["passed"] else 1


def _compare(args: argparse.Namespace) -> int:
    from .compare import compare

    date = args.date or dt.datetime.now(dt.UTC).date().isoformat()
    paths = compare(args.run_files, name=args.name, out_dir=args.out, date=date, labels_summary=args.labels_summary)
    for path in paths:
        print(path)
    return 0


def _score(args: argparse.Namespace) -> int:
    header, records = read_run(args.run_file)
    report = build_report(header, records, adjudications=args.adjudications)
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
    handlers = {
        "seed": _seed,
        "export-sources": _export_sources,
        "run": _run,
        "score": _score,
        "author": _author,
        "jury": _jury,
        "compare": _compare,
        "automation-gate": _automation_gate,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

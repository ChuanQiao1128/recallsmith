"""dc-evals command line: seed, run (paid, owner only), score, (Q03) author, jury and compare, and
(V01) review, the local pre-publish self-check through the Claude CLI, and (V02) fetch-sources and
retrieval, the retrieval eval over the pages the deck ledgers cite."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import uuid
from pathlib import Path

from ai_qa.settings import (
    AUTOMATION_MODEL_ENV,
    AUTOMATION_PRICE_INPUT_ENV,
    AUTOMATION_PRICE_OUTPUT_ENV,
    AUTOMATION_PROVIDER_ENV,
    AUTOMATION_REGION_ENV,
    SECOND_MODEL_ENV,
    SECOND_PROVIDER_ENV,
    SECOND_SCOPE_ENV,
)

from .author import DEFAULT_AUTHOR_MODEL
from .deck_review import (
    DEFAULT_CONCURRENCY,
    DEFAULT_LIMIT,
    DEFAULT_REVIEW_MODEL,
    REVIEW_PROVIDER,
)
from .dataset import (
    AUTHORED,
    AUTHORED_SOURCES_PATH,
    AUTHORED_V2,
    AUTHORED_V2_SOURCES_PATH,
    DATASETS,
    DECKS,
    REPORTS_DIR,
    RUN_DATASETS,
    load_rows,
    spec_sha256,
)
from .jury import DEFAULT_JURORS, JUROR_PROVIDERS
from .runner import AUTOMATION_PROFILE, AUTOMATION_PROMPT_VERSION, DEFAULT_PROFILE, PROFILES, profile_prompt
from .report import build_report, file_stem, read_run, run_header, write_run_files
from .score import SHIPPING_ENV_PATH, gate_failures

# A15: `author` / `jury --dataset` picks the authored set; it only chooses the default paths.
AUTHORED_SPECS = {AUTHORED.name: AUTHORED, AUTHORED_V2.name: AUTHORED_V2}
AUTHORED_SOURCES = {AUTHORED.name: AUTHORED_SOURCES_PATH, AUTHORED_V2.name: AUTHORED_V2_SOURCES_PATH}

# The second reviewer's providers (ai-qa AI_QA_SECOND_PROVIDER); claude-cli is local only.
SECOND_PROVIDERS = ("bedrock-converse", "bedrock", "anthropic")
# `run --provider`: ai-qa's providers (openai-mantle is R18C contract L1, the automation reviewer's
# transport) plus the local claude-cli proxy.
RUN_PROVIDERS = ("bedrock", "anthropic", "bedrock-converse", "openai-mantle", "claude-cli")

# D06 (ai-agent-9): the keys a --profile automation run takes from the production env file.
AUTOMATION_FROM_PRODUCTION = (
    "AI_EFFORT", AUTOMATION_PRICE_INPUT_ENV, AUTOMATION_PRICE_OUTPUT_ENV, AUTOMATION_REGION_ENV,
)

DRY_RUN_INPUT_TOKENS = 3000
DRY_RUN_OUTPUT_TOKENS = 1500


def _review_date(text: str) -> str:
    try:
        return dt.date.fromisoformat(text).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from None


def _positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError("expected a positive integer") from None
    if value < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return value


def _ks(text: str) -> list[int]:
    return sorted({_positive_int(part.strip()) for part in text.split(",") if part.strip()})


def _methods(text: str) -> list[str]:
    from .retrieval import METHODS

    chosen = [part.strip() for part in text.split(",") if part.strip()]
    unknown = [m for m in chosen if m not in METHODS]
    if unknown or not chosen:
        raise argparse.ArgumentTypeError(f"methods are a comma list of {', '.join(METHODS)}")
    return list(dict.fromkeys(chosen))


def _deck_slug(text: str) -> str:
    if not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", text):
        raise argparse.ArgumentTypeError("expected a deck slug such as aws-saa-c03")
    return text


def _score_value(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError("expected a number between 0 and 1") from None
    if not 0.0 <= value <= 1.0:
        raise argparse.ArgumentTypeError("expected a number between 0 and 1")
    return value


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
        choices=RUN_PROVIDERS,
        help=(
            "claude-cli = the owner's local Claude Code CLI (their subscription, this machine only); "
            "bedrock-converse = a non-Anthropic Bedrock model through the Converse API; "
            "openai-mantle = Chat Completions on bedrock-mantle (the automation reviewer openai.gpt-5.5, "
            "region AI_QA_AUTOMATION_REGION, default us-east-1)"
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
    run.add_argument(
        "--profile",
        choices=PROFILES,
        default=DEFAULT_PROFILE,
        help=(
            "the reviewer profile (contract K1): default = ai_qa SYSTEM_PROMPT / PROMPT_VERSION; automation = "
            f"SYSTEM_PROMPT_AUTOMATION / {AUTOMATION_PROMPT_VERSION}, the only profile automation-gate accepts"
        ),
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
    run.add_argument("--ai-qa-env", type=Path, default=SHIPPING_ENV_PATH, help=argparse.SUPPRESS)

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

    drafts = sub.add_parser(
        "import-drafts",
        help="add the authored-v2 new-facts stratum from drafts the author-runner wrote (owner's machine only)",
    )
    drafts.add_argument(
        "--drafts", required=True, type=Path,
        help=(
            "JSONL, one GET /api/v1/authoring/drafts/:draftId response per line (the drafts of the "
            "eval:new-facts queue items)"
        ),
    )
    drafts.add_argument(
        "--deck", action="append", default=[], metavar="DECK_ID=DECK_SLUG",
        help="the deck slug of a deckId in the drafts file (repeat per deck)",
    )
    drafts.add_argument("--output", type=Path, default=None, help="default data/authored-v2.jsonl")
    drafts.add_argument(
        "--runs-dir", type=Path, default=None,
        help=(
            "the author-runner's run records (<runId>.meta.json with the pinned authorConfig); default "
            "$DC_RUNNER_LOG_DIR/runs, else ~/Library/Logs/DeveloperCards/runs"
        ),
    )

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

    review = sub.add_parser(
        "review",
        help=(
            "pre-publish AI QA self-check of a deck's cards through the local Claude CLI (the owner's "
            "subscription; no paid provider)"
        ),
    )
    review.add_argument("--deck", required=True, type=Path, help="the deck markdown file (content/decks/<slug>.md)")
    selection = review.add_mutually_exclusive_group()
    selection.add_argument(
        "--changed-since", metavar="REF", default=None,
        help="cards whose stableUid is new or whose content differs from the deck at git ref REF",
    )
    selection.add_argument("--cards", metavar="UID[,UID...]", default=None, help="these stableUids")
    selection.add_argument("--all", action="store_true", help="every card in the deck")
    review.add_argument(
        "--provider", default=REVIEW_PROVIDER,
        help=f"only {REVIEW_PROVIDER} (the local Claude Code CLI); paid providers are refused",
    )
    review.add_argument("--model", default=DEFAULT_REVIEW_MODEL, help=f"default {DEFAULT_REVIEW_MODEL}")
    review.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    review.add_argument(
        "--limit", type=int, default=None,
        help=f"safety cap on the cards reviewed (default {DEFAULT_LIMIT}; a larger selection needs --limit)",
    )
    review.add_argument(
        "--out", type=Path, default=None, help="JSONL of the review items (default evals/.cache/review/<date>-<deck>.jsonl)"
    )
    review.add_argument("--review-date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")
    review.add_argument("--dry-run", action="store_true", help="list the selected cards; no CLI call")

    fetch = sub.add_parser(
        "fetch-sources",
        help="fetch the pages the deck ledgers cite into the local source cache (V02; $DC_SOURCES_CACHE)",
    )
    fetch.add_argument("--deck", action="append", choices=DECKS, default=None, help="a deck slug (repeatable; default both)")
    fetch.add_argument("--max-pages", type=_positive_int, default=None, help="stop after N network fetches")
    fetch.add_argument("--delay-s", type=float, default=1.0, help="seconds between network requests (default 1.0)")
    fetch.add_argument("--retry-failed", action="store_true", help="fetch pages the manifest records as failed again")

    retrieval = sub.add_parser(
        "retrieval",
        help="recall@k / MRR of finding a card's cited page among the cached pages (V02; no model call)",
    )
    retrieval.add_argument("--deck", action="append", choices=DECKS, default=None, help="a deck slug (repeatable; default both)")
    retrieval.add_argument("--k", type=_ks, default=[1, 5, 10], help="comma list of cutoffs (default 1,5,10)")
    retrieval.add_argument("--methods", type=_methods, default=["bm25", "embed", "hybrid"],
                           help="comma list of bm25, embed, hybrid (default all three)")
    retrieval.add_argument("--out", type=Path, default=REPORTS_DIR)
    retrieval.add_argument("--date", type=_review_date, default=None, help="YYYY-MM-DD (default: UTC today)")

    backfill = sub.add_parser(
        "backfill-sources",
        help="propose verbatim SOURCE quotes for a deck's cards without one (V03; review files, no deck edit)",
    )
    backfill.add_argument("--deck", required=True, type=_deck_slug, help="the deck slug (content/decks/<slug>.md)")
    backfill.add_argument("--limit", type=_positive_int, default=None, help="only the first N cards without a source")
    backfill.add_argument("--min-score", type=_score_value, default=None,
                          help="skip proposals scoring below X (0..1; default 0.1)")
    backfill.add_argument("--out", type=Path, default=None, help="output directory (default evals/reports/backfill)")
    backfill.add_argument("--date", type=_review_date, default=None, help="YYYY-MM-DD in the file names (default: UTC today)")
    backfill.add_argument("--offline", action="store_true", help="use cached pages only; never fetch")
    backfill.add_argument("--apply", action="store_true",
                          help="also write the SOURCE lines into the deck file (the owner's step, after review)")

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
    from ai_qa import profiles, second_opinion
    from ai_qa.providers import effective_effort, make_client, structured_outputs_on
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
    if args.profile == AUTOMATION_PROFILE and args.second_provider:
        print("dc-evals: the automation profile reviews alone; drop --second-provider", file=sys.stderr)
        return 2
    try:
        prompt_version, system_text = profile_prompt(args.profile)
    except ValueError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    if args.profile == AUTOMATION_PROFILE:
        try:
            env.update(automation_run_env(args.ai_qa_env, env["AI_PROVIDER"], args.model))
        except ValueError as exc:
            print(f"dc-evals: {exc}", file=sys.stderr)
            return 2
    try:
        settings = load_settings(env)
        if args.profile == AUTOMATION_PROFILE:
            settings = profiles.settings_for(settings, profiles.AUTOMATION_PROFILE)
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

    from .runner import SystemPromptClient, run_eval

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
    if system_text is not None:
        client = SystemPromptClient(client, system_text)
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
        prompt_version=prompt_version,
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
    if args.profile != DEFAULT_PROFILE:
        # A default-profile header stays exactly as before (no "profile" key means default).
        header["profile"] = args.profile
        # D06 (ai-agent-9): the effort the review actually sent (max goes out as xhigh on openai-mantle).
        header["effectiveEffort"] = effective_effort(settings)
    stem = file_stem(started.date().isoformat(), provider_label, settings.model, prompt_version)
    paths = write_run_files(args.out, stem, header, records)
    if len(records) < len(rows) * args.reps:
        print(
            f"stopped at the ${args.max_cost_usd:.2f} cost ceiling after {len(records)} of "
            f"{len(rows) * args.reps} items; the gate refuses this partial run"
        )
    for path in paths:
        print(path)
    return 0


def automation_run_env(env_path: Path, provider: str, model: str) -> dict[str, str]:
    """D06 (ai-agent-9): the env overrides of a --profile automation run. The reviewer is the
    one production's automation profile builds (ai_qa.profiles.settings_for): --provider and
    --model as AI_QA_AUTOMATION_PROVIDER / _MODEL, and AI_EFFORT, the AI_QA_AUTOMATION_* prices
    and region from the production env file, never from the shell, so what is measured is what
    ships. A key production leaves unset is removed (the ai-qa default applies, as in production).
    Raises ValueError when the env file cannot be read."""
    try:
        production = json.loads(env_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError(f"cannot read the production ai-qa env file {env_path}") from None
    if not isinstance(production, dict):
        raise ValueError(f"the production ai-qa env file {env_path} is not a JSON object")
    overrides = {AUTOMATION_PROVIDER_ENV: provider, AUTOMATION_MODEL_ENV: model}
    for key in AUTOMATION_FROM_PRODUCTION:
        value = production.get(key)
        # an empty value makes load_settings fall back to the ai-qa default, as a missing key does
        overrides[key] = "" if value is None else str(value)
    return overrides


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


def _import_drafts(args: argparse.Namespace) -> int:
    from .drafts_import import default_runs_dir, import_drafts, parse_deck_map

    try:
        decks = parse_deck_map(args.deck)
    except ValueError as exc:
        print(f"dc-evals: {exc}", file=sys.stderr)
        return 2
    if not args.drafts.is_file():
        print(f"dc-evals: drafts file {args.drafts} does not exist", file=sys.stderr)
        return 2
    runs_dir = args.runs_dir or default_runs_dir()
    if not runs_dir.is_dir():
        print(f"dc-evals: runs directory {runs_dir} does not exist (pass --runs-dir)", file=sys.stderr)
        return 2
    return import_drafts(drafts_path=args.drafts, decks=decks, output=args.output or AUTHORED_V2.path, runs_dir=runs_dir)


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


def _review(args: argparse.Namespace) -> int:
    from . import deck_review

    return deck_review.run_review(args)


def _fetch_sources(args: argparse.Namespace) -> int:
    from .source_cache import run_fetch

    return run_fetch(list(dict.fromkeys(args.deck or DECKS)), max_pages=args.max_pages, delay_s=max(args.delay_s, 0.0),
                     retry_failed=args.retry_failed)


def _retrieval(args: argparse.Namespace) -> int:
    from .retrieval import run_retrieval, today

    return run_retrieval(list(dict.fromkeys(args.deck or DECKS)), ks=args.k, methods=args.methods, out_dir=args.out,
                         date=args.date or today())


def _backfill_sources(args: argparse.Namespace) -> int:
    from . import backfill

    if args.min_score is None:
        args.min_score = backfill.DEFAULT_MIN_SCORE
    if args.out is None:
        args.out = backfill.DEFAULT_OUT
    return backfill.run_backfill(args)


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
        "import-drafts": _import_drafts,
        "jury": _jury,
        "compare": _compare,
        "automation-gate": _automation_gate,
        "review": _review,
        "fetch-sources": _fetch_sources,
        "retrieval": _retrieval,
        "backfill-sources": _backfill_sources,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

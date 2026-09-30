"""V01: `dc-evals review`, the owner's local pre-publish AI QA self-check.

Reviews the new or edited cards of a deck before it is imported or published, with the SAME
prompt and parser as production AI QA: the cards come from the console parser
(evals/scripts/parse-deck.mts, frontend/src/lib/deckImport.ts parseDeckMarkdown) and each goes
through ai_qa.review.review_card (profile default) exactly as `dc-evals run --provider claude-cli`
sends it: the owner's local Claude Code CLI, structured outputs off, no second reviewer. No paid
provider is selectable here; `dc-evals run` is the only command that reaches one.

Seams for the tests: parse_deck (node) and make_review_client (the CLI) are module-level names
resolved at call time.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from ai_qa.settings import SECOND_PROVIDER_ENV

from .dataset import EVALS_ROOT
from .runner import DEFAULT_PROFILE, profile_prompt

REPO_ROOT = EVALS_ROOT.parent
PARSE_DECK_SCRIPT = EVALS_ROOT / "scripts" / "parse-deck.mts"
FRONTEND_NODE_MODULES = REPO_ROOT / "frontend" / "node_modules"
# Git-ignored (.gitignore: evals/.cache/).
REVIEW_CACHE_DIR = EVALS_ROOT / ".cache" / "review"

REVIEW_PROVIDER = "claude-cli"
DEFAULT_REVIEW_MODEL = "claude-opus-5"
DEFAULT_CONCURRENCY = 2
DEFAULT_LIMIT = 60
PAID_PROVIDER_REFUSAL = "paid providers are not available here; use dc-evals run"
SELECTION_HELP = (
    "choose the cards to review with exactly one of: --changed-since REF (new or edited since a git ref), "
    "--cards UID[,UID...] (named cards), --all (every card)"
)

SEVERITY_ORDER = ("blocker", "major", "minor")
# A finding of these severities fails the self-check (exit 1).
FAILING_SEVERITIES = frozenset({"blocker", "major"})

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_USAGE = 2
EXIT_ERRORED = 3


class ReviewUsageError(Exception):
    """A usage or configuration problem; the command prints it and exits 2."""


def parse_deck_command(target: str) -> list[str]:
    """The node command that prints a deck's cards: a file path, or "-" for stdin."""
    return ["node", str(PARSE_DECK_SCRIPT), target]


def parse_deck(
    target: str,
    text: str | None = None,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    node_modules: Path = FRONTEND_NODE_MODULES,
) -> list[dict[str, Any]]:
    """The exported cards of a deck, through parse-deck.mts: the file `target`, or `text` on
    stdin when target is "-". Raises ReviewUsageError on a parse error or a missing toolchain."""
    if not (node_modules / "esbuild").is_dir():
        raise ReviewUsageError(
            f"{node_modules} has no esbuild; the deck parser needs it: run `cd frontend && npm ci`"
        )
    try:
        proc = runner(parse_deck_command(target), input=text, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        raise ReviewUsageError("node is not on PATH; the deck parser needs Node 22.18+") from None
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip() or f"parse-deck.mts exited {proc.returncode}"
        raise ReviewUsageError(f"cannot parse the deck:\n{detail}")
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False)


def deck_at_ref(ref: str, deck: Path) -> str | None:
    """The deck's text at `ref` (`git show REF:<path>`), None when the deck is not in that
    commit. Raises ReviewUsageError when the deck is not in a git repository or ref is unknown."""
    top = _git(deck.parent, "rev-parse", "--show-toplevel")
    if top.returncode != 0:
        raise ReviewUsageError(f"{deck} is not inside a git repository; --changed-since needs one")
    root = Path(top.stdout.strip()).resolve()
    if _git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").returncode != 0:
        raise ReviewUsageError(f"--changed-since: unknown git ref {ref!r}")
    rel = deck.resolve().relative_to(root).as_posix()
    shown = _git(root, "show", f"{ref}:{rel}")
    return shown.stdout if shown.returncode == 0 else None


def make_review_client(model: str) -> Any:
    from .claude_cli import ClaudeCliClient

    return ClaudeCliClient(model)


def card_content(card: dict[str, Any]) -> str:
    """What --changed-since compares: the exported card as sorted-key JSON."""
    return json.dumps(card, sort_keys=True, ensure_ascii=False)


def changed_cards(current: list[dict[str, Any]], previous: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The cards whose stableUid is new, or whose content differs from `previous`, in deck order."""
    before = {c["stableUid"]: card_content(c) for c in previous}
    return [c for c in current if before.get(c["stableUid"]) != card_content(c)]


def named_cards(current: list[dict[str, Any]], spec: str) -> list[dict[str, Any]]:
    wanted = [uid.strip() for uid in spec.split(",") if uid.strip()]
    if not wanted:
        raise ReviewUsageError("--cards needs at least one stableUid")
    known = {c["stableUid"] for c in current}
    missing = [uid for uid in wanted if uid not in known]
    if missing:
        raise ReviewUsageError(f"--cards: not in the deck: {', '.join(missing)}")
    chosen = set(wanted)
    return [c for c in current if c["stableUid"] in chosen]


def select_cards(args: argparse.Namespace, deck: Path) -> tuple[list[dict[str, Any]], str]:
    """(selected cards in deck order, a label of the selection)."""
    current = parse_deck(str(deck))
    if args.all:
        return current, "all"
    if args.cards is not None:
        return named_cards(current, args.cards), f"cards {args.cards}"
    old_text = deck_at_ref(args.changed_since, deck)
    previous = parse_deck("-", old_text) if old_text is not None else []
    return changed_cards(current, previous), f"changed since {args.changed_since}"


def _one_line(text: Any) -> str:
    return " ".join(str(text).split()) if text not in (None, "") else "-"


def format_table(items: list[dict[str, Any]]) -> list[str]:
    """One row per finding, grouped by card (the uid on the group's first row), blocker first;
    a clean card gets one "no findings" row and an errored one its error code."""
    rows: list[tuple[str, str, str, str, str]] = []
    for item in items:
        uid = item["stableUid"]
        if item["status"] != "done":
            group = [("error", item.get("errorCode") or "ERROR", "the review did not complete", "-")]
        elif not item["findings"]:
            group = [("-", "-", "no findings", "-")]
        else:
            ordered = sorted(
                item["findings"],
                key=lambda f: SEVERITY_ORDER.index(f["severity"]) if f["severity"] in SEVERITY_ORDER else 99,
            )
            group = [
                (f["severity"], f["category"], _one_line(f["message"]), _one_line(f.get("suggestedFix")))
                for f in ordered
            ]
        for index, (severity, category, message, fix) in enumerate(group):
            rows.append((uid if index == 0 else "", severity, category, message, fix))
    head = ("stableUid", "severity", "category", "message", "suggestedFix")
    widths = [max(len(r[i]) for r in [head, *rows]) for i in range(3)]

    def line(r: tuple[str, ...]) -> str:
        return " | ".join([*(r[i].ljust(widths[i]) for i in range(3)), r[3], r[4]])

    return [line(head), "-+-".join("-" * w for w in widths) + "-+-" + "-" * 7 + "-+-" + "-" * 12, *map(line, rows)]


def totals(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = {severity: 0 for severity in SEVERITY_ORDER}
    for item in items:
        for f in item["findings"] if item["status"] == "done" else []:
            counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    counts["errored"] = sum(1 for item in items if item["status"] != "done")
    counts["reviewed"] = len(items) - counts["errored"]
    return counts


def exit_code(items: list[dict[str, Any]]) -> int:
    if any(item["status"] != "done" for item in items):
        return EXIT_ERRORED
    failing = any(f["severity"] in FAILING_SEVERITIES for item in items for f in item["findings"])
    return EXIT_FINDINGS if failing else EXIT_OK


def _usage(message: str) -> int:
    print(f"dc-evals review: {message}", file=sys.stderr)
    return EXIT_USAGE


def run_review(args: argparse.Namespace) -> int:
    if args.provider != REVIEW_PROVIDER:
        return _usage(f"--provider {args.provider}: {PAID_PROVIDER_REFUSAL}")
    if args.changed_since is None and args.cards is None and not args.all:
        return _usage(SELECTION_HELP)
    if args.concurrency < 1:
        return _usage("--concurrency must be at least 1")
    if args.limit is not None and args.limit < 1:
        return _usage("--limit must be at least 1")
    deck: Path = args.deck
    if not deck.is_file():
        return _usage(f"deck {deck} does not exist")
    try:
        cards, selection = select_cards(args, deck)
    except ReviewUsageError as exc:
        return _usage(str(exc))

    limit = args.limit if args.limit is not None else DEFAULT_LIMIT
    if args.dry_run:
        for c in cards:
            print(f"{c['stableUid']}  d{c.get('difficulty')}  {_one_line(c.get('question'))[:100]}")
        print(f"{len(cards)} cards selected ({selection}); dry run, nothing sent to the CLI")
        if len(cards) > limit:
            print(f"note: over the --limit safety cap of {limit}; a real run needs --limit {len(cards)}")
        return EXIT_OK
    print(f"{len(cards)} cards selected ({selection})")
    if not cards:
        return EXIT_OK
    if len(cards) > limit:
        return _usage(
            f"{len(cards)} cards selected, over the --limit safety cap of {limit}; "
            f"pass --limit {len(cards)} to review them all"
        )

    from ai_qa.settings import ConfigError, load_settings

    env = {
        **os.environ,
        "AI_PROVIDER": "anthropic",  # the request shape; the transport is the local CLI
        "AI_MODEL": args.model,
        "AI_STRUCTURED_OUTPUTS": "off",  # the Bedrock path: validated plain JSON + one repair turn
        SECOND_PROVIDER_ENV: "",
    }
    try:
        prompt_version, system_text = profile_prompt(DEFAULT_PROFILE)
        settings = load_settings(env)
    except (ConfigError, ValueError) as exc:
        return _usage(str(exc))
    if system_text is not None:
        return _usage("the default profile must review with ai_qa SYSTEM_PROMPT")
    client = make_review_client(settings.model)

    from .runner import run_eval

    review_date = args.review_date or dt.datetime.now(dt.UTC).date().isoformat()
    rows = [{"id": f"r-{i:04d}", "defect": None, "tier": None, "card": c} for i, c in enumerate(cards, start=1)]
    records = run_eval(
        rows,
        client=client,
        settings=settings,
        review_date=review_date,
        concurrency=args.concurrency,
        max_cost_usd=float("inf"),  # the owner's subscription; --limit is the cap
    )
    items = [
        {
            "type": "item",
            "stableUid": c["stableUid"],
            "deckSlug": c.get("deckSlug"),
            "status": r["status"],
            "errorCode": r["errorCode"],
            "findings": r["findings"],
            "usage": r["usage"],
            "latencyMs": r["latencyMs"],
            "requestId": r["requestId"],
            "servedModel": r["servedModel"],
        }
        for c, r in zip(cards, records, strict=True)
    ]
    header = {
        "type": "review",
        "deck": str(deck),
        "deckSlug": cards[0].get("deckSlug"),
        "selection": selection,
        "provider": REVIEW_PROVIDER,
        "model": settings.model,
        "promptVersion": prompt_version,
        "reviewDate": review_date,
        "cards": len(items),
    }
    out: Path = args.out or REVIEW_CACHE_DIR / f"{review_date}-{deck.stem}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in [header, *items]), encoding="utf-8")

    print()
    for line in format_table(items):
        print(line)
    t = totals(items)
    print()
    print(f"cards: {t['reviewed']} reviewed, {t['errored']} errored")
    print(f"findings: {t['blocker']} blocker, {t['major']} major, {t['minor']} minor")
    print(out)
    return exit_code(items)

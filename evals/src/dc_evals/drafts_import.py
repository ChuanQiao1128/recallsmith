"""`dc-evals import-drafts` (R18B, B06): the authored-v2 "new-facts" stratum from drafts the
production authoring path wrote.

The docs stratum of authored-v2 comes from `dc-evals author`, a single-shot, tool-less author over
established documentation pages. The automation runner, by contrast, drafts from announcements and
changed pages with the full author-cards skill (read_source, find_similar_cards, lint_card,
submit_draft and the verifier subagent), the queue-item prompt and the runner's CLAUDE args. The
new-facts stratum is authored exactly that way (README, "New-facts stratum"): the owner queues each
page of data/authored-sources-v2-new-facts.json on a sandbox deck, lets the author-runner draft
them, and saves each resulting draft's `GET /api/v1/authoring/drafts/:draftId` response as one
line of a JSONL file. This module turns that file into authored-v2 rows.

For each draft it re-reads the cited page with dc-ingest (the read_source invocation) and keeps
the chunk whose text holds the card's quote verbatim (whitespace aside), so the jury judges the
card against the same source text as every other row. A draft that did not come from the runner
(no agent.runId), names an unknown deck, or whose quote is in no chunk is left out and reported.

The rows replace any earlier new-facts rows in the output file and keep every docs row, so the
order is: `dc-evals author --dataset authored-v2`, then `import-drafts`, then `jury`.
Runs on the owner's machine only (it fetches the pages); the tests pass a fake ingest function.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from typing import Any

from .author import IngestFn, ingest, quote_in_chunk
from .dataset import AUTHORED_V2, STRATUM_NEW_FACTS, dump_line, read_jsonl, stratum_of

# The authorPath every new-facts row carries; the automation gate refuses a new-facts row without it.
RUNNER_AUTHOR_PATH = "author-runner"
ROW_ID_PREFIX = "n-"


def parse_deck_map(pairs: list[str]) -> dict[int, str]:
    """["12=aws-saa-c03", ...] -> {12: "aws-saa-c03"}; raises ValueError."""
    decks: dict[int, str] = {}
    for pair in pairs:
        deck_id, sep, slug = pair.partition("=")
        if not sep or not deck_id.strip().isdigit() or not slug.strip():
            raise ValueError(f"--deck {pair!r} is not <deckId>=<deckSlug>")
        decks[int(deck_id)] = slug.strip()
    return decks


def _chunk_for(url: str, quote: str, ingest_fn: IngestFn, cache: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if url not in cache:
        cache[url] = ingest_fn(url)
    for chunk in cache[url].get("chunks") or []:
        if quote_in_chunk(quote, chunk.get("text") or ""):
            return chunk
    return None


def _problem(draft: dict[str, Any], decks: dict[int, str]) -> str | None:
    agent = draft.get("agent") if isinstance(draft.get("agent"), dict) else {}
    card = draft.get("card") if isinstance(draft.get("card"), dict) else None
    if card is None:
        return "no card"
    if not agent.get("runId"):
        return "not authored by the author-runner (agent.runId is missing)"
    if draft.get("deckId") not in decks:
        return f"deck {draft.get('deckId')!r} has no --deck mapping"
    source = card.get("source") if isinstance(card.get("source"), dict) else {}
    if not isinstance(source.get("url"), str) or not isinstance(source.get("quote"), str):
        return "the card has no source url and quote"
    return None


def draft_rows(
    drafts: list[dict[str, Any]], decks: dict[int, str], *, ingest_fn: IngestFn = ingest, imported_at: str
) -> tuple[list[dict[str, Any]], list[str]]:
    """(new-facts rows n-0001, n-0002, ... in file order, why each left-out draft was left out)."""
    rows: list[dict[str, Any]] = []
    dropped: list[str] = []
    cache: dict[str, dict[str, Any]] = {}
    for draft in drafts:
        name = f"draft {draft.get('draftId')!r}"
        problem = _problem(draft, decks)
        if problem is not None:
            dropped.append(f"{name}: {problem}")
            continue
        card = draft["card"]
        url, quote = card["source"]["url"], card["source"]["quote"]
        try:
            chunk = _chunk_for(url, quote, ingest_fn, cache)
        except Exception as exc:
            dropped.append(f"{name}: {url} could not be read ({type(exc).__name__})")
            continue
        if chunk is None:
            dropped.append(f"{name}: the quote is not verbatim in any chunk of {url}")
            continue
        agent = draft["agent"]
        rows.append(
            {
                "id": f"{ROW_ID_PREFIX}{len(rows) + 1:04d}",
                "stratum": STRATUM_NEW_FACTS,
                "deckSlug": decks[draft["deckId"]],
                "sourceUrl": url,
                "chunkId": chunk["id"],
                "chunkText": chunk["text"],
                "card": card,
                "authorModel": agent.get("model"),
                "authorPath": RUNNER_AUTHOR_PATH,
                "skillVersion": agent.get("skillVersion"),
                "runId": agent["runId"],
                "queueItemId": agent.get("queueItemId"),
                "draftId": draft.get("draftId"),
                "generatedAt": imported_at,
            }
        )
    return rows, dropped


def import_drafts(
    *,
    drafts_path: Path,
    decks: dict[int, str],
    output: Path = AUTHORED_V2.path,
    ingest_fn: IngestFn | None = None,
    now: dt.datetime | None = None,
) -> int:
    """Writes `output`: its docs rows unchanged, then the new-facts rows. 1 when a draft was left out."""
    drafts = read_jsonl(drafts_path)
    imported_at = (now or dt.datetime.now(dt.UTC)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    rows, dropped = draft_rows(drafts, decks, ingest_fn=ingest_fn or ingest, imported_at=imported_at)
    kept = [row for row in read_jsonl(output) if stratum_of(row) != STRATUM_NEW_FACTS] if output.exists() else []
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        for row in [*kept, *rows]:
            fh.write(dump_line(row))
    for reason in dropped:
        print(f"import-drafts: left out {reason}", file=sys.stderr)
    print(f"{output}: {len(rows)} new-facts rows from {len(drafts)} drafts, {len(kept)} other rows kept")
    return 1 if dropped else 0

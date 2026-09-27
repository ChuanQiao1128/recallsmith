"""dc-evals export-sources: data/sources-<deck>.jsonl from the decks' fact-check ledgers.

Each deck has a ledger (content/decks/<slug>.ledger.csv) with one row per (card, cited page):
the https source_url(s) that were read and the fact_checked note of what that page says. seeded-v2
cites its cards from these rows, so its {url, quote} pairs are the project's own verified
citations, never invented ones. Only rows with an https URL, a non-empty note of at most 1000
characters (the deck format's quote limit) and, where the ledger says so, in_deck "yes" are kept,
in ledger order. The export is a pure derivation and is checked byte for byte like the cards.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path
from typing import Any

from .dataset import DECKS, EVALS_ROOT, dump_line, read_jsonl, sources_path

LEDGER_DIR = EVALS_ROOT.parent / "content" / "decks"
MAX_QUOTE_CHARS = 1000
_URL = re.compile(r"https://\S+")


def ledger_path(deck_slug: str) -> Path:
    return LEDGER_DIR / f"{deck_slug}.ledger.csv"


def first_url(cell: str) -> str | None:
    """The first https URL of a ledger cell; a note checked against several pages lists them
    separated by " | " or " ; ", and the citation keeps the first."""
    match = _URL.search(cell)
    return match.group(0).rstrip(",;|") if match else None


def ledger_sources(path: Path) -> list[dict[str, str]]:
    """The citable ledger rows of one deck as {uid, url, quote}, in file order."""
    out: list[dict[str, str]] = []
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            url = first_url(row.get("source_url") or "")
            quote = " ".join((row.get("fact_checked") or "").split())
            if url is None:
                continue
            if not quote or len(quote) > MAX_QUOTE_CHARS:
                continue
            if (row.get("in_deck") or "yes").strip() != "yes":
                continue
            out.append({"uid": row["uid"], "url": url, "quote": quote})
    return out


def render_sources(entries: list[dict[str, str]]) -> str:
    return "".join(dump_line(entry) for entry in entries)


def load_sources(deck_slug: str) -> dict[str, list[dict[str, Any]]]:
    """uid -> its {url, quote} entries, in ledger order."""
    by_uid: dict[str, list[dict[str, Any]]] = {}
    for entry in read_jsonl(sources_path(deck_slug)):
        by_uid.setdefault(entry["uid"], []).append({"url": entry["url"], "quote": entry["quote"]})
    return by_uid


def export_sources(*, check: bool = False) -> int:
    drift = 0
    for slug in DECKS:
        text = render_sources(ledger_sources(ledger_path(slug))).encode("utf-8")
        target = sources_path(slug)
        if check:
            committed = target.read_bytes() if target.exists() else b""
            if committed != text:
                print(f"{target} differs from the ledger export; run dc-evals export-sources", file=sys.stderr)
                drift = 1
            else:
                print(f"{target}: up to date ({len(text)} bytes)")
            continue
        target.write_bytes(text)
        print(f"{target}: {text.count(b'\n')} sources")
    return drift

#!/usr/bin/env python3
"""R29 content: build the two work lists for the SOURCE backfill (owner review 2026-10-04 §2.2-§2.5).

  backfill.json   every card of the AWS and CCDV-F deck files with no SOURCE: line whose fact-check
                  ledger names at least one https page (the page to cite; the quote is still to find)
  unverified.json the AWS cards with no ledger page at all: live cards kept as-is in the 2026-09-21
                  assembly and never re-verified (full card text included)

Run from anywhere (needs frontend/node_modules for the console parser: cd frontend && npm ci):

  python3 docs/delivery/r29-content/build_lists.py

Deterministic for a given repo state. Two optional machine-local inputs only add context and are
skipped when absent: the R20 judge verdicts (~/.rimv-delivery/r20-closeout/judge, the quote R20
proposed for the card and why it was refused) and the V02 page cache (~/.cache/developercards/sources
or $DC_SOURCES_CACHE, whether a candidate page is cached locally). Ledger notes are the checker's
paraphrase of the page, never a quote: a SOURCE quote must be copied from the fetched page.
"""

from __future__ import annotations

import csv
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DECKS_DIR = REPO / "content" / "decks"
DECKS = ("aws-saa-c03", "claude-ccdv-f")
BATCH_SIZE = 25  # owner review §3.2: at most 25 cards per batch, human-reviewed before import
R20_JUDGE = Path.home() / ".rimv-delivery" / "r20-closeout" / "judge"
CACHE = Path(os.environ.get("DC_SOURCES_CACHE", "").strip() or Path.home() / ".cache" / "developercards" / "sources")

# Official documentation hosts. docs.anthropic.com and docs.claude.com now redirect to
# platform.claude.com (API docs) and code.claude.com (Claude Code docs), so those two count as the
# same official Anthropic documentation.
ALLOWED_HOSTS = {
    "docs.aws.amazon.com": "allowed",
    "aws.amazon.com": "allowed",
    "docs.anthropic.com": "allowed",
    "docs.claude.com": "allowed",
    "anthropic.com": "allowed",
    "www.anthropic.com": "allowed",
    "learn.microsoft.com": "allowed",
    "platform.claude.com": "allowed (docs.claude.com redirect target)",
    "code.claude.com": "allowed (docs.claude.com redirect target)",
}
URL_RE = re.compile(r"https://\S+")
HEADER_RE = re.compile(r"^##[ \t](.*)$")


def _excluded_wording() -> dict[int, frozenset[str]]:
    """The project's excluded-wording digests, read from evals/src/dc_evals/backfill.py (one copy)."""
    src = (REPO / "evals" / "src" / "dc_evals" / "backfill.py").read_text(encoding="utf-8")
    match = re.search(r"EXCLUDED_WORDING: dict\[int, frozenset\[str\]\] = (\{.*?\n\})", src, re.S)
    if not match:
        raise SystemExit("EXCLUDED_WORDING not found in evals/src/dc_evals/backfill.py")
    return eval(match.group(1), {"__builtins__": {}, "frozenset": frozenset})  # literal dict of str sets


EXCLUDED = _excluded_wording()


def redact(text: str | None) -> str | None:
    """Replace any excluded term (case-insensitive) with "[term omitted]" so no tracked file carries it."""
    if not text:
        return text
    out, i = [], 0
    low = text.lower()
    while i < len(text):
        for length, digests in EXCLUDED.items():
            if hashlib.sha256(low[i:i + length].encode("utf-8")).hexdigest() in digests:
                out.append("[term omitted]")
                i += length
                break
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def host_policy(url: str) -> str:
    return ALLOWED_HOSTS.get(urllib.parse.urlparse(url).netloc, "needs decision (not on the official-docs list)")


def is_allowed(url: str) -> bool:
    return urllib.parse.urlparse(url).netloc in ALLOWED_HOSTS


def cell_urls(cell: str) -> list[str]:
    return [u.rstrip(",;|") for u in URL_RE.findall(cell or "")]


def cached_at(url: str) -> str | None:
    page = urllib.parse.urldefrag(url.strip()).url
    path = CACHE / f"{hashlib.sha256(page.encode('utf-8')).hexdigest()}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("cachedAt")
    except (OSError, ValueError):
        return None


def parse_deck(slug: str) -> dict[str, dict]:
    """uid -> parsed card, through the console parser (evals/scripts/parse-deck.mts)."""
    out = subprocess.run(
        ["node", str(REPO / "evals" / "scripts" / "parse-deck.mts"), str(DECKS_DIR / f"{slug}.md")],
        check=True, capture_output=True, text=True,
    ).stdout
    cards = [json.loads(line) for line in out.splitlines() if line.strip()]
    return {c["stableUid"]: c for c in cards}


def deck_blocks(slug: str) -> list[dict]:
    """Every card block of the deck file in file order: uid, header line, last non-blank line, raw text."""
    lines = (DECKS_DIR / f"{slug}.md").read_text(encoding="utf-8").split("\n")
    heads = [i for i, line in enumerate(lines) if HEADER_RE.match(line)]
    blocks = []
    for n, start in enumerate(heads):
        end = heads[n + 1] if n + 1 < len(heads) else len(lines)
        last = end - 1
        while last > start and not lines[last].strip():
            last -= 1
        header = HEADER_RE.match(lines[start]).group(1)
        uid = header.split("|")[0].strip()
        blocks.append({
            "uid": uid,
            "position": n,
            "headerLine": start + 1,
            "lastLine": last + 1,
            "markdown": "\n".join(lines[start:last + 1]),
            "hasSourceLine": any(line.startswith("SOURCE:") for line in lines[start:last + 1]),
        })
    return blocks


def ledger_rows(slug: str) -> dict[str, list[dict]]:
    by_uid: dict[str, list[dict]] = {}
    with (DECKS_DIR / f"{slug}.ledger.csv").open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            by_uid.setdefault(row["uid"], []).append(row)
    return by_uid


def r20_verdicts() -> dict[str, dict]:
    if not R20_JUDGE.is_dir():
        return {}
    a: dict[str, dict] = {}
    b: dict[str, dict] = {}
    for f in sorted(glob.glob(str(R20_JUDGE / "a" / "*.json"))):
        for r in json.load(open(f, encoding="utf-8")):
            a[r["id"]] = r
    for f in sorted(glob.glob(str(R20_JUDGE / "b" / "*.json"))):
        for r in json.load(open(f, encoding="utf-8")):
            b[r["id"]] = r
    out = {}
    all_path = R20_JUDGE / "all.json"
    if all_path.is_file():
        for p in json.load(open(all_path, encoding="utf-8")):
            pid = p["id"]
            out[pid] = {
                "url": p["url"],
                "quote": redact(p["quote"]),
                "confidence": p.get("confidence"),
                "verdict": a.get(pid, {}).get("verdict"),
                "why": redact(a.get(pid, {}).get("why")),
                "refutation": b.get(pid, {}).get("verdict"),
                "refutationWhy": redact(b.get(pid, {}).get("why")),
            }
    return out


def kind_of(card: dict) -> str:
    return "mcq" if card.get("mcq") else "qa"


def chunk(items: list, size: int) -> list[list]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def even_chunks(items: list, size: int) -> list[list]:
    """Split into the fewest chunks of at most `size`, as even as possible, keeping order."""
    if not items:
        return []
    n = -(-len(items) // size)
    base, extra = divmod(len(items), n)
    out, i = [], 0
    for k in range(n):
        take = base + (1 if k < extra else 0)
        out.append(items[i:i + take])
        i += take
    return out


def write_json(path: Path, head: dict, items: list[dict]) -> None:
    """Header pretty-printed, then "items" with one compact object per line (readable diffs, small file)."""
    text = json.dumps(head, ensure_ascii=False, indent=1)[:-2]
    body = ",\n".join("  " + json.dumps(item, ensure_ascii=False, separators=(",", ":")) for item in items)
    path.write_text(text + ',\n "items": [\n' + body + "\n ]\n}\n", encoding="utf-8")


def main() -> int:
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    r20 = r20_verdicts()
    backfill: list[dict] = []
    unverified: list[dict] = []
    deck_stats: dict[str, dict] = {}

    for slug in DECKS:
        parsed = parse_deck(slug)
        blocks = deck_blocks(slug)
        ledger = ledger_rows(slug)
        assert len(blocks) == len(parsed), f"{slug}: {len(blocks)} headers vs {len(parsed)} parsed cards"
        with_source = 0
        for block in blocks:
            uid = block["uid"]
            card = parsed[uid]
            assert bool(card.get("source")) == block["hasSourceLine"], f"{slug}/{uid}: SOURCE line vs parser"
            if card.get("source"):
                with_source += 1
                continue
            rows = ledger.get(uid, [])
            in_deck_rows = [r for r in rows if (r.get("in_deck") or "yes").strip() == "yes"]
            cited = [r for r in in_deck_rows if cell_urls(r.get("source_url", ""))]
            base = {
                "deck": slug,
                "file": f"content/decks/{slug}.md",
                "uid": uid,
                "position": block["position"],
                "headerLine": block["headerLine"],
                "lastLine": block["lastLine"],
                "kind": kind_of(card),
                "difficulty": card["difficulty"],
                "topic": card.get("topic"),
            }
            if cited:
                candidates = []
                for r in cited:
                    urls = cell_urls(r["source_url"])
                    candidates.append({
                        "urls": urls,
                        "note": r.get("fact_checked", ""),
                        "verifiedAt": r.get("verified_at", ""),
                        "checkedBy": r.get("checked_by", ""),
                    })
                all_urls: list[str] = []
                for c in candidates:
                    for u in c["urls"]:
                        if u not in all_urls:
                            all_urls.append(u)
                primary, primary_note = None, ""
                for c in candidates:
                    for u in c["urls"]:
                        if primary is None and is_allowed(u):
                            primary, primary_note = u, c["note"]
                if primary is None:
                    primary, primary_note = candidates[0]["urls"][0], candidates[0]["note"]
                flags = []
                if not is_allowed(primary):
                    flags.append("primary-host-needs-decision")
                if any(not cell_urls(r.get("source_url", "")) for r in in_deck_rows):
                    flags.append("part-of-card-kept-from-live-not-reverified")
                alternates = [r for r in rows if r not in in_deck_rows and cell_urls(r.get("source_url", ""))]
                prev = r20.get(f"{slug}:{uid}")
                backfill.append({
                    **base,
                    "url": primary,
                    "urlHostPolicy": host_policy(primary),
                    "urlCachedAt": cached_at(primary),
                    "ledgerNote": primary_note,
                    "otherUrls": [u for u in all_urls if u != primary],
                    "nonOfficialUrls": [u for u in all_urls if not is_allowed(u)],
                    "uncachedUrls": [u for u in all_urls if cached_at(u) is None],
                    "ledgerRows": candidates,
                    "alternateBlockRowsIgnored": len(alternates),
                    "r20": prev,
                    "flags": flags,
                })
            else:
                unverified.append({
                    **base,
                    "ledgerNote": "; ".join(r.get("fact_checked", "") for r in rows) or None,
                    "ledgerChanges": "; ".join(r.get("changes", "") for r in rows) or None,
                    "card": {
                        "question": card["question"],
                        "explanation": card["explanation"],
                        "mcq": card.get("mcq"),
                        "codeLanguage": card.get("codeLanguage"),
                        "codeSnippet": card.get("codeSnippet"),
                        "realWorldUsage": card.get("realWorldUsage"),
                    },
                    "markdown": block["markdown"],
                })
        deck_stats[slug] = {"cards": len(blocks), "withSource": with_source, "withoutSource": len(blocks) - with_source}

    # Batches of at most 25: cards citing the same page sit together (one fetch per page), pages in
    # order of first appearance in the deck file, decks never mixed.
    for slug in DECKS:
        items = [b for b in backfill if b["deck"] == slug]
        first_seen: dict[str, int] = {}
        for b in items:
            first_seen.setdefault(b["url"], b["position"])
        items.sort(key=lambda b: (first_seen[b["url"]], b["position"]))
        prefix = "aws" if slug == "aws-saa-c03" else "ccdvf"
        for n, group in enumerate(chunk(items, BATCH_SIZE), 1):
            for b in group:
                b["batch"] = f"{prefix}-{n:02d}"
    backfill.sort(key=lambda b: (DECKS.index(b["deck"]), b["batch"], b["position"]))

    # Unverified: grouped by topic (one doc area per batch where possible), as even as possible.
    unverified.sort(key=lambda u: (u["topic"] or "", u["position"]))
    for n, group in enumerate(even_chunks(unverified, BATCH_SIZE), 1):
        for u in group:
            u["batch"] = f"verify-{n:02d}"

    rules = [
        "SOURCE: <https url> goes at the end of the card block (canonical order ... USAGE:, SOURCE:), the quote on the following line(s).",
        "The quote must be copied verbatim from the fetched page, whole sentences, <= 200 characters by this wave's rule (parser limit 1000). Never paraphrase; ledgerNote is the checker's paraphrase, not a quote.",
        "If no verbatim sentence on the page backs the card's central claim, leave the card without SOURCE (or URL-only, see notes) rather than citing a weak quote. r20 lists the quote R20 already proposed and why it was refused.",
        "Never touch any other line of the card and never reorder cards: orderInDeck = file position x 10.",
        "Only official documentation hosts (urlHostPolicy). Never exam-dump material.",
    ]
    summary_backfill = {
        "total": len(backfill),
        "byDeck": dict(Counter(b["deck"] for b in backfill)),
        "byKind": dict(Counter(f"{b['deck']}/{b['kind']}" for b in backfill)),
        "byPrimaryHost": dict(Counter(urllib.parse.urlparse(b["url"]).netloc for b in backfill).most_common()),
        "primaryHostNeedsDecision": [b["uid"] for b in backfill if "primary-host-needs-decision" in b["flags"]],
        "partlyKeptFromLive": [b["uid"] for b in backfill if "part-of-card-kept-from-live-not-reverified" in b["flags"]],
        "distinctPrimaryPages": len({b["url"].split("#")[0] for b in backfill}),
        "primaryPageCachedLocally": sum(1 for b in backfill if b["urlCachedAt"]),
        "r20Proposed": sum(1 for b in backfill if b["r20"]),
        "r20VerdictCounts": dict(Counter((b["r20"] or {}).get("verdict") or "none" for b in backfill)),
        "batches": {k: v for k, v in sorted(Counter(b["batch"] for b in backfill).items())},
    }
    summary_unverified = {
        "total": len(unverified),
        "byTopic": dict(Counter(u["topic"] for u in unverified).most_common()),
        "byKind": dict(Counter(u["kind"] for u in unverified)),
        "batches": {k: [u["uid"] for u in unverified if u["batch"] == k] for k in sorted({u["batch"] for u in unverified})},
    }
    meta = {
        "baseCommit": head,
        "decks": deck_stats,
        "generator": "docs/delivery/r29-content/build_lists.py",
        "r20JudgeAvailable": bool(r20),
        "pageCache": str(CACHE).replace(str(Path.home()), "~"),
        "lineNumbersNote": "headerLine/lastLine are 1-based lines of the deck file at baseCommit; they shift as SOURCE lines are inserted, so locate cards by uid.",
    }
    write_json(HERE / "backfill.json", {**meta, "rules": rules, "summary": summary_backfill}, backfill)
    write_json(HERE / "unverified.json", {**meta, "summary": summary_unverified}, unverified)
    print(json.dumps({"backfill": summary_backfill["total"], "byDeck": summary_backfill["byDeck"], "unverified": len(unverified), "decks": deck_stats}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

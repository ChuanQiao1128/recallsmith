"""dc-evals backfill-sources (V03): propose a verbatim SOURCE quote for every card without one.

For each card of ``content/decks/<slug>.md`` whose ``source`` is null, the candidate pages are the
card's own ledger citations: the pages of ``data/sources-<slug>.jsonl`` first and, only when they
yield nothing usable, every https URL of the card's rows in ``<slug>.ledger.csv`` (the fallback
also covers ledger rows the sources export drops). Pages come from the V02 fetch-sources cache
(``$DC_SOURCES_CACHE``); a page not cached yet is fetched through the same polite fetcher unless
``--offline``.

The card's chunks are ranked with the V02 retrieval code: BM25 over every candidate chunk of the
deck, fused by RRF with ``BAAI/bge-small-en-v1.5`` cosine similarity when fastembed is installed
(BM25 alone otherwise). In the best few chunks a quote window is cut: whole sentences of one line
of the page text, at most ``MAX_QUOTE_CHARS`` characters, grown from the sentence that shares the
most terms with the card's answer (explanation and keyed options) while each added neighbour adds
answer terms. Every quote is checked to be a verbatim substring of the page text, and a sentence
that begins with a deck marker (``Q:``, ``## `` ...) is never quoted, since the deck parser would
read it as one.

Outputs (``<out>/<date>-<slug>-sources.{jsonl,md,patch}``) are written only after the patched deck
text parses with zero errors through ``evals/scripts/parse-deck.mts`` (the console parser) and
every proposed card reads back with exactly the proposed ``{url, quote}``. ``--apply`` then writes
the patched text over the deck file; that is the owner's step, never a worker's.

Fetched page text stays in the cache (contract §1 rule 9): only the quotes (at most 1000
characters each) and scores are written to the report files.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
import sys
import time
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import deck_review
from .dataset import EVALS_ROOT, REPORTS_DIR, read_jsonl, sources_path
from .mutations import _answer_text
from .retrieval import BM25, EMBED_MODEL, load_embedder, rrf, today, tokenize
from .source_cache import SourceCache, cache_dir, fetch_sources, ingest_page, page_url

DECKS_DIR = EVALS_ROOT.parent / "content" / "decks"
DEFAULT_OUT = REPORTS_DIR / "backfill"

MAX_QUOTE_CHARS = 1000  # content/decks/FORMAT.md SOURCE grammar (SOURCE_QUOTE_TOO_LONG)
MAX_URL_CHARS = 2048
MAX_WINDOW_SENTENCES = 3
TOP_CHUNKS = 3
# score = density * min(1, matched / FULL_MATCH_TERMS): density is the share of the quote's
# distinct terms that the answer also uses; a quote reaches full strength at six shared terms.
FULL_MATCH_TERMS = 6
HIGH_SCORE = 0.5
MEDIUM_SCORE = 0.3
DEFAULT_MIN_SCORE = 0.1
CONFIDENCE_ORDER = ("low", "medium", "high")
FETCH_DELAY_S = 1.0

_URL = re.compile(r"https://\S+")
_HEADER = re.compile(r"^##[ \t]")
_SOURCE_LINE = re.compile(r"^SOURCE:")
# The column-0 markers of FORMAT §1.1, matched case-insensitively to stay on the safe side.
_MARKER = re.compile(r"^(##[ \t]|#\s*deck:|TOPIC:|QUALIFIER:|SOURCE:|OPT:|WHY:|Q:|A:|USAGE:|CODE:)", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[.!?][\"')\]]*(?=\s)")
_ABBREVIATIONS = frozenset({"e.g", "i.e", "etc", "vs", "approx", "incl", "no", "fig", "cf", "u.s"})


class BackfillError(Exception):
    """A proposal that cannot be written into the deck (the command prints it and exits 1)."""


# --- quote windows --------------------------------------------------------------------------------


def split_sentences(text: str) -> list[tuple[int, int]]:
    """(start, end) of every sentence of ``text``; a sentence never crosses a line break."""
    spans: list[tuple[int, int]] = []
    offset = 0
    for line in text.split("\n"):
        start = 0
        for match in _SENTENCE_END.finditer(line):
            end = match.end()
            nxt = line[end:].lstrip()
            word = line[start:match.start()].split()[-1:] or [""]
            if word[0].lower().lstrip("(") in _ABBREVIATIONS or (nxt[:1].islower()):
                continue
            spans.extend(_trimmed(line, start, end, offset))
            start = end
        spans.extend(_trimmed(line, start, len(line), offset))
        offset += len(line) + 1
    return spans


def _trimmed(line: str, start: int, end: int, offset: int) -> list[tuple[int, int]]:
    while start < end and line[start].isspace():
        start += 1
    while end > start and line[end - 1].isspace():
        end -= 1
    return [(offset + start, offset + end)] if end > start else []


def _stem(term: str) -> str:
    return term[:-1] if len(term) > 3 and term.endswith("s") and not term.endswith("ss") else term


def terms(text: str) -> frozenset[str]:
    return frozenset(_stem(t) for t in tokenize(text))


def window_score(*, matched: int, quote_terms: int) -> float:
    if matched <= 0 or quote_terms <= 0:
        return 0.0
    return (matched / quote_terms) * min(1.0, matched / FULL_MATCH_TERMS)


def confidence_for(score: float) -> str:
    if score >= HIGH_SCORE:
        return "high"
    if score >= MEDIUM_SCORE:
        return "medium"
    return "low"


def starts_with_marker(text: str) -> bool:
    return _MARKER.match(text) is not None


@dataclass(frozen=True)
class Quote:
    text: str
    matched: frozenset[str]
    terms: frozenset[str]

    @property
    def score(self) -> float:
        return window_score(matched=len(self.matched), quote_terms=len(self.terms))


def select_quote(
    text: str,
    support: set[str] | frozenset[str],
    *,
    max_chars: int = MAX_QUOTE_CHARS,
    max_sentences: int = MAX_WINDOW_SENTENCES,
) -> Quote | None:
    """The best quote window of ``text`` for the answer terms ``support``, or None.

    Seed: the sentence sharing the most answer terms (the first one on a tie) that fits the cap and
    does not begin with a deck marker. Growth: the neighbour on the same line that adds the most new
    answer terms (the following one on a tie), while it adds at least one, the window stays within
    ``max_chars`` and ``max_sentences``, and the window's first sentence is not a marker line."""
    support = frozenset(_stem(t) for t in support)
    spans = split_sentences(text)
    if not spans:
        return None
    line_of = [text.count("\n", 0, start) for start, _ in spans]
    overlap = [terms(text[a:b]) & support for a, b in spans]

    def fits(i: int, j: int) -> bool:
        return spans[j][1] - spans[i][0] <= max_chars and not starts_with_marker(text[spans[i][0]:spans[j][1]])

    seeds = [i for i in range(len(spans)) if overlap[i] and fits(i, i)]
    if not seeds:
        return None
    seed = max(seeds, key=lambda i: (len(overlap[i]), -i))
    lo = hi = seed
    covered = set(overlap[seed])
    while hi - lo + 1 < max_sentences:
        options: list[tuple[int, int, int]] = []  # (new terms, prefer-following, index)
        if hi + 1 < len(spans) and line_of[hi + 1] == line_of[seed] and fits(lo, hi + 1):
            options.append((len(overlap[hi + 1] - covered), 1, hi + 1))
        if lo - 1 >= 0 and line_of[lo - 1] == line_of[seed] and fits(lo - 1, hi):
            options.append((len(overlap[lo - 1] - covered), 0, lo - 1))
        options = [o for o in options if o[0] > 0]
        if not options:
            break
        _, _, k = max(options)
        lo, hi = min(lo, k), max(hi, k)
        covered |= overlap[k]
    quote = text[spans[lo][0]:spans[hi][1]]
    if quote not in text or len(quote) > max_chars:  # verbatim and capped, by construction
        raise BackfillError("quote window is not a verbatim substring within the cap")
    return Quote(quote, frozenset(covered), terms(quote))


def check_source_lines(url: str, quote: str) -> None:
    """The FORMAT rules a proposed SOURCE section must meet before it goes into a deck."""
    if not re.fullmatch(r"https://\S+", url) or len(url) > MAX_URL_CHARS:
        raise BackfillError(f"not a valid SOURCE url: {url!r}")
    if not quote or len(quote) > MAX_QUOTE_CHARS:
        raise BackfillError(f"quote is empty or longer than {MAX_QUOTE_CHARS} characters")
    if "\n" in quote or "\r" in quote or quote != quote.strip() or starts_with_marker(quote):
        raise BackfillError(f"quote is not one plain line: {quote[:80]!r}")


# --- deck text ------------------------------------------------------------------------------------


def _card_spans(lines: list[str]) -> dict[str, tuple[int, int]]:
    """uid -> (header line index, index after the card's last line)."""
    headers = [(i, line[2:].split("|")[0].strip()) for i, line in enumerate(lines) if _HEADER.match(line)]
    spans: dict[str, tuple[int, int]] = {}
    for n, (i, uid) in enumerate(headers):
        end = headers[n + 1][0] if n + 1 < len(headers) else len(lines)
        spans.setdefault(uid, (i, end))
    return spans


def insert_sources(deck_text: str, proposals: dict[str, tuple[str, str]]) -> str:
    """``deck_text`` with ``SOURCE: <url>`` and the quote line added to each proposed card, at the
    canonical position: SOURCE is the last section (FORMAT §1.4), so right after the card's last
    non-blank line. Everything else is left byte for byte."""
    lines = deck_text.split("\n")
    spans = _card_spans(lines)
    inserts: list[tuple[int, list[str]]] = []
    for uid, (url, quote) in proposals.items():
        if uid not in spans:
            raise BackfillError(f"card {uid!r} is not in the deck")
        start, end = spans[uid]
        if any(_SOURCE_LINE.match(line) for line in lines[start:end]):
            raise BackfillError(f"card {uid!r} already has a SOURCE: section")
        check_source_lines(url, quote)
        last = max(i for i in range(start, end) if lines[i].strip())
        inserts.append((last + 1, [f"SOURCE: {url}", quote]))
    for at, new in sorted(inserts, reverse=True):
        lines[at:at] = new
    return "\n".join(lines)


def unified_patch(old: str, new: str, path: str) -> str:
    """A unified diff that ``git apply`` (or ``patch -p1``) applies to ``path`` from the repo root."""
    out: list[str] = []
    for line in difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                     fromfile=f"a/{path}", tofile=f"b/{path}", n=3):
        out.append(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n")
    return "".join(out)


# --- candidate pages ------------------------------------------------------------------------------


def sources_file(slug: str) -> Path:
    return sources_path(slug)


def ledger_file(slug: str) -> Path:
    return DECKS_DIR / f"{slug}.ledger.csv"


def candidate_pages(slug: str) -> dict[str, tuple[list[str], list[str]]]:
    """uid -> (pages from the sources file, further pages from the raw ledger rows), in ledger order."""
    primary: dict[str, list[str]] = {}
    path = sources_file(slug)
    if path.exists():
        for entry in read_jsonl(path):
            pages = primary.setdefault(entry["uid"], [])
            url = page_url(entry["url"])
            if url.startswith("https://") and url not in pages:
                pages.append(url)
    fallback: dict[str, list[str]] = {}
    ledger = ledger_file(slug)
    if ledger.exists():
        with ledger.open(encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                uid = (row.get("uid") or "").strip()
                pages = fallback.setdefault(uid, [])
                for raw in _URL.findall(row.get("source_url") or ""):
                    url = page_url(raw.rstrip(",;|"))
                    if url not in pages and url not in primary.get(uid, []):
                        pages.append(url)
    return {uid: (primary.get(uid, []), fallback.get(uid, [])) for uid in {*primary, *fallback}}


# --- proposing --------------------------------------------------------------------------------------


@dataclass
class Chunk:
    page: str
    text: str
    title: str


@dataclass
class Result:
    proposals: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)
    ranker: str = "bm25"
    ranker_note: str | None = None


def support_terms(card: dict[str, Any]) -> frozenset[str]:
    """The answer text a quote must support: the explanation and the keyed options."""
    parts = [card.get("explanation") or ""]
    mcq = card.get("mcq") or {}
    parts.extend(o.get("text") or "" for o in mcq.get("options") or [] if o.get("correct"))
    return terms(" ".join(parts))


def _similarities(embedder: Any, queries: list[str], chunks: Sequence[Chunk]) -> list[list[float]]:
    chunk_vectors = embedder.embed([f"{c.title}\n{c.text}" for c in chunks])
    query_vectors = embedder.embed(queries)
    try:
        import numpy as np
    except ImportError:
        def unit(v: Sequence[float]) -> list[float]:
            norm = sum(x * x for x in v) ** 0.5 or 1.0
            return [x / norm for x in v]
        cs = [unit(v) for v in chunk_vectors]
        return [[sum(a * b for a, b in zip(unit(q), c)) for c in cs] for q in query_vectors]
    matrix = np.asarray(chunk_vectors, dtype=np.float32)
    matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
    qs = np.asarray(query_vectors, dtype=np.float32)
    qs /= np.maximum(np.linalg.norm(qs, axis=1, keepdims=True), 1e-12)
    return (qs @ matrix.T).tolist()


def propose(
    cards: list[dict[str, Any]],
    candidates: dict[str, tuple[list[str], list[str]]],
    *,
    cache: SourceCache,
    embedder: Any | None,
    embed_skip_reason: str | None,
    min_score: float = DEFAULT_MIN_SCORE,
    limit: int | None = None,
) -> Result:
    result = Result()
    sourced = [c for c in cards if c.get("source")]
    todo = [c for c in cards if not c.get("source")]
    selected = todo[:limit] if limit is not None else todo
    result.counts = {"cards": len(cards), "hasSource": len(sourced), "withoutSource": len(todo),
                     "processed": len(selected), "notProcessedLimit": len(todo) - len(selected)}

    documents: dict[str, dict[str, Any] | None] = {}
    chunks: list[Chunk] = []
    by_page: dict[str, list[int]] = {}
    for card in selected:
        for url in [*candidates.get(card["stableUid"], ([], []))[0], *candidates.get(card["stableUid"], ([], []))[1]]:
            if url in documents:
                continue
            documents[url] = cache.load(url)
            if documents[url] is not None:
                title = documents[url].get("title") or ""
                for c in documents[url].get("chunks", []):
                    by_page.setdefault(url, []).append(len(chunks))
                    chunks.append(Chunk(url, c["text"], title))

    bm25 = BM25([f"{c.title}\n{c.text}" for c in chunks]) if chunks else None
    sims: list[list[float]] | None = None
    if embedder is not None and chunks and selected:
        sims = _similarities(embedder, [_answer_text(c) for c in selected], chunks)
        result.ranker = "hybrid"
        result.ranker_note = f"RRF of BM25 and {getattr(embedder, 'name', EMBED_MODEL)} cosine"
    else:
        result.ranker_note = f"BM25 only ({embed_skip_reason or 'no embedder'})"

    for n, card in enumerate(selected):
        uid = card["stableUid"]
        primary, fallback = candidates.get(uid, ([], []))
        if not primary and not fallback:
            result.skipped.append({"uid": uid, "reason": "no ledger URL for this card"})
            continue
        support = support_terms(card)
        bm = bm25.scores(tokenize(_answer_text(card))) if bm25 else {}
        best: tuple[Quote, str, str, int, int] | None = None
        cached_any = False
        for tier, pages in (("sources file", primary), ("ledger fallback", fallback)):
            idx = [i for url in pages for i in by_page.get(url, [])]
            cached_any = cached_any or bool(idx)
            if not idx:
                continue
            bm_scores = {i: bm.get(i, 0.0) for i in idx}
            if sims is not None:
                order = sorted(rrf([bm_scores, {i: sims[n][i] for i in idx}]).items(), key=lambda kv: (-kv[1], kv[0]))
            else:
                order = sorted(bm_scores.items(), key=lambda kv: (-kv[1], kv[0]))
            for rank, (i, _) in enumerate(order[:TOP_CHUNKS], start=1):
                quote = select_quote(chunks[i].text, support)
                if quote is None:
                    continue
                page_text = "\n".join(c["text"] for c in documents[chunks[i].page]["chunks"])
                if quote.text not in page_text:
                    raise BackfillError(f"{uid}: quote is not verbatim in {chunks[i].page}")
                if best is None or quote.score > best[0].score:
                    best = (quote, chunks[i].page, tier, rank, len(idx))
            if best is not None and best[0].score >= min_score:
                break
        if best is None:
            reason = "no quotable sentence on the cited pages" if cached_any else "no cached page (fetch failed or --offline)"
            result.skipped.append({"uid": uid, "reason": reason})
            continue
        quote, url, tier, rank, total = best
        score = round(quote.score, 4)
        if score < min_score:
            result.skipped.append({"uid": uid, "reason": f"below --min-score ({score:.4f} < {min_score})"})
            continue
        shown = ", ".join(sorted(quote.matched)[:10])
        result.proposals.append({
            "uid": uid,
            "url": url,
            "quote": quote.text,
            "score": score,
            "confidence": confidence_for(score),
            "reason": (f"{result.ranker} chunk {rank} of {total} ({tier}); {len(quote.matched)} of the quote's "
                       f"{len(quote.terms)} terms are answer terms: {shown}"),
            "_answer": card.get("explanation") or "",
        })
    return result


# --- validation and report files --------------------------------------------------------------------


def validate_patched(deck_text: str, patched: str, proposals: list[dict[str, Any]]) -> None:
    """The patched deck must parse with zero errors (parse-deck.mts, the console parser), keep
    every card, give each proposed card exactly its proposed source and leave the rest alone."""
    try:
        before = {c["stableUid"]: c for c in deck_review.parse_deck("-", deck_text)}
        after = {c["stableUid"]: c for c in deck_review.parse_deck("-", patched)}
    except deck_review.ReviewUsageError as exc:
        raise BackfillError(f"the patched deck does not parse: {exc}") from None
    if set(before) != set(after):
        raise BackfillError("the patched deck does not hold the same cards")
    proposed = {p["uid"]: {"url": p["url"], "quote": p["quote"]} for p in proposals}
    for uid, card in after.items():
        expected = proposed.get(uid, before[uid].get("source"))
        if card.get("source") != expected:
            raise BackfillError(f"{uid}: the patched deck reads back source {card.get('source')!r}")


def _cell(text: Any, limit: int | None = None) -> str:
    value = " ".join(str(text).split())
    if limit is not None and len(value) > limit:
        value = value[: limit - 3] + "..."
    return value.replace("|", "\\|")


def render_markdown(result: Result, *, slug: str, date: str, patch_name: str, min_score: float) -> str:
    c = result.counts
    conf = Counter(p["confidence"] for p in result.proposals)
    skipped = Counter(s["reason"].split(" (")[0] for s in result.skipped)
    lines = [
        f"# Source backfill proposal: {slug} ({date})", "",
        "Proposed `SOURCE:` lines for the cards of `content/decks/" + slug + ".md` that have none. Each quote "
        "is a verbatim passage of one of the card's own ledger pages (whole sentences, at most "
        f"{MAX_QUOTE_CHARS} characters). **Review every row before applying**, weakest first; the score "
        "only measures word overlap with the card's answer, not whether the page supports it.", "",
        "## Summary", "",
        f"- cards in the deck: {c['cards']}",
        f"- already has a source: {c['hasSource']}",
        f"- without a source: {c['withoutSource']} (processed {c['processed']}, "
        f"left for a later run by --limit {c['notProcessedLimit']})",
        f"- proposed: {len(result.proposals)} (high {conf['high']}, medium {conf['medium']}, low {conf['low']})",
        f"- skipped: {len(result.skipped)}" + (" (" + ", ".join(f"{k}: {v}" for k, v in sorted(skipped.items())) + ")"
                                                if skipped else ""),
        f"- ranker: {result.ranker}; {result.ranker_note}",
        f"- confidence: high >= {HIGH_SCORE}, medium >= {MEDIUM_SCORE}, low below; --min-score {min_score}",
        "- score = (answer terms in the quote / distinct terms in the quote) x min(1, answer terms in the "
        f"quote / {FULL_MATCH_TERMS})",
        "", "## Applying", "",
        f"From the repo root, after review: `git apply evals/reports/backfill/{patch_name}` (it applies to the "
        "deck as it was when the proposal was made), or drop the rows you reject from the patch first. "
        f"Alternatively `dc-evals backfill-sources --deck {slug} --apply` recomputes and writes every "
        "proposal (use --min-score to leave out the weak ones). Then import and publish through the console.",
        "", "## Proposals (weakest first)", "",
        "| # | card | confidence | score | page | quote | answer (excerpt) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for n, p in enumerate(sort_for_review(result.proposals), start=1):
        lines.append(f"| {n} | `{p['uid']}` | {p['confidence']} | {p['score']:.4f} | {_cell(p['url'])} | "
                     f"{_cell(p['quote'])} | {_cell(p['_answer'], 240)} |")
    lines += ["", "## Skipped", ""]
    if result.skipped:
        lines += ["| card | reason |", "| --- | --- |"]
        lines += [f"| `{s['uid']}` | {_cell(s['reason'])} |" for s in result.skipped]
    else:
        lines.append("None.")
    return "\n".join(lines) + "\n"


def sort_for_review(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(proposals, key=lambda p: (CONFIDENCE_ORDER.index(p["confidence"]), p["score"], p["uid"]))


def run_backfill(args: argparse.Namespace) -> int:
    slug: str = args.deck
    deck_path = DECKS_DIR / f"{slug}.md"
    if not deck_path.exists():
        print(f"no deck file {deck_path}", file=sys.stderr)
        return 2
    try:
        cards = deck_review.parse_deck(str(deck_path))
    except deck_review.ReviewUsageError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    deck_text = deck_path.read_text(encoding="utf-8")
    candidates = candidate_pages(slug)
    cache = SourceCache(cache_dir())
    todo = [c for c in cards if not c.get("source")]
    todo = todo[: args.limit] if args.limit is not None else todo
    if not args.offline:
        wanted = list(dict.fromkeys(u for c in todo for tier in candidates.get(c["stableUid"], ([], [])) for u in tier))
        counts = fetch_sources(wanted, cache=cache, fetcher=ingest_page, delay_s=FETCH_DELAY_S,
                               sleep=lambda s: time.sleep(s), log=lambda m: print(m, file=sys.stderr))
        print(f"pages: fetched {counts['fetched']}, cached {counts['cached']}, failed {counts['failed']}",
              file=sys.stderr)
    embedder, reason = load_embedder()
    if embedder is None:
        print(f"ranking with BM25 only: {reason}", file=sys.stderr)
    try:
        result = propose(cards, candidates, cache=cache, embedder=embedder, embed_skip_reason=reason,
                         min_score=args.min_score, limit=args.limit)
        patched = insert_sources(deck_text, {p["uid"]: (p["url"], p["quote"]) for p in result.proposals})
        validate_patched(deck_text, patched, result.proposals)
    except BackfillError as exc:
        print(f"backfill-sources: {exc}", file=sys.stderr)
        return 1

    date = args.date or today()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    base = out / f"{date}-{slug}-sources"
    rows = [{k: p[k] for k in ("uid", "url", "quote", "score", "confidence", "reason")} for p in result.proposals]
    Path(f"{base}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    Path(f"{base}.patch").write_text(unified_patch(deck_text, patched, f"content/decks/{slug}.md"), encoding="utf-8")
    Path(f"{base}.md").write_text(
        render_markdown(result, slug=slug, date=date, patch_name=f"{base.name}.patch", min_score=args.min_score),
        encoding="utf-8",
    )
    for suffix in ("jsonl", "md", "patch"):
        print(f"{base}.{suffix}")
    conf = Counter(p["confidence"] for p in result.proposals)
    print(f"proposed {len(result.proposals)} (high {conf['high']}, medium {conf['medium']}, low {conf['low']}), "
          f"skipped {len(result.skipped)}, already sourced {result.counts['hasSource']}")
    if args.apply:
        deck_path.write_text(patched, encoding="utf-8")
        print(f"applied {len(result.proposals)} SOURCE sections to {deck_path}")
    return 0

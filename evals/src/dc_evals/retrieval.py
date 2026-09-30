"""dc-evals retrieval (V02): can we find the official page that supports a card?

Ground truth is the fact-check ledgers (data/sources-<deck>.jsonl): each (uid, url) row says the
card ``uid`` was verified against the page ``url``. For every such pair whose page is in the
fetch-sources cache, the query is the card's question plus the text it asserts (explanation, code,
keyed options; ``mutations._answer_text``), the corpus is every chunk of every cached page the same
deck cites, and pages are ranked by their best-scoring chunk. A pair's rank is the gold page's
position in that ranking, counted pessimistically on ties (every page with an equal score is
ranked ahead of it), so an all-zero ranking never scores a lucky hit.

Methods:
- ``bm25``: Okapi BM25 over chunk tokens, pure Python. k1 = 1.5, b = 0.75, the Lucene idf
  ln(1 + (N - df + 0.5) / (df + 0.5)), each distinct query term counted once. Tokens are
  lower-case ``[a-z0-9]+`` runs minus an English stop list; the page title is prefixed to every
  chunk.
- ``embed``: cosine similarity of ``BAAI/bge-small-en-v1.5`` vectors (fastembed, the optional
  ``embeddings`` extra; the model downloads to fastembed's own cache on first use). Queries are
  embedded without an instruction prefix because they are passage-length card text, not short
  questions. Without fastembed the method is reported as skipped, never an error.
- ``hybrid``: reciprocal rank fusion of the bm25 and embed page rankings, score = sum over methods
  of 1 / (60 + rank). Skipped when embed is.

Metrics per deck and over all pairs: recall@k (share of pairs whose gold page ranks <= k) and MRR
(mean of 1 / rank over the full ranking). A card cited against several pages yields one pair per
page, and the card's other gold pages can outrank the one being scored; ``cards`` reports the
per-card view (best rank over the card's gold pages) beside it.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .dataset import cards_path, read_jsonl, sources_path
from .mutations import _answer_text
from .source_cache import MAX_CHUNK_CHARS, OVERLAP_CHARS, SourceCache, cache_dir, page_url

METHODS = ("bm25", "embed", "hybrid")
DEFAULT_KS = (1, 5, 10)
BM25_K1 = 1.5
BM25_B = 0.75
RRF_K = 60
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_BATCH = 64

_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be but by can do for from has have how if in into is it its no not of on or "
    "so such than that the their then there these they this to was were what when where which while "
    "who why will with you your".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS]


@dataclass(frozen=True)
class Chunk:
    page: str
    text: str


class BM25:
    """Okapi BM25 over a fixed list of documents, with an inverted index for scoring."""

    def __init__(self, docs: Sequence[str], *, k1: float = BM25_K1, b: float = BM25_B) -> None:
        self.k1, self.b = k1, b
        self.postings: dict[str, list[tuple[int, int]]] = {}
        self.lengths: list[int] = []
        for index, text in enumerate(docs):
            counts = Counter(tokenize(text))
            self.lengths.append(sum(counts.values()))
            for term, tf in counts.items():
                self.postings.setdefault(term, []).append((index, tf))
        n = len(self.lengths)
        self.avgdl = (sum(self.lengths) / n) if n else 0.0
        self.idf = {t: math.log(1 + (n - len(p) + 0.5) / (len(p) + 0.5)) for t, p in self.postings.items()}

    def scores(self, query_terms: Iterable[str]) -> dict[int, float]:
        """doc index -> score, for the documents that contain at least one query term."""
        out: dict[int, float] = {}
        avgdl = self.avgdl or 1.0
        for term in dict.fromkeys(query_terms):
            postings = self.postings.get(term)
            if not postings:
                continue
            idf = self.idf[term]
            for index, tf in postings:
                norm = tf + self.k1 * (1 - self.b + self.b * self.lengths[index] / avgdl)
                out[index] = out.get(index, 0.0) + idf * tf * (self.k1 + 1) / norm
        return out


def _best_per_page(chunks: Sequence[Chunk], chunk_scores: dict[int, float] | Sequence[float]) -> dict[str, float]:
    pages = {c.page: 0.0 for c in chunks}
    best: dict[str, float] = {}
    items = chunk_scores.items() if isinstance(chunk_scores, dict) else enumerate(chunk_scores)
    for index, score in items:
        page = chunks[index].page
        if page not in best or score > best[page]:
            best[page] = score
    return {**pages, **best}


def score_pages_bm25(index: BM25, chunks: Sequence[Chunk], query: str) -> dict[str, float]:
    return _best_per_page(chunks, index.scores(tokenize(query)))


def _normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


def score_pages_embed(
    query_vector: Sequence[float], chunk_vectors: Sequence[Sequence[float]], chunks: Sequence[Chunk]
) -> dict[str, float]:
    """Best cosine similarity per page (pure Python; ``_embed_scores`` batches with numpy)."""
    q = _normalize(query_vector)
    sims = [sum(a * b for a, b in zip(q, _normalize(v))) for v in chunk_vectors]
    return _best_per_page(chunks, sims)


def rank_of(scores: dict[str, float], gold: str) -> int:
    """1-based rank of ``gold``; pages tied with it count as ranked ahead (pessimistic)."""
    target = scores[gold]
    return 1 + sum(1 for page, score in scores.items() if page != gold and score >= target)


def ordering(scores: dict[str, float]) -> list[str]:
    return sorted(scores, key=lambda page: (-scores[page], page))


def rrf(rankings: Sequence[dict[str, float]], *, k: int = RRF_K) -> dict[str, float]:
    """Reciprocal rank fusion: page -> sum of 1 / (k + rank) over the rankings (rank 1-based)."""
    fused: dict[str, float] = {}
    for scores in rankings:
        for position, page in enumerate(ordering(scores), start=1):
            fused[page] = fused.get(page, 0.0) + 1 / (k + position)
    return fused


def metrics(ranks: Sequence[int], *, ks: Sequence[int]) -> dict[str, Any]:
    n = len(ranks)
    out: dict[str, Any] = {"n": n}
    for k in ks:
        out[f"recall@{k}"] = round(sum(1 for r in ranks if r <= k) / n, 4) if n else None
    out["mrr"] = round(sum(1 / r for r in ranks) / n, 4) if n else None
    return out


# --- embeddings -----------------------------------------------------------------------------------


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> Sequence[Sequence[float]]: ...


class FastEmbedder:
    """``BAAI/bge-small-en-v1.5`` through fastembed (ONNX, CPU); vectors are L2-normalised."""

    name = EMBED_MODEL

    def __init__(self, model: Any) -> None:
        self._model = model

    def embed(self, texts: list[str]) -> Sequence[Sequence[float]]:
        return list(self._model.embed(texts, batch_size=EMBED_BATCH))


def load_embedder() -> tuple[Embedder | None, str | None]:
    """(the fastembed embedder, None), or (None, why embed is skipped)."""
    try:
        from fastembed import TextEmbedding
    except ImportError:
        return None, "fastembed is not installed (cd evals && uv sync --extra embeddings)"
    try:
        return FastEmbedder(TextEmbedding(model_name=EMBED_MODEL)), None
    except Exception as exc:  # a model download or load failure skips the method, it is not fatal
        return None, f"could not load {EMBED_MODEL}: {type(exc).__name__}: {' '.join(str(exc).split())[:200]}"


def _embed_scores(
    embedder: Embedder, queries: list[str], chunks: Sequence[Chunk]
) -> list[dict[str, float]]:
    chunk_vectors = embedder.embed([c.text for c in chunks])
    query_vectors = embedder.embed(queries)
    try:
        import numpy as np
    except ImportError:
        return [score_pages_embed(q, chunk_vectors, chunks) for q in query_vectors]
    matrix = np.asarray(chunk_vectors, dtype=np.float32)
    matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
    qs = np.asarray(query_vectors, dtype=np.float32)
    qs /= np.maximum(np.linalg.norm(qs, axis=1, keepdims=True), 1e-12)
    sims = qs @ matrix.T
    return [_best_per_page(chunks, row.tolist()) for row in sims]


# --- the eval -------------------------------------------------------------------------------------


def _deck_corpus(deck: str, cache: SourceCache) -> tuple[list[str], list[Chunk], dict[str, int]]:
    entries = read_jsonl(sources_path(deck))
    pages = list(dict.fromkeys(page_url(e["url"]) for e in entries))
    chunks: list[Chunk] = []
    counts = {"cited": len(pages), "cached": 0, "failed": 0, "notFetched": 0}
    for url in pages:
        document = cache.load(url)
        if document is not None:
            counts["cached"] += 1
            title = document.get("title") or ""
            chunks.extend(Chunk(url, f"{title}\n{c['text']}") for c in document.get("chunks", []))
        elif (cache.entry(url) or {}).get("status") == "failed":
            counts["failed"] += 1
        else:
            counts["notFetched"] += 1
    return pages, chunks, counts


def evaluate(
    decks: Sequence[str],
    *,
    ks: Sequence[int] = DEFAULT_KS,
    methods: Sequence[str] = METHODS,
    cache: SourceCache,
    embedder: Embedder | None,
    embed_skip_reason: str | None,
) -> dict[str, Any]:
    use_embed = ("embed" in methods or "hybrid" in methods) and embedder is not None
    method_info: dict[str, Any] = {}
    if "bm25" in methods or "hybrid" in methods:
        method_info["bm25"] = {"status": "ok", "k1": BM25_K1, "b": BM25_B, "idf": "ln(1+(N-df+0.5)/(df+0.5))",
                               "tokens": "lower-case [a-z0-9]+ minus an English stop list"}
    if "embed" in methods or "hybrid" in methods:
        method_info["embed"] = (
            {"status": "ok", "model": embedder.name, "similarity": "cosine", "queryPrefix": None}
            if use_embed else {"status": "skipped", "reason": embed_skip_reason}
        )
    if "hybrid" in methods:
        method_info["hybrid"] = (
            {"status": "ok", "fusion": "reciprocal rank fusion of bm25 and embed", "rrfK": RRF_K}
            if use_embed else {"status": "skipped", "reason": "needs embed, which was skipped"}
        )
    active = [m for m in methods if method_info.get(m, {}).get("status") == "ok"]

    per_deck: dict[str, Any] = {}
    all_pair_ranks: dict[str, list[int]] = {m: [] for m in active}
    all_card_ranks: dict[str, list[int]] = {m: [] for m in active}
    for deck in decks:
        _, chunks, page_counts = _deck_corpus(deck, cache)
        cards = {c["stableUid"]: c for c in read_jsonl(cards_path(deck))}
        pairs = list(dict.fromkeys((e["uid"], page_url(e["url"])) for e in read_jsonl(sources_path(deck))))
        cached_pages = {c.page for c in chunks}
        evaluated = [(uid, url) for uid, url in pairs if uid in cards and url in cached_pages]
        uids = list(dict.fromkeys(uid for uid, _ in evaluated))
        queries = [_answer_text(cards[uid]) for uid in uids]

        page_scores: dict[str, list[dict[str, float]]] = {}
        if chunks and uids:
            if "bm25" in method_info and method_info["bm25"]["status"] == "ok":
                index = BM25([c.text for c in chunks])
                page_scores["bm25"] = [score_pages_bm25(index, chunks, q) for q in queries]
            if use_embed:
                page_scores["embed"] = _embed_scores(embedder, queries, chunks)
            if "hybrid" in active:
                page_scores["hybrid"] = [rrf([b, e]) for b, e in zip(page_scores["bm25"], page_scores["embed"])]

        position = {uid: i for i, uid in enumerate(uids)}
        deck_metrics: dict[str, Any] = {}
        card_metrics: dict[str, Any] = {}
        for method in active:
            pair_ranks = [rank_of(page_scores[method][position[uid]], url) for uid, url in evaluated]
            best: dict[str, int] = {}
            for (uid, _), rank in zip(evaluated, pair_ranks):
                best[uid] = min(rank, best.get(uid, rank))
            card_ranks = list(best.values())
            deck_metrics[method] = metrics(pair_ranks, ks=ks)
            card_metrics[method] = metrics(card_ranks, ks=ks)
            all_pair_ranks[method].extend(pair_ranks)
            all_card_ranks[method].extend(card_ranks)
        per_deck[deck] = {
            "pages": page_counts,
            "chunks": len(chunks),
            "pairs": {
                "total": len(pairs),
                "evaluated": len(evaluated),
                "pageNotCached": sum(1 for uid, url in pairs if url not in cached_pages),
                "cardNotInExport": sum(1 for uid, url in pairs if uid not in cards and url in cached_pages),
            },
            "cardsEvaluated": len(uids),
            "metrics": deck_metrics,
            "cards": card_metrics,
        }
    failures = Counter(
        _failure_class(entry) for url, entry in cache.manifest["pages"].items()
        if entry.get("status") == "failed" and any(url in _deck_pages(d) for d in decks)
    )
    return {
        "type": "retrieval",
        "decks": per_deck,
        "overall": {m: metrics(all_pair_ranks[m], ks=ks) for m in active},
        "overallCards": {m: metrics(all_card_ranks[m], ks=ks) for m in active},
        "methods": method_info,
        "config": {
            "ks": list(ks),
            "corpus": "every chunk of every cached page the deck's ledger cites; pages ranked by best chunk",
            "query": "card question + explanation + code + keyed options (mutations._answer_text)",
            "chunking": {"maxChunkChars": MAX_CHUNK_CHARS, "overlapChars": OVERLAP_CHARS,
                         "chunkText": "page title + chunk text"},
            "rank": "1-based, pessimistic on ties",
            "groundTruth": "distinct (uid, page) pairs of data/sources-<deck>.jsonl, URL fragment dropped",
        },
        "failureReasons": dict(sorted(failures.items())),
    }


_DECK_PAGES: dict[str, frozenset[str]] = {}


def _deck_pages(deck: str) -> frozenset[str]:
    if deck not in _DECK_PAGES:
        _DECK_PAGES[deck] = frozenset(page_url(e["url"]) for e in read_jsonl(sources_path(deck)))
    return _DECK_PAGES[deck]


def _failure_class(entry: dict[str, Any]) -> str:
    if entry.get("httpStatus"):
        return f"HTTP {entry['httpStatus']}"
    reason = entry.get("reason") or "unknown"
    return reason.split(":")[0][:80]


# --- report files ---------------------------------------------------------------------------------


def _fmt(value: Any) -> str:
    return "n/a" if value is None else (f"{value:.4f}" if isinstance(value, float) else str(value))


def _table(rows: dict[str, dict[str, Any]], ks: Sequence[int], label: str) -> list[str]:
    cols = [f"recall@{k}" for k in ks] + ["mrr"]
    lines = [f"| {label} | method | n | " + " | ".join(cols) + " |",
             "| --- | --- | --- | " + " | ".join("---" for _ in cols) + " |"]
    for name, by_method in rows.items():
        for method, m in by_method.items():
            lines.append(f"| {name} | {method} | {m['n']} | " + " | ".join(_fmt(m[c]) for c in cols) + " |")
    return lines


BASELINE_NOTE = (
    "The existing lexical chooser (`mutations.supporting_source`) is not comparable and is not "
    "reported: it only picks among the card's own ledger URLs (one to a few candidates that are all "
    "correct by construction), and it scores the ledger's `fact_checked` summary notes, not the page "
    "text. Its hit rate measures agreement between two notes about the same card, not retrieval. The "
    "numbers here rank every cached page the deck cites, from the fetched page text."
)


def render_markdown(report: dict[str, Any], date: str) -> str:
    ks = report["config"]["ks"]
    lines = [f"# Retrieval eval {date}", "",
             "Can the page the ledger cites for a card be found from the card's own text? Page-level, "
             "corpus-wide per deck. Metrics only; no page text is committed.", "", "## Methods", ""]
    for method, info in report["methods"].items():
        detail = ", ".join(f"{k}={v}" for k, v in info.items() if k != "status")
        lines.append(f"- `{method}`: {info['status']}" + (f" ({detail})" if detail else ""))
    lines += ["", "## Pairs (one per card and cited page)", ""]
    lines += _table({"overall": report["overall"],
                     **{d: v["metrics"] for d, v in report["decks"].items()}}, ks, "deck")
    lines += ["", "## Cards (best rank over the card's cited pages)", ""]
    lines += _table({"overall": report["overallCards"],
                     **{d: v["cards"] for d, v in report["decks"].items()}}, ks, "deck")
    lines += ["", "## Counts", "", "| deck | pages cited | cached | failed | not fetched | chunks | pairs | "
              "evaluated | cards |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for deck, v in report["decks"].items():
        p = v["pages"]
        lines.append(f"| {deck} | {p['cited']} | {p['cached']} | {p['failed']} | {p['notFetched']} | "
                     f"{v['chunks']} | {v['pairs']['total']} | {v['pairs']['evaluated']} | {v['cardsEvaluated']} |")
    if report["failureReasons"]:
        lines += ["", "Fetch failures: " + ", ".join(f"{k} x{n}" for k, n in report["failureReasons"].items())]
    lines += ["", "## Baseline", "", BASELINE_NOTE, "", "## Config", "", "```json",
              json.dumps(report["config"], indent=2), "```", ""]
    return "\n".join(lines)


def run_retrieval(decks: list[str], *, ks: list[int], methods: list[str], out_dir: Path, date: str) -> int:
    embedder, reason = (None, None)
    if "embed" in methods or "hybrid" in methods:
        embedder, reason = load_embedder()
        if embedder is None:
            print(f"embed skipped: {reason}", file=sys.stderr)
    cache = SourceCache(cache_dir())
    report = evaluate(decks, ks=ks, methods=methods, cache=cache, embedder=embedder, embed_skip_reason=reason)
    report = {"date": date, **report}
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{date}-retrieval.json"
    md_path = out_dir / f"{date}-retrieval.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report, date), encoding="utf-8")
    print(json_path)
    print(md_path)
    return 0


def today() -> str:
    return dt.datetime.now(dt.UTC).date().isoformat()

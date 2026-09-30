"""dc-evals embed-cards / semantic-dupes (V04): local card embeddings for the pgvector store.

Contract (R20 §5), shared with the server (V06):
- Canonical text: ``question.strip() + "\\n\\n" + explanation.strip()``; ``textSha256`` is the lower
  hex SHA-256 of its UTF-8 bytes. The server stores a vector only when this digest matches its own
  digest of the card's current text (``staleText`` otherwise).
- Model ``BAAI/bge-small-en-v1.5`` through fastembed (the optional ``embeddings`` extra; the model
  downloads to fastembed's own cache on first use), 384 dims, L2-normalised, cosine similarity.
- ``PUT /api/v1/admin/card-embeddings`` body ``{model, dim, items:[{deckSlug, stableUid,
  textSha256, embedding}]}``, 1..100 items per request (the Lambda rejects bodies over 1 MiB),
  ``Authorization: Bearer $DC_ADMIN_TOKEN`` → ``{upserted, unknownCards, staleText}``;
  ``503 VECTOR_NOT_READY`` until the owner installs the extension.

The vectors live in ``$DC_EMBED_CACHE/<slug>.jsonl`` (default
``~/.cache/developercards/embeddings``, outside the repo), one JSON object per card:
``{deckSlug, stableUid, textSha256, model, dim, embedding}``. A card whose text, model and dim are
unchanged keeps its cached vector; only new or edited cards are embedded again.

``semantic-dupes`` is the offline twin of the server's semantic-duplicates route: every unordered
pair of cards with cosine >= the threshold, highest first, capped at 50, shown by question text
only; plus the distribution of each card's nearest-neighbour cosine so the threshold can be judged.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any, TextIO

from .dataset import DECKS, EVALS_ROOT, cards_path, dump_line, read_jsonl
from .retrieval import EMBED_MODEL, Embedder, load_embedder

MODEL = EMBED_MODEL
DIM = 384
MAX_PUSH_BATCH = 100
DEFAULT_MIN_COSINE = 0.90
MAX_PAIRS = 50
NEAR_MISSES = 10

EMBED_CACHE_ENV = "DC_EMBED_CACHE"
ADMIN_TOKEN_ENV = "DC_ADMIN_TOKEN"
DEFAULT_EMBED_CACHE = Path.home() / ".cache" / "developercards" / "embeddings"
EMBEDDINGS_ROUTE = "/api/v1/admin/card-embeddings"
DECKS_DIR = EVALS_ROOT.parent / "content" / "decks"

VECTOR_NOT_READY = "VECTOR_NOT_READY"
VECTOR_NOT_READY_MESSAGE = "the owner must CREATE EXTENSION vector and re-run the migration"
REDACTED = "[redacted]"
HTTP_TIMEOUT_S = 60

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_USAGE = 2
EXIT_NOT_READY = 3

# Nearest-neighbour cosine buckets for the distribution (lower bound inclusive).
BUCKET_EDGES = (0.0, 0.70, 0.75, 0.80, 0.85, 0.88, 0.90, 0.92, 0.95, 0.98)

_SLUG = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

Send = Callable[[str, str, dict[str, str], bytes], tuple[int, bytes]]


class UsageError(Exception):
    """A usage or configuration problem; the command prints it and exits 2."""


class PushError(Exception):
    """The push failed (transport or an unexpected HTTP status); exit 1."""


class VectorNotReady(Exception):
    """The server answered 503 VECTOR_NOT_READY; exit 3."""


# --- the contract ---------------------------------------------------------------------------------


def canonical_text(question: str | None, explanation: str | None) -> str:
    return (question or "").strip() + "\n\n" + (explanation or "").strip()


def text_sha256(question: str | None, explanation: str | None) -> str:
    return hashlib.sha256(canonical_text(question, explanation).encode("utf-8")).hexdigest()


def l2_normalize(vector: Sequence[float]) -> list[float]:
    values = [float(x) for x in vector]
    if not all(math.isfinite(x) for x in values):
        raise ValueError("the embedding has a NaN or infinite value")
    norm = math.sqrt(math.fsum(x * x for x in values))
    if norm == 0.0:
        raise ValueError("the embedding is the zero vector")
    return [x / norm for x in values]


# --- decks and the cache --------------------------------------------------------------------------


def load_deck(deck: str) -> tuple[str, list[dict[str, Any]]]:
    """(slug, cards) for a deck file (.md through the V01 parser, or an exported .jsonl) or a slug
    (the exported evals/data/cards-<slug>.jsonl for the two known decks, else content/decks/<slug>.md)."""
    path = Path(deck).expanduser()
    if path.is_file():
        cards = read_jsonl(path) if path.suffix == ".jsonl" else _parse_markdown(path)
        slugs = {c.get("deckSlug") for c in cards if c.get("deckSlug")}
        stem = path.stem.removeprefix("cards-")
        return (slugs.pop() if len(slugs) == 1 else stem), cards
    if deck in DECKS:
        return deck, read_jsonl(cards_path(deck))
    if _SLUG.fullmatch(deck) and (DECKS_DIR / f"{deck}.md").is_file():
        return deck, _parse_markdown(DECKS_DIR / f"{deck}.md")
    raise UsageError(f"no deck {deck!r}: pass a deck file (.md or .jsonl) or one of {', '.join(DECKS)}")


def _parse_markdown(path: Path) -> list[dict[str, Any]]:
    from .deck_review import ReviewUsageError, parse_deck

    try:
        return parse_deck(str(path))
    except ReviewUsageError as exc:
        raise UsageError(str(exc)) from None


def cache_file(slug: str, env: Mapping[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    root = Path(env[EMBED_CACHE_ENV]).expanduser() if env.get(EMBED_CACHE_ENV) else DEFAULT_EMBED_CACHE
    return root / f"{slug}.jsonl"


def read_cache(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    """(stableUid, textSha256) -> record, for the records of the current model and dim."""
    if not path.is_file():
        return {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for record in read_jsonl(path):
        if record.get("model") == MODEL and record.get("dim") == DIM and len(record.get("embedding") or []) == DIM:
            out[(record["stableUid"], record["textSha256"])] = record
    return out


def write_cache(path: Path, records: Sequence[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(dump_line(r) for r in records), encoding="utf-8")
    tmp.replace(path)


def embed_deck(
    slug: str, cards: Sequence[dict[str, Any]], *, cached: dict[tuple[str, str], dict[str, Any]],
    embedder_factory: Callable[[], Embedder],
) -> tuple[list[dict[str, Any]], int]:
    """The deck's records in card order, and how many cards were embedded (the rest were cached).
    ``embedder_factory`` is only called when at least one card needs a vector."""
    todo: list[tuple[int, str]] = []
    records: list[dict[str, Any] | None] = []
    for index, c in enumerate(cards):
        uid = c.get("stableUid")
        if not uid:
            raise UsageError(f"card {index + 1} has no stableUid")
        sha = text_sha256(c.get("question"), c.get("explanation"))
        hit = cached.get((uid, sha))
        records.append({**hit, "deckSlug": slug} if hit else None)
        if hit is None:
            todo.append((index, canonical_text(c.get("question"), c.get("explanation"))))
    if todo:
        vectors = embedder_factory().embed([text for _, text in todo])
        if len(vectors) != len(todo):
            raise PushError(f"the embedder returned {len(vectors)} vectors for {len(todo)} texts")
        for (index, text), vector in zip(todo, vectors):
            values = [float(x) for x in vector]
            if len(values) != DIM:
                raise PushError(f"{MODEL} returned {len(values)} dims, expected {DIM}")
            uid = cards[index]["stableUid"]
            records[index] = {
                "deckSlug": slug, "stableUid": uid, "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "model": MODEL, "dim": DIM, "embedding": l2_normalize(values),
            }
    return [r for r in records if r is not None], len(todo)


# --- push -----------------------------------------------------------------------------------------


def batches(items: Sequence[Any], size: int = MAX_PUSH_BATCH) -> Iterator[list[Any]]:
    for start in range(0, len(items), size):
        yield list(items[start:start + size])


def push_body(records: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {
        "model": MODEL,
        "dim": DIM,
        "items": [
            {"deckSlug": r["deckSlug"], "stableUid": r["stableUid"], "textSha256": r["textSha256"],
             "embedding": r["embedding"]}
            for r in records
        ],
    }


def http_send(method: str, url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_S) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise PushError(f"cannot reach {urllib.parse.urlsplit(url).netloc}: {reason}") from None


def check_api_base(api_base: str) -> str:
    """The base URL without a trailing slash; https, or http only to a local host."""
    parts = urllib.parse.urlsplit(api_base)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise UsageError(f"--api-base must be an https URL, got {api_base!r}")
    if parts.scheme == "http" and parts.hostname not in _LOCAL_HOSTS:
        raise UsageError("--api-base must use https (plain http is only allowed to localhost); the token is a bearer token")
    if parts.query or parts.fragment:
        raise UsageError("--api-base takes no query or fragment")
    return api_base.rstrip("/")


def _envelope(raw: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    """(data, error) from a Res envelope ``{success, data, error{code, message}}``."""
    try:
        parsed = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    data = parsed.get("data") if isinstance(parsed.get("data"), dict) else parsed
    error = parsed.get("error") if isinstance(parsed.get("error"), dict) else {}
    return data, error


def push_records(records: Sequence[dict[str, Any]], *, api_base: str, token: str, send: Send) -> dict[str, Any]:
    url = check_api_base(api_base) + EMBEDDINGS_ROUTE
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}
    totals: dict[str, Any] = {"batches": 0, "sent": 0, "upserted": 0, "unknownCards": [], "staleText": []}
    for batch in batches(records):
        body = json.dumps(push_body(batch), separators=(",", ":"), allow_nan=False).encode("utf-8")
        status, raw = send("PUT", url, dict(headers), body)
        data, error = _envelope(raw)
        if status == 503 and error.get("code") == VECTOR_NOT_READY:
            raise VectorNotReady(VECTOR_NOT_READY_MESSAGE)
        if not 200 <= status < 300:
            code = error.get("code") or "no error code"
            message = " ".join(str(error.get("message") or "").split())[:300]
            raise PushError(f"PUT {EMBEDDINGS_ROUTE} answered HTTP {status} {code}" + (f": {message}" if message else ""))
        totals["batches"] += 1
        totals["sent"] += len(batch)
        totals["upserted"] += int(data.get("upserted") or 0)
        totals["unknownCards"].extend(str(u) for u in data.get("unknownCards") or [])
        totals["staleText"].extend(str(u) for u in data.get("staleText") or [])
    return totals


def _uids(label: str, uids: Sequence[str], limit: int = 20) -> str:
    shown = ", ".join(uids[:limit]) + (f", ... (+{len(uids) - limit})" if len(uids) > limit else "")
    return f"  {label}: {shown}"


# --- semantic pairs -------------------------------------------------------------------------------


def _similarity_matrix(vectors: Sequence[Sequence[float]]) -> list[list[float]]:
    try:
        import numpy as np
    except ImportError:
        return [[math.fsum(a * b for a, b in zip(u, v)) for v in vectors] for u in vectors]
    matrix = np.asarray(vectors, dtype=np.float64)
    return (matrix @ matrix.T).tolist()


def _all_pairs(ids: Sequence[str], sims: list[list[float]]) -> list[dict[str, Any]]:
    pairs = [
        {"cosine": sims[i][j], "a": ids[i], "b": ids[j]}
        for i in range(len(ids)) for j in range(i + 1, len(ids))
    ]
    pairs.sort(key=lambda p: (-p["cosine"], p["a"], p["b"]))
    return pairs


def nearest_pairs(
    ids: Sequence[str], vectors: Sequence[Sequence[float]], *, min_cosine: float, limit: int = MAX_PAIRS
) -> list[dict[str, Any]]:
    """Each unordered pair once with cosine >= min_cosine, highest first, at most ``limit``."""
    return [p for p in _all_pairs(ids, _similarity_matrix(vectors)) if p["cosine"] >= min_cosine][:limit]


def _quantile(sorted_values: Sequence[float], q: float) -> float:
    """Nearest-rank quantile of an ascending list."""
    index = max(0, min(len(sorted_values) - 1, math.ceil(q * len(sorted_values)) - 1))
    return sorted_values[index]


def _nearest(sims: list[list[float]]) -> list[float]:
    return [max((row[j] for j in range(len(row)) if j != i), default=float("nan")) for i, row in enumerate(sims)]


def _distribution_from(nearest: Sequence[float], *, min_cosine: float) -> dict[str, Any]:
    values = sorted(v for v in nearest if math.isfinite(v))
    buckets = []
    for k, low in enumerate(BUCKET_EDGES):
        high = BUCKET_EDGES[k + 1] if k + 1 < len(BUCKET_EDGES) else None
        lower = -1.0 if k == 0 else low
        count = sum(1 for v in values if v >= lower and (high is None or v < high))
        label = f"< {high:.2f}" if k == 0 else (f">= {low:.2f}" if high is None else f"{low:.2f}-{high:.2f}")
        buckets.append({"range": label, "cards": count})
    stats = (
        {"min": round(values[0], 4), "p50": round(_quantile(values, 0.5), 4), "p90": round(_quantile(values, 0.9), 4),
         "p99": round(_quantile(values, 0.99), 4), "max": round(values[-1], 4)}
        if values else {}
    )
    return {
        "cards": len(nearest),
        "cardsAtOrAboveThreshold": sum(1 for v in values if v >= min_cosine),
        "nearestNeighbourCosine": stats,
        "buckets": buckets,
    }


def distribution(ids: Sequence[str], vectors: Sequence[Sequence[float]], *, min_cosine: float) -> dict[str, Any]:
    """Each card's nearest-neighbour cosine: quantiles, buckets and how many clear the threshold."""
    return _distribution_from(_nearest(_similarity_matrix(vectors)), min_cosine=min_cosine)


def build_report(
    slug: str, cards: Sequence[dict[str, Any]], records: Sequence[dict[str, Any]], *, min_cosine: float, date: str
) -> dict[str, Any]:
    questions = {c["stableUid"]: " ".join(str(c.get("question") or "").split()) for c in cards}
    ids = [r["stableUid"] for r in records]
    sims = _similarity_matrix([r["embedding"] for r in records])
    ranked = _all_pairs(ids, sims)
    above = [p for p in ranked if p["cosine"] >= min_cosine]
    below = [p for p in ranked if p["cosine"] < min_cosine][:NEAR_MISSES]

    def shown(pair: dict[str, Any]) -> dict[str, Any]:
        return {
            "cosine": round(pair["cosine"], 4),
            "a": {"stableUid": pair["a"], "question": questions.get(pair["a"], "")},
            "b": {"stableUid": pair["b"], "question": questions.get(pair["b"], "")},
        }

    return {
        "v": 1,
        "kind": "semantic-dupes",
        "date": date,
        "deckSlug": slug,
        "model": MODEL,
        "dim": DIM,
        "similarity": "cosine of the L2-normalised canonical-text vectors (question + explanation)",
        "cards": len(records),
        "minCosine": min_cosine,
        "pairsAtOrAboveThreshold": len(above),
        "pairs": [shown(p) for p in above[:MAX_PAIRS]],
        "nearMisses": [shown(p) for p in below],
        "distribution": _distribution_from(_nearest(sims), min_cosine=min_cosine),
    }


def _md_cell(text: str, limit: int = 140) -> str:
    text = text if len(text) <= limit else text[: limit - 1] + "…"
    return text.replace("|", "\\|")


def report_markdown(report: dict[str, Any]) -> str:
    dist = report["distribution"]
    stats = dist["nearestNeighbourCosine"]
    lines = [
        f"# Semantic duplicates: {report['deckSlug']} ({report['date']})",
        "",
        f"Model `{report['model']}` ({report['dim']} dims), {report['similarity']}. Offline run of "
        "`dc-evals semantic-dupes`; questions only.",
        "",
        f"- Cards: {report['cards']}",
        f"- Threshold: cosine >= {report['minCosine']:.2f}",
        f"- Pairs at or above the threshold: {report['pairsAtOrAboveThreshold']} (showing up to {MAX_PAIRS})",
        f"- Cards whose nearest neighbour is at or above the threshold: {dist['cardsAtOrAboveThreshold']}",
        "",
        "## Nearest-neighbour cosine per card",
        "",
    ]
    if stats:
        lines += [
            "| min | p50 | p90 | p99 | max |",
            "|---|---|---|---|---|",
            f"| {stats['min']:.4f} | {stats['p50']:.4f} | {stats['p90']:.4f} | {stats['p99']:.4f} | {stats['max']:.4f} |",
            "",
        ]
    lines += ["| range | cards |", "|---|---|", *(f"| {b['range']} | {b['cards']} |" for b in dist["buckets"]), ""]

    def table(title: str, pairs: list[dict[str, Any]]) -> list[str]:
        out = [f"## {title}", ""]
        if not pairs:
            return out + ["None.", ""]
        out += ["| cosine | card A | card B |", "|---|---|---|"]
        for p in pairs:
            out.append(
                f"| {p['cosine']:.4f} | `{p['a']['stableUid']}` {_md_cell(p['a']['question'])} "
                f"| `{p['b']['stableUid']}` {_md_cell(p['b']['question'])} |"
            )
        return out + [""]

    lines += table(f"Pairs with cosine >= {report['minCosine']:.2f}", report["pairs"])
    lines += table("Closest pairs below the threshold", report["nearMisses"])
    return "\n".join(lines)


# --- commands -------------------------------------------------------------------------------------


def _redact(text: str, token: str | None) -> str:
    return text.replace(token, REDACTED) if token else text


def _embedder_factory() -> Callable[[], Embedder]:
    def factory() -> Embedder:
        embedder, reason = load_embedder()
        if embedder is None:
            raise UsageError(f"cannot embed: {reason}")
        return embedder

    return factory


def _prepare(deck: str, out: Path | None, env: Mapping[str, str]) -> tuple[str, list[dict[str, Any]], Path, list[dict[str, Any]], int]:
    slug, cards = load_deck(deck)
    if not cards:
        raise UsageError(f"the deck {slug} has no cards")
    target = out or cache_file(slug, env)
    records, embedded = embed_deck(slug, cards, cached=read_cache(target), embedder_factory=_embedder_factory())
    write_cache(target, records)
    return slug, cards, target, records, embedded


def run_embed_cards(args: argparse.Namespace, *, env: Mapping[str, str] | None = None,
                    stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    env = os.environ if env is None else env
    stdout, stderr = stdout or sys.stdout, stderr or sys.stderr
    token = env.get(ADMIN_TOKEN_ENV) or None
    try:
        if args.push:
            if token is None:
                raise UsageError(f"--push needs the console access token in ${ADMIN_TOKEN_ENV} (env only; never a flag)")
            check_api_base(args.api_base)
        slug, _, target, records, embedded = _prepare(args.deck, args.out, env)
        print(f"{slug}: {len(records)} cards, {embedded} embedded, {len(records) - embedded} cached -> {target}",
              file=stdout)
        if not args.push:
            return EXIT_OK
        assert token is not None
        totals = push_records(records, api_base=args.api_base, token=token, send=http_send)
        print(
            f"pushed {totals['sent']} in {totals['batches']} batches: upserted {totals['upserted']}, "
            f"unknownCards {len(totals['unknownCards'])}, staleText {len(totals['staleText'])}",
            file=stdout,
        )
        if totals["unknownCards"]:
            print(_redact(_uids("unknownCards (not on the server)", totals["unknownCards"]), token), file=stdout)
        if totals["staleText"]:
            print(_redact(_uids("staleText (local text differs from the server; embed the published deck file)",
                                totals["staleText"]), token), file=stdout)
        return EXIT_OK
    except UsageError as exc:
        print(f"embed-cards: {_redact(str(exc), token)}", file=stderr)
        return EXIT_USAGE
    except VectorNotReady:
        print(f"embed-cards: 503 {VECTOR_NOT_READY}: {VECTOR_NOT_READY_MESSAGE}", file=stderr)
        return EXIT_NOT_READY
    except (PushError, ValueError) as exc:
        print(f"embed-cards: {_redact(str(exc), token)}", file=stderr)
        return EXIT_FAILED


def run_semantic_dupes(args: argparse.Namespace, *, env: Mapping[str, str] | None = None,
                       stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    env = os.environ if env is None else env
    stdout, stderr = stdout or sys.stdout, stderr or sys.stderr
    try:
        slug, cards, _, records, _ = _prepare(args.deck, args.embeddings, env)
    except UsageError as exc:
        print(f"semantic-dupes: {exc}", file=stderr)
        return EXIT_USAGE
    except (PushError, ValueError) as exc:
        print(f"semantic-dupes: {exc}", file=stderr)
        return EXIT_FAILED
    date = args.date or dt.datetime.now(dt.UTC).date().isoformat()
    report = build_report(slug, cards, records, min_cosine=args.min_cosine, date=date)
    args.out.mkdir(parents=True, exist_ok=True)
    stem = args.out / f"{date}-semantic-dupes-{slug}"
    json_path, md_path = stem.with_suffix(".json"), stem.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(report_markdown(report), encoding="utf-8")
    stats = report["distribution"]["nearestNeighbourCosine"]
    print(
        f"{slug}: {report['cards']} cards, {report['pairsAtOrAboveThreshold']} pairs >= {args.min_cosine:.2f}"
        + (f", nearest-neighbour p50 {stats['p50']:.4f} max {stats['max']:.4f}" if stats else ""),
        file=stdout,
    )
    print(json_path, file=stdout)
    print(md_path, file=stdout)
    return EXIT_OK

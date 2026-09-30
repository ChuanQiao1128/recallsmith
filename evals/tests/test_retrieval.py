"""V02: the retrieval eval (dc-evals fetch-sources / retrieval). No network, no model download:
the fetcher and the embedder are fakes, the cache is a tmp directory."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

from dc_evals import retrieval, source_cache
from dc_evals.cli import main
from dc_evals.retrieval import (
    BM25,
    Chunk,
    evaluate,
    metrics,
    rank_of,
    rrf,
    score_pages_bm25,
    score_pages_embed,
    tokenize,
)
from dc_evals.source_cache import SourceCache, fetch_sources, page_url, url_key

URL_A = "https://docs.example.com/a.html"
URL_B = "https://docs.example.com/b.html"
URL_C = "https://docs.example.com/c.html"


def doc(url: str, *texts: str, title: str = "T") -> dict:
    return {
        "v": 1, "sourceId": "x", "kind": "html", "title": title, "url": url, "path": None,
        "fetchedAt": "2026-10-01T00:00:00Z",
        "chunks": [
            {"id": f"c{i + 1:04d}", "index": i, "heading": None, "page": None, "text": t, "charStart": 0,
             "charEnd": len(t)}
            for i, t in enumerate(texts)
        ],
    }


# --- BM25 -----------------------------------------------------------------------------------------


def test_tokenize_lowercases_and_drops_stopwords() -> None:
    assert tokenize("The S3 Bucket-Keys reduce KMS cost, and the bucket") == [
        "s3", "bucket", "keys", "reduce", "kms", "cost", "bucket",
    ]


def test_bm25_ranks_the_matching_chunk_first_on_a_tiny_corpus() -> None:
    chunks = [
        Chunk(URL_A, "lifecycle rules transition objects to glacier deep archive"),
        Chunk(URL_B, "kms keys encrypt objects; bucket keys reduce kms request cost"),
        Chunk(URL_C, "lambda functions scale with concurrency limits"),
    ]
    scores = score_pages_bm25(BM25([c.text for c in chunks]), chunks, "which kms bucket keys reduce cost")
    assert max(scores, key=scores.get) == URL_B
    assert scores[URL_C] == 0.0
    assert rank_of(scores, URL_B) == 1


def test_bm25_matches_the_formula() -> None:
    # Two docs; the term "kms" appears once in doc 0 only. idf = ln(1 + (N - df + 0.5) / (df + 0.5)).
    bm = BM25(["kms key", "glacier archive vault"], k1=1.5, b=0.75)
    idf = math.log(1 + (2 - 1 + 0.5) / (1 + 0.5))
    avgdl = (2 + 3) / 2
    tf, dl = 1, 2
    expected = idf * tf * (1.5 + 1) / (tf + 1.5 * (1 - 0.75 + 0.75 * dl / avgdl))
    scores = bm.scores(["kms"])
    assert scores[0] == pytest.approx(expected)
    assert 1 not in scores


def test_pages_are_ranked_by_their_best_chunk() -> None:
    chunks = [
        Chunk(URL_A, "vpc peering"), Chunk(URL_A, "vpc peering transit gateway routes"),
        Chunk(URL_B, "transit gateway"),
    ]
    scores = score_pages_bm25(BM25([c.text for c in chunks]), chunks, "transit gateway routes")
    bm = BM25([c.text for c in chunks])
    per_chunk = bm.scores(tokenize("transit gateway routes"))
    assert scores[URL_A] == pytest.approx(max(per_chunk.get(0, 0.0), per_chunk[1]))
    assert scores[URL_B] == pytest.approx(per_chunk[2])


# --- ranks, RRF, metrics --------------------------------------------------------------------------


def test_rank_of_is_pessimistic_on_ties() -> None:
    assert rank_of({URL_A: 1.0, URL_B: 1.0, URL_C: 0.5}, URL_A) == 2
    assert rank_of({URL_A: 1.0, URL_B: 1.0, URL_C: 0.5}, URL_C) == 3
    assert rank_of({URL_A: 2.0, URL_B: 1.0}, URL_A) == 1


def test_rrf_fusion_math() -> None:
    bm25 = {URL_A: 3.0, URL_B: 2.0, URL_C: 1.0}  # A=1, B=2, C=3
    embed = {URL_A: 0.1, URL_B: 0.9, URL_C: 0.5}  # B=1, C=2, A=3
    fused = rrf([bm25, embed], k=60)
    assert fused[URL_A] == pytest.approx(1 / 61 + 1 / 63)
    assert fused[URL_B] == pytest.approx(1 / 62 + 1 / 61)
    assert fused[URL_C] == pytest.approx(1 / 63 + 1 / 62)
    assert rank_of(fused, URL_B) == 1 and rank_of(fused, URL_A) == 2


def test_recall_at_k_and_mrr_math() -> None:
    m = metrics([1, 3, 7, 20], ks=(1, 5, 10))
    assert m["n"] == 4
    assert m["recall@1"] == 0.25
    assert m["recall@5"] == 0.5
    assert m["recall@10"] == 0.75
    assert m["mrr"] == pytest.approx(round((1 + 1 / 3 + 1 / 7 + 1 / 20) / 4, 4))
    assert metrics([], ks=(1,)) == {"n": 0, "recall@1": None, "mrr": None}


# --- cache ----------------------------------------------------------------------------------------


def test_url_key_and_page_url() -> None:
    assert page_url("https://d.example.com/p.html#section-2") == "https://d.example.com/p.html"
    assert url_key(URL_A) == __import__("hashlib").sha256(URL_A.encode()).hexdigest()


def test_cache_dir_defaults_outside_the_repo(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DC_SOURCES_CACHE", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert source_cache.cache_dir() == tmp_path / ".cache" / "developercards" / "sources"
    monkeypatch.setenv("DC_SOURCES_CACHE", str(tmp_path / "c"))
    assert source_cache.cache_dir() == tmp_path / "c"


def test_fetch_sources_cache_hit_miss_and_failures(tmp_path: Path) -> None:
    calls: list[str] = []
    sleeps: list[float] = []

    def fetcher(url: str) -> dict:
        calls.append(url)
        if url == URL_C:
            raise source_cache.IngestError(f"HTTP error 404 fetching {url}")
        if url == URL_B:
            raise RuntimeError("parser blew up")
        return doc(url, "text of " + url)

    cache = SourceCache(tmp_path)
    first = fetch_sources([URL_A, URL_B, URL_C], cache=cache, fetcher=fetcher, delay_s=1.0, sleep=sleeps.append,
                          log=lambda _m: None)
    assert calls == [URL_A, URL_B, URL_C]
    assert sleeps == [1.0, 1.0]  # between network requests only
    assert first == {"fetched": 1, "cached": 0, "failed": 2, "skipped": 0}
    assert (tmp_path / f"{url_key(URL_A)}.json").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["pages"][URL_A]["status"] == "ok"
    assert manifest["pages"][URL_C] == {**manifest["pages"][URL_C], "status": "failed", "httpStatus": 404}
    assert manifest["pages"][URL_B]["status"] == "failed" and manifest["pages"][URL_B]["httpStatus"] is None
    assert "RuntimeError" in manifest["pages"][URL_B]["reason"]
    assert cache.load(URL_A)["chunks"][0]["text"] == "text of " + URL_A

    calls.clear()
    sleeps.clear()
    again = fetch_sources([URL_A, URL_B, URL_C], cache=cache, fetcher=fetcher, delay_s=1.0, sleep=sleeps.append,
                          log=lambda _m: None)
    assert calls == [] and sleeps == []
    assert again == {"fetched": 0, "cached": 1, "failed": 2, "skipped": 0}

    retried = fetch_sources([URL_C], cache=cache, fetcher=fetcher, delay_s=0, sleep=sleeps.append,
                            retry_failed=True, log=lambda _m: None)
    assert calls == [URL_C] and retried["failed"] == 1


def test_fetch_sources_max_pages_caps_network_fetches(tmp_path: Path) -> None:
    calls: list[str] = []
    result = fetch_sources(
        [URL_A, URL_B, URL_C], cache=SourceCache(tmp_path), fetcher=lambda u: calls.append(u) or doc(u, "x"),
        delay_s=0, sleep=lambda _s: None, max_pages=2, log=lambda _m: None,
    )
    assert calls == [URL_A, URL_B]
    assert result == {"fetched": 2, "cached": 0, "failed": 0, "skipped": 1}


def test_deck_urls_are_distinct_https_pages_in_ledger_order() -> None:
    urls = source_cache.deck_urls(["claude-ccdv-f"])
    assert urls and len(urls) == len(set(urls))
    assert all(u.startswith("https://") and "#" not in u for u in urls)


# --- embeddings -----------------------------------------------------------------------------------


class FakeEmbedder:
    """Deterministic bag-of-letters vectors: texts sharing words point the same way."""

    name = "fake"

    def __init__(self) -> None:
        self.calls = 0

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        out = []
        for text in texts:
            vec = [0.0] * 8
            for word in tokenize(text):
                vec[sum(map(ord, word)) % 8] += 1.0
            out.append(vec)
        return out


def test_embed_scores_pages_by_best_chunk_cosine() -> None:
    chunks = [Chunk(URL_A, "glacier archive"), Chunk(URL_B, "kms keys"), Chunk(URL_B, "unrelated lambda")]
    emb = FakeEmbedder()
    vectors = emb.embed([c.text for c in chunks])
    scores = score_pages_embed(emb.embed(["kms keys"])[0], vectors, chunks)
    assert rank_of(scores, URL_B) == 1
    assert scores[URL_B] == pytest.approx(1.0)


def test_embed_method_skipped_cleanly_without_fastembed(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "fastembed", None)  # import fastembed -> ImportError
    embedder, reason = retrieval.load_embedder()
    assert embedder is None
    assert "fastembed is not installed" in reason and "--extra embeddings" in reason


def _seed_cache(tmp_path: Path) -> SourceCache:
    cache = SourceCache(tmp_path / "cache")
    entries = [json.loads(line) for line in Path(retrieval.sources_path("claude-ccdv-f")).read_text().splitlines()]
    cards = {c["stableUid"]: c for c in retrieval.read_jsonl(retrieval.cards_path("claude-ccdv-f"))}
    pages = list(dict.fromkeys(page_url(e["url"]) for e in entries))[:12]
    for i, url in enumerate(pages):
        # each page carries the question of one card that cites it, so BM25 can find it
        uid = next(e["uid"] for e in entries if page_url(e["url"]) == url)
        cache.store(url, doc(url, cards[uid]["question"], f"filler page {i}"))
    cache.record_failure(list(dict.fromkeys(page_url(e["url"]) for e in entries))[12], "HTTP error 404", 404)
    return cache


def test_evaluate_reports_counts_and_skips_embed_without_embedder(tmp_path: Path) -> None:
    report = evaluate(
        ["claude-ccdv-f"], ks=(1, 5, 10), methods=("bm25", "embed", "hybrid"), cache=_seed_cache(tmp_path),
        embedder=None, embed_skip_reason="fastembed is not installed",
    )
    deck = report["decks"]["claude-ccdv-f"]
    assert deck["pages"]["cached"] == 12 and deck["pages"]["failed"] == 1
    assert deck["pairs"]["evaluated"] > 0
    assert deck["metrics"]["bm25"]["n"] == deck["pairs"]["evaluated"]
    assert deck["metrics"]["bm25"]["recall@10"] >= deck["metrics"]["bm25"]["recall@1"] > 0
    assert report["methods"]["embed"] == {"status": "skipped", "reason": "fastembed is not installed"}
    assert report["methods"]["hybrid"]["status"] == "skipped"
    assert "embed" not in deck["metrics"]
    assert report["overall"]["bm25"]["n"] == deck["pairs"]["evaluated"]
    # no page text in the report
    assert "filler page" not in json.dumps(report)


def test_evaluate_with_a_fake_embedder_runs_all_three_methods(tmp_path: Path) -> None:
    emb = FakeEmbedder()
    report = evaluate(
        ["claude-ccdv-f"], ks=(1, 5, 10), methods=("bm25", "embed", "hybrid"), cache=_seed_cache(tmp_path),
        embedder=emb, embed_skip_reason=None,
    )
    deck = report["decks"]["claude-ccdv-f"]
    for method in ("bm25", "embed", "hybrid"):
        assert report["methods"][method]["status"] == "ok"
        assert deck["metrics"][method]["n"] == deck["pairs"]["evaluated"]
    assert report["methods"]["embed"]["model"] == "fake"
    assert report["methods"]["hybrid"]["rrfK"] == 60
    assert emb.calls == 2  # chunks once, queries once


def test_cli_retrieval_writes_json_and_md(tmp_path: Path, monkeypatch, capsys) -> None:
    cache = _seed_cache(tmp_path)
    monkeypatch.setenv("DC_SOURCES_CACHE", str(cache.root))
    monkeypatch.setitem(sys.modules, "fastembed", None)
    out = tmp_path / "reports"
    code = main(["retrieval", "--deck", "claude-ccdv-f", "--k", "1,5,10", "--methods", "bm25,embed,hybrid",
                 "--out", str(out), "--date", "2026-10-01"])
    assert code == 0
    report = json.loads((out / "2026-10-01-retrieval.json").read_text())
    assert report["methods"]["embed"]["status"] == "skipped"
    md = (out / "2026-10-01-retrieval.md").read_text()
    assert "recall@5" in md and "not comparable" in md
    capsys.readouterr()


def test_cli_fetch_sources_uses_the_env_cache(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("DC_SOURCES_CACHE", str(tmp_path / "c"))
    seen: list[str] = []
    monkeypatch.setattr(source_cache, "ingest_page", lambda url: seen.append(url) or doc(url, "x"))
    monkeypatch.setattr(source_cache.time, "sleep", lambda _s: None)
    assert main(["fetch-sources", "--deck", "claude-ccdv-f", "--max-pages", "2", "--delay-s", "0"]) == 0
    assert len(seen) == 2
    assert len(list((tmp_path / "c").glob("*.json"))) == 3  # two pages + manifest
    assert "fetched 2" in capsys.readouterr().out


def test_cli_rejects_unknown_methods_and_ks(capsys) -> None:
    with pytest.raises(SystemExit):
        main(["retrieval", "--methods", "bm25,tfidf"])
    with pytest.raises(SystemExit):
        main(["retrieval", "--k", "0,5"])
    capsys.readouterr()


def test_fetch_uses_a_clear_user_agent_through_dc_ingest_redirect_rules() -> None:
    import urllib.request

    from dc_ingest.fetch import HttpsOnlyRedirectHandler

    request = urllib.request.Request(URL_A, headers={"User-Agent": "developercards-ingest/1.8.0"})
    request = source_cache.UserAgentHandler().https_request(request)
    assert request.get_header("User-agent") == source_cache.USER_AGENT
    assert source_cache.USER_AGENT.startswith("developercards-evals-retrieval/")
    opener = source_cache.build_opener(source_cache.UserAgentHandler())
    assert any(isinstance(h, HttpsOnlyRedirectHandler) for h in opener.handlers)

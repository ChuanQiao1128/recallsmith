"""V04: dc-evals embed-cards / semantic-dupes. No network, no model: the embedder is a
deterministic fake, the HTTP layer is a recording fake, the cache is a tmp directory."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import pytest

from dc_evals import embed_cards
from dc_evals.cli import main
from dc_evals.embed_cards import (
    DIM,
    MAX_PUSH_BATCH,
    MODEL,
    VECTOR_NOT_READY_MESSAGE,
    batches,
    canonical_text,
    distribution,
    l2_normalize,
    nearest_pairs,
    push_body,
    push_records,
    text_sha256,
)

TOKEN = "tok-v04-test-4f1d9c2b-never-print-me"
API = "https://api.example.com"
# Contract §5: the fixed digest V06 pins in C# as well.
S3_DIGEST = "657f8dad50869de985f7a8d76cbd7dca0cae9f9a49dba025459e40c2dfe94ebb"


# --- canonical text and textSha256 ----------------------------------------------------------------


def test_canonical_text_strips_both_parts_and_joins_with_a_blank_line() -> None:
    assert canonical_text("  What is S3?\n", "\tObject storage.  ") == "What is S3?\n\nObject storage."
    assert canonical_text("Q", None) == "Q\n\n"


def test_text_sha256_is_the_pinned_contract_digest() -> None:
    assert text_sha256("What is S3?", "Object storage.") == S3_DIGEST
    assert text_sha256(" What is S3? ", "Object storage.\n") == S3_DIGEST


def test_text_sha256_is_lower_hex_of_the_utf8_bytes() -> None:
    text = canonical_text("Qu'est-ce que S3 ?", "Stockage d'objets — é")
    assert text_sha256("Qu'est-ce que S3 ?", "Stockage d'objets — é") == hashlib.sha256(text.encode("utf-8")).hexdigest()


# --- normalisation --------------------------------------------------------------------------------


def test_l2_normalize_gives_a_unit_vector() -> None:
    out = l2_normalize([3.0, 4.0])
    assert out == pytest.approx([0.6, 0.8])
    assert math.fsum(x * x for x in out) == pytest.approx(1.0)


def test_l2_normalize_refuses_zero_and_non_finite_vectors() -> None:
    for bad in ([0.0, 0.0], [1.0, float("nan")], [float("inf"), 1.0]):
        with pytest.raises(ValueError):
            l2_normalize(bad)


# --- fakes ----------------------------------------------------------------------------------------


class FakeEmbedder:
    """Deterministic 384-dim vectors: a text maps to a fixed direction unless `directions` names it."""

    name = MODEL

    def __init__(self, directions: dict[str, list[float]] | None = None, scale: float = 5.0) -> None:
        self.directions = directions or {}
        self.scale = scale
        self.calls: list[list[str]] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        out = []
        for text in texts:
            if text in self.directions:
                base = self.directions[text]
                vec = base + [0.0] * (DIM - len(base))
            else:
                seed = int(hashlib.sha256(text.encode()).hexdigest(), 16)
                vec = [((seed >> (i % 200)) & 0xFF) - 127.5 for i in range(DIM)]
            out.append([x * self.scale for x in vec])  # not unit length: the command normalises
        return out


class FakeHttp:
    def __init__(self, responses: list[tuple[int, dict[str, Any]]] | None = None) -> None:
        self.responses = list(responses or [])
        self.requests: list[dict[str, Any]] = []

    def __call__(self, method: str, url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
        payload = json.loads(body)
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": payload,
                              "bytes": len(body)})
        if self.responses:
            status, data = self.responses.pop(0)
        else:
            status, data = 200, {"success": True, "data": {"upserted": len(payload["items"]), "unknownCards": [],
                                                            "staleText": []}}
        return status, json.dumps(data).encode()


def card(uid: str, question: str, explanation: str = "E.", slug: str = "demo-deck") -> dict[str, Any]:
    return {"deckSlug": slug, "stableUid": uid, "question": question, "explanation": explanation}


def write_deck(tmp_path: Path, cards: list[dict[str, Any]]) -> Path:
    path = tmp_path / "cards-demo-deck.jsonl"
    path.write_text("".join(json.dumps(c) + "\n" for c in cards), encoding="utf-8")
    return path


def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    cache = tmp_path / "embed-cache"
    monkeypatch.setenv("DC_EMBED_CACHE", str(cache))
    monkeypatch.delenv("DC_ADMIN_TOKEN", raising=False)
    return {"cache": str(cache)}


# Registered by call rather than with a decorator line: the wave's verify script reads a diff line
# starting "+@name.x" as an e-mail address.
env = pytest.fixture(_env, name="env")


def use_fakes(monkeypatch: pytest.MonkeyPatch, embedder: Any, http: FakeHttp | None = None) -> None:
    monkeypatch.setattr(embed_cards, "load_embedder", lambda: (embedder, None))
    if http is not None:
        monkeypatch.setattr(embed_cards, "http_send", http)


# --- embed-cards: the cache file ------------------------------------------------------------------


def test_embed_cards_writes_normalised_records_to_the_default_cache(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    deck = write_deck(tmp_path, [card("u1", "What is S3?", "Object storage."), card("u2", "What is EC2?")])
    fake = FakeEmbedder()
    use_fakes(monkeypatch, fake)

    assert main(["embed-cards", "--deck", str(deck)]) == 0

    out_file = Path(env["cache"]) / "demo-deck.jsonl"
    rows = [json.loads(line) for line in out_file.read_text().splitlines()]
    assert [r["stableUid"] for r in rows] == ["u1", "u2"]
    first = rows[0]
    assert set(first) == {"deckSlug", "stableUid", "textSha256", "model", "dim", "embedding"}
    assert first["deckSlug"] == "demo-deck"
    assert first["textSha256"] == S3_DIGEST
    assert (first["model"], first["dim"]) == ("BAAI/bge-small-en-v1.5", 384)
    assert len(first["embedding"]) == 384
    assert math.fsum(x * x for x in first["embedding"]) == pytest.approx(1.0)
    assert fake.calls == [["What is S3?\n\nObject storage.", "What is EC2?\n\nE."]]
    assert str(out_file) in capsys.readouterr().out


def test_embed_cards_out_overrides_the_cache_and_reuses_unchanged_vectors(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    out_file = tmp_path / "custom.jsonl"
    deck = write_deck(tmp_path, [card("u1", "Q1"), card("u2", "Q2")])
    use_fakes(monkeypatch, FakeEmbedder())
    assert main(["embed-cards", "--deck", str(deck), "--out", str(out_file)]) == 0
    assert not (Path(env["cache"]) / "demo-deck.jsonl").exists()

    deck = write_deck(tmp_path, [card("u1", "Q1"), card("u2", "Q2 edited")])
    second = FakeEmbedder()
    use_fakes(monkeypatch, second)
    assert main(["embed-cards", "--deck", str(deck), "--out", str(out_file)]) == 0
    assert second.calls == [["Q2 edited\n\nE."]]  # u1's text is unchanged, its vector is reused
    rows = [json.loads(line) for line in out_file.read_text().splitlines()]
    assert rows[1]["textSha256"] == text_sha256("Q2 edited", "E.")


def test_embed_cards_reads_the_exported_jsonl_for_a_known_deck_slug(
    env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeEmbedder()
    use_fakes(monkeypatch, fake)
    assert main(["embed-cards", "--deck", "aws-saa-c03"]) == 0
    rows = (Path(env["cache"]) / "aws-saa-c03.jsonl").read_text().splitlines()
    exported = (embed_cards.cards_path("aws-saa-c03")).read_text().splitlines()
    assert len(rows) == len([line for line in exported if line.strip()])


def test_embed_cards_without_fastembed_is_a_clear_usage_error(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    deck = write_deck(tmp_path, [card("u1", "Q1")])
    monkeypatch.setattr(embed_cards, "load_embedder",
                        lambda: (None, "fastembed is not installed (cd evals && uv sync --extra embeddings)"))
    assert main(["embed-cards", "--deck", str(deck)]) == 2
    assert "uv sync --extra embeddings" in capsys.readouterr().err


def test_embed_cards_refuses_a_wrong_dimension(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class Short:
        name = MODEL

        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[1.0, 2.0] for _ in texts]

    deck = write_deck(tmp_path, [card("u1", "Q1")])
    use_fakes(monkeypatch, Short())
    assert main(["embed-cards", "--deck", str(deck)]) == 1
    assert "384" in capsys.readouterr().err


def test_embed_cards_rejects_an_unknown_deck(env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["embed-cards", "--deck", "no-such-deck-v04"]) == 2
    assert "no-such-deck-v04" in capsys.readouterr().err


# --- batching and the request body ----------------------------------------------------------------


def test_batches_are_at_most_100() -> None:
    sizes = [len(b) for b in batches(list(range(250)))]
    assert sizes == [100, 100, 50]
    assert MAX_PUSH_BATCH == 100
    assert list(batches([])) == []


def worst_case_record(i: int) -> dict[str, Any]:
    # The longest repr a float64 of a float32 takes in [-1, 1]: 23 characters.
    return {
        "deckSlug": "d" * 64, "stableUid": f"{i:03d}" + "u" * 125, "textSha256": "f" * 64, "model": MODEL,
        "dim": DIM, "embedding": [-1.2345678901234567e-05] * DIM,
    }


def test_a_full_batch_of_full_precision_vectors_serialises_under_one_megabyte() -> None:
    body = push_body([worst_case_record(i) for i in range(MAX_PUSH_BATCH)])
    encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
    assert len(encoded) < 1_000_000


def test_push_sends_put_batches_with_the_contract_shape() -> None:
    records = [{"deckSlug": "demo-deck", "stableUid": f"u{i}", "textSha256": "a" * 64, "model": MODEL, "dim": DIM,
                "embedding": [0.5] * DIM} for i in range(150)]
    http = FakeHttp()
    totals = push_records(records, api_base=API + "/", token=TOKEN, send=http)

    assert [r["method"] for r in http.requests] == ["PUT", "PUT"]
    assert {r["url"] for r in http.requests} == {"https://api.example.com/api/v1/admin/card-embeddings"}
    first = http.requests[0]
    assert first["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert first["headers"]["Content-Type"] == "application/json"
    assert set(first["body"]) == {"model", "dim", "items"}
    assert (first["body"]["model"], first["body"]["dim"]) == (MODEL, DIM)
    assert [len(r["body"]["items"]) for r in http.requests] == [100, 50]
    assert set(first["body"]["items"][0]) == {"deckSlug", "stableUid", "textSha256", "embedding"}
    assert all(r["bytes"] < 1_000_000 for r in http.requests)
    assert totals == {"batches": 2, "sent": 150, "upserted": 150, "unknownCards": [], "staleText": []}


def test_push_sums_the_counts_across_batches() -> None:
    records = [{"deckSlug": "d", "stableUid": f"u{i}", "textSha256": "a" * 64, "model": MODEL, "dim": DIM,
                "embedding": [0.5] * DIM} for i in range(120)]
    http = FakeHttp([
        (200, {"success": True, "data": {"upserted": 98, "unknownCards": ["u7"], "staleText": ["u9"]}}),
        (200, {"success": True, "data": {"upserted": 19, "unknownCards": [], "staleText": ["u101"]}}),
    ])
    totals = push_records(records, api_base=API, token=TOKEN, send=http)
    assert totals["upserted"] == 117
    assert totals["unknownCards"] == ["u7"]
    assert totals["staleText"] == ["u9", "u101"]


# --- the push command -----------------------------------------------------------------------------


def run_push(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, http: FakeHttp, *extra: str) -> int:
    deck = write_deck(tmp_path, [card("u1", "Q1"), card("u2", "Q2")])
    use_fakes(monkeypatch, FakeEmbedder(), http)
    return main(["embed-cards", "--deck", str(deck), "--push", "--api-base", API, *extra])


def test_push_prints_the_counts(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    http = FakeHttp([(200, {"success": True, "data": {"upserted": 1, "unknownCards": ["u2"], "staleText": []}})])
    assert run_push(tmp_path, monkeypatch, http) == 0
    out = capsys.readouterr().out
    assert "upserted 1" in out and "unknownCards 1" in out and "staleText 0" in out
    assert "u2" in out


def test_push_refuses_to_run_without_the_token_and_embeds_nothing(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    http = FakeHttp()
    deck = write_deck(tmp_path, [card("u1", "Q1")])
    fake = FakeEmbedder()
    use_fakes(monkeypatch, fake, http)
    assert main(["embed-cards", "--deck", str(deck), "--push", "--api-base", API]) == 2
    assert "DC_ADMIN_TOKEN" in capsys.readouterr().err
    assert http.requests == [] and fake.calls == []


def test_push_needs_an_api_base(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    deck = write_deck(tmp_path, [card("u1", "Q1")])
    use_fakes(monkeypatch, FakeEmbedder(), FakeHttp())
    with pytest.raises(SystemExit) as exc:
        main(["embed-cards", "--deck", str(deck), "--push"])
    assert exc.value.code == 2


def test_push_refuses_plain_http_to_a_remote_host(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    http = FakeHttp()
    deck = write_deck(tmp_path, [card("u1", "Q1")])
    use_fakes(monkeypatch, FakeEmbedder(), http)
    assert main(["embed-cards", "--deck", str(deck), "--push", "--api-base", "http://api.example.com"]) == 2
    assert http.requests == []
    assert "https" in capsys.readouterr().err
    assert main(["embed-cards", "--deck", str(deck), "--push", "--api-base", "http://localhost:5000"]) == 0
    assert http.requests[0]["url"] == "http://localhost:5000/api/v1/admin/card-embeddings"


def test_vector_not_ready_exits_3_with_the_owner_step(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    http = FakeHttp([(503, {"success": False, "error": {"code": "VECTOR_NOT_READY", "message": "no vector"}})])
    assert run_push(tmp_path, monkeypatch, http) == 3
    err = capsys.readouterr().err
    assert VECTOR_NOT_READY_MESSAGE in err
    assert VECTOR_NOT_READY_MESSAGE == "the owner must CREATE EXTENSION vector and re-run the migration"
    assert len(http.requests) == 1  # stops at the first batch


def test_other_http_errors_exit_1(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    http = FakeHttp([(400, {"success": False, "error": {"code": "VALIDATION_ERROR", "message": "wrong dim"}})])
    assert run_push(tmp_path, monkeypatch, http) == 1
    err = capsys.readouterr().err
    assert "400" in err and "VALIDATION_ERROR" in err


def test_the_token_is_never_printed(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DC_ADMIN_TOKEN", TOKEN)
    ok = FakeHttp()
    assert run_push(tmp_path, monkeypatch, ok) == 0
    # A server that echoes the header back in its error message.
    echo = FakeHttp([(401, {"success": False, "error": {"code": "UNAUTHORIZED", "message": f"bad Bearer {TOKEN}"}})])
    assert run_push(tmp_path, monkeypatch, echo) == 1

    def boom(method: str, url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
        raise embed_cards.PushError(f"connection reset while sending {headers['Authorization']}")

    use_fakes(monkeypatch, FakeEmbedder(), boom)
    deck = write_deck(tmp_path, [card("u1", "Q1")])
    assert main(["embed-cards", "--deck", str(deck), "--push", "--api-base", API]) == 1

    captured = capsys.readouterr()
    assert TOKEN not in captured.out and TOKEN not in captured.err
    assert "[redacted]" in captured.err
    for path in Path(env["cache"]).rglob("*"):
        if path.is_file():
            assert TOKEN not in path.read_text()


# --- semantic-dupes -------------------------------------------------------------------------------


def test_nearest_pairs_ranks_each_unordered_pair_once_highest_first() -> None:
    ids = ["a", "b", "c", "d"]
    vectors = [l2_normalize(v) for v in ([1.0, 0.0, 0.0], [0.99, 0.141, 0.0], [0.9, 0.436, 0.0], [0.0, 0.0, 1.0])]
    pairs = nearest_pairs(ids, vectors, min_cosine=0.85, limit=50)
    assert [(p["a"], p["b"]) for p in pairs] == [("a", "b"), ("b", "c"), ("a", "c")]
    assert pairs[0]["cosine"] > pairs[1]["cosine"] > pairs[2]["cosine"] >= 0.85
    assert nearest_pairs(ids, vectors, min_cosine=0.85, limit=2) == pairs[:2]
    assert nearest_pairs(ids, vectors, min_cosine=0.999, limit=50) == []


def test_distribution_reports_each_cards_nearest_neighbour() -> None:
    ids = ["a", "b", "c"]
    vectors = [l2_normalize(v) for v in ([1.0, 0.0], [1.0, 0.1], [0.0, 1.0])]
    dist = distribution(ids, vectors, min_cosine=0.9)
    assert dist["cards"] == 3
    assert dist["cardsAtOrAboveThreshold"] == 2
    assert dist["nearestNeighbourCosine"]["max"] == pytest.approx(0.995, abs=1e-3)
    assert sum(b["cards"] for b in dist["buckets"]) == 3


def test_semantic_dupes_writes_a_question_only_report(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    cards = [
        card("u1", "What is S3?", "Object storage secret explanation."),
        card("u2", "What is Amazon S3?", "Object storage secret explanation."),
        card("u3", "What is Lambda?", "Functions."),
    ]
    texts = [canonical_text(c["question"], c["explanation"]) for c in cards]
    fake = FakeEmbedder({texts[0]: [1.0, 0.0, 0.0], texts[1]: [0.98, 0.2, 0.0], texts[2]: [0.0, 0.0, 1.0]})
    use_fakes(monkeypatch, fake)
    deck = write_deck(tmp_path, cards)
    out_dir = tmp_path / "reports"

    assert main(["semantic-dupes", "--deck", str(deck), "--out", str(out_dir), "--date", "2026-10-01"]) == 0

    report = json.loads((out_dir / "2026-10-01-semantic-dupes-demo-deck.json").read_text())
    assert report["deckSlug"] == "demo-deck" and report["minCosine"] == 0.9 and report["model"] == MODEL
    assert len(report["pairs"]) == 1
    pair = report["pairs"][0]
    assert {pair["a"]["stableUid"], pair["b"]["stableUid"]} == {"u1", "u2"}
    assert set(pair["a"]) == {"stableUid", "question"}
    assert pair["cosine"] >= 0.9
    assert report["distribution"]["cards"] == 3
    md = (out_dir / "2026-10-01-semantic-dupes-demo-deck.md").read_text()
    assert "What is Amazon S3?" in md
    assert "secret explanation" not in md and "secret explanation" not in json.dumps(report)

    # Reuses the cached vectors: a second run embeds nothing.
    again = FakeEmbedder()
    use_fakes(monkeypatch, again)
    assert main(["semantic-dupes", "--deck", str(deck), "--out", str(out_dir), "--date", "2026-10-01",
                 "--min-cosine", "0.5"]) == 0
    assert again.calls == []


def test_semantic_dupes_caps_the_report_at_50_pairs(
    tmp_path: Path, env: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    cards = [card(f"u{i:02d}", f"Near duplicate question {i}") for i in range(12)]  # 66 pairs
    texts = [canonical_text(c["question"], c["explanation"]) for c in cards]
    fake = FakeEmbedder({t: [1.0, 0.001 * i] for i, t in enumerate(texts)})
    use_fakes(monkeypatch, fake)
    deck = write_deck(tmp_path, cards)
    assert main(["semantic-dupes", "--deck", str(deck), "--out", str(tmp_path), "--date", "2026-10-01"]) == 0
    report = json.loads((tmp_path / "2026-10-01-semantic-dupes-demo-deck.json").read_text())
    assert len(report["pairs"]) == 50
    assert report["pairsAtOrAboveThreshold"] == 66
    cosines = [p["cosine"] for p in report["pairs"]]
    assert cosines == sorted(cosines, reverse=True)

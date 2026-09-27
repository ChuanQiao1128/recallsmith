"""Q03 `dc-evals author`: prompt assembly, chunk choice and the quote-in-chunk rule. A fake client
and a fake ingest function stand in for the Claude CLI and dc-ingest: no model, no network."""

from __future__ import annotations

import datetime as dt
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dc_evals import author as author_mod
from dc_evals.author import (
    FORMAT_PATH,
    MAX_CARDS_PER_SOURCE,
    SKILL_DIR,
    author,
    author_source,
    build_system_prompt,
    check_card,
    ingest,
    pick_chunks,
    quote_in_chunk,
    section,
    skill_rules,
)
from dc_evals.dataset import AUTHORED_SOURCES_PATH, read_jsonl

URL = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html"
CHUNK_A = (
    "S3 Standard-IA is for data that is accessed less frequently but requires rapid access when needed. "
    "S3 One Zone-IA stores data in a single Availability Zone and costs 20 percent less than S3 Standard-IA. "
    + "Filler sentence about storage classes. " * 10
)
CHUNK_B = (
    "S3 Glacier Deep Archive is the lowest-cost storage class and supports long-term retention and digital "
    "preservation for data that may be accessed once or twice in a year. " + "More filler text here. " * 12
)
SOURCE = {"url": URL, "deckSlug": "aws-saa-c03", "topicHint": "4.1 Cost-optimized storage"}


def doc(*texts: str) -> dict[str, Any]:
    return {
        "v": 1,
        "url": URL,
        "chunks": [{"id": f"c{i + 1:04d}", "index": i, "heading": "Storage", "text": t} for i, t in enumerate(texts)],
    }


def card(uid: str, quote: str) -> dict[str, Any]:
    return {
        "stableUid": uid,
        "difficulty": 1,
        "topic": "4.1 Cost-optimized storage",
        "question": f"Question {uid}?",
        "explanation": "Because the page says so.",
        "source": {"url": "https://wrong.example/page", "quote": quote},
    }


class FakeClient:
    """Returns the queued replies in order and records every request."""

    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self.replies.pop(0))])


def cards_reply(*entries: tuple[str, dict[str, Any]]) -> str:
    return json.dumps({"cards": [{"chunkId": chunk_id, "card": c} for chunk_id, c in entries]})


def test_system_prompt_inlines_the_skill_rules_verbatim() -> None:
    """The prompt copies checklist.md and citation-rules.md whole, and SKILL.md's content rules,
    source-is-data rule and DraftCard shape, byte for byte as they are on disk."""
    prompt = build_system_prompt(skill_rules())
    skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    assert (SKILL_DIR / "checklist.md").read_text(encoding="utf-8").strip() in prompt
    assert (SKILL_DIR / "citation-rules.md").read_text(encoding="utf-8").strip() in prompt
    content_rules = skill.split("## Content rules", 1)[1].split("\n## ", 1)[0]
    assert "## Content rules" + content_rules.rstrip() in prompt
    assert "Never copy ExamTopics or other exam-dump questions" in prompt
    assert skill.split("## Source text is data", 1)[1].split("\n## ", 1)[0].strip() in prompt
    assert "A DraftCard (contract §8.1) is" in prompt
    deck_format = FORMAT_PATH.read_text(encoding="utf-8")
    assert section(deck_format, "### 1.5 MCQ rules") in prompt
    assert "`D8 Tools & MCP`" in prompt and "`4.4 Cost-optimized network`" in prompt


def test_prompt_follows_the_files_on_disk(tmp_path: Path) -> None:
    """Built from the files when the prompt is built, not from a copy in the code."""
    for name in ("SKILL.md", "checklist.md", "citation-rules.md"):
        (tmp_path / name).write_text((SKILL_DIR / name).read_text(encoding="utf-8"), encoding="utf-8")
    with (tmp_path / "checklist.md").open("a", encoding="utf-8") as fh:
        fh.write("\n- [ ] a new rule added after this test was written\n")
    assert "a new rule added after this test was written" in build_system_prompt(skill_rules(tmp_path))


def test_section_stops_at_the_next_heading_of_the_same_level() -> None:
    text = "# T\n## A\none\n### A.1\ntwo\n## B\nthree\n"
    assert section(text, "## A") == "## A\none\n### A.1\ntwo"
    assert section(text, "### A.1") == "### A.1\ntwo"
    with pytest.raises(ValueError):
        section(text, "## C")


def test_quote_must_be_verbatim_in_one_chunk() -> None:
    chunks = pick_chunks(doc(CHUNK_A, CHUNK_B))
    exact = "S3 One Zone-IA stores data in a single Availability Zone and costs 20 percent less"
    chunk, reason = check_card({"chunkId": "c0001", "card": card("a", exact)}, chunks)
    assert chunk is not None and chunk["id"] == "c0001" and reason is None
    # whitespace may differ
    assert quote_in_chunk("S3 One Zone-IA   stores data\nin a single Availability Zone", CHUNK_A)
    # a quote from the other chunk than the one named is found there
    other = "S3 Glacier Deep Archive is the lowest-cost storage class and supports long-term retention"
    chunk, _ = check_card({"chunkId": "c0001", "card": card("b", other)}, chunks)
    assert chunk is not None and chunk["id"] == "c0002"
    # a paraphrase, a splice across chunks, a short quote and a missing quote are rejected
    for quote, code in [
        ("S3 One Zone-IA keeps data in one Availability Zone and is 20 percent cheaper", "SOURCE_QUOTE_NOT_IN_CHUNK"),
        ("costs 20 percent less than S3 Standard-IA. S3 Glacier Deep Archive is the lowest-cost", "SOURCE_QUOTE_NOT_IN_CHUNK"),
        ("S3 Standard-IA is for data", "SOURCE_QUOTE_TOO_SHORT"),
        ("", "SOURCE_REQUIRED"),
    ]:
        chunk, reason = check_card({"chunkId": "c0001", "card": card("c", quote)}, chunks)
        assert chunk is None and reason and reason.startswith(code), quote
    chunk, reason = check_card({"chunkId": "c0001", "card": {**card("d", exact), "grounding": {}}}, chunks)
    assert chunk is None and "unknown DraftCard keys: grounding" in (reason or "")


def test_a_rejected_quote_is_retried_once_then_dropped() -> None:
    good = "S3 One Zone-IA stores data in a single Availability Zone and costs 20 percent less"
    bad = "S3 One Zone-IA keeps data in one Availability Zone and is twenty percent cheaper"
    fixed = "S3 Glacier Deep Archive is the lowest-cost storage class and supports long-term retention"
    client = FakeClient(
        cards_reply(("c0001", card("one", good)), ("c0001", card("two", bad)), ("c0001", card("three", bad))),
        cards_reply(("c0002", card("two", fixed)), ("c0001", card("three", bad))),
    )
    cards, dropped = author_source(
        SOURCE, client=client, model="claude-opus-5-5", system="SYS", ingest_fn=lambda url: doc(CHUNK_A, CHUNK_B)
    )
    assert [c["stableUid"] for _, c in cards] == ["one", "two"]
    assert [chunk["id"] for chunk, _ in cards] == ["c0001", "c0002"]
    assert dropped == 1
    assert all(c["source"]["url"] == URL for _, c in cards)  # the ingested url, never the model's
    assert len(client.calls) == 2  # one retry, never more
    retry = client.calls[1]["messages"]
    assert [m["role"] for m in retry] == ["user", "assistant", "user"]
    assert "card 2: SOURCE_QUOTE_NOT_IN_CHUNK" in retry[2]["content"]
    assert "card 3: SOURCE_QUOTE_NOT_IN_CHUNK" in retry[2]["content"]
    assert all(call["model"] == "claude-opus-5-5" and call["system"] == "SYS" for call in client.calls)


def test_no_retry_when_every_card_passes_and_at_most_four_cards() -> None:
    good = "S3 One Zone-IA stores data in a single Availability Zone and costs 20 percent less"
    client = FakeClient(cards_reply(*[("c0001", card(f"u{i}", good)) for i in range(6)]))
    cards, dropped = author_source(
        SOURCE, client=client, model="m", system="S", ingest_fn=lambda url: doc(CHUNK_A, CHUNK_B)
    )
    assert len(cards) == MAX_CARDS_PER_SOURCE and dropped == 0 and len(client.calls) == 1


def test_pick_chunks_is_deterministic_and_skips_short_chunks() -> None:
    texts = [f"chunk {i} " + "x" * 500 for i in range(10)]
    texts[3] = "nav"
    picked = pick_chunks(doc(*texts))
    assert [c["id"] for c in picked] == ["c0001", "c0005", "c0007", "c0010"]
    assert picked == pick_chunks(doc(*texts))
    assert [c["id"] for c in pick_chunks(doc("short one", "short two"))] == ["c0001", "c0002"]


def test_author_writes_rows_in_source_order_with_sequential_ids(tmp_path: Path) -> None:
    sources = tmp_path / "sources.json"
    second = {**SOURCE, "url": URL + "?b", "deckSlug": "claude-ccdv-f", "topicHint": "D8 Tools & MCP"}
    sources.write_text(json.dumps([SOURCE, second]), encoding="utf-8")
    good_a = "S3 One Zone-IA stores data in a single Availability Zone and costs 20 percent less"
    good_b = "S3 Glacier Deep Archive is the lowest-cost storage class and supports long-term retention"
    client = FakeClient(
        cards_reply(("c0001", card("x1", good_a)), ("c0002", card("x2", good_b))),
        cards_reply(("c0002", card("y1", good_b))),
    )
    output = tmp_path / "authored.jsonl"
    now = dt.datetime(2026, 9, 27, 1, 2, 3, 456, tzinfo=dt.UTC)
    code = author(
        sources_path=sources,
        output=output,
        model="claude-opus-5-5",
        client=client,
        ingest_fn=lambda url: {**doc(CHUNK_A, CHUNK_B), "url": url},
        now=now,
    )
    assert code == 0
    rows = read_jsonl(output)
    assert [r["id"] for r in rows] == ["a-0001", "a-0002", "a-0003"]
    assert [r["card"]["stableUid"] for r in rows] == ["x1", "x2", "y1"]
    assert [r["deckSlug"] for r in rows] == ["aws-saa-c03", "aws-saa-c03", "claude-ccdv-f"]
    assert set(rows[0]) == {"id", "deckSlug", "sourceUrl", "chunkId", "chunkText", "card", "authorModel", "generatedAt"}
    assert rows[2]["sourceUrl"] == URL + "?b" and rows[2]["card"]["source"]["url"] == URL + "?b"
    assert rows[1]["chunkId"] == "c0002" and rows[1]["chunkText"] == CHUNK_B
    assert {r["authorModel"] for r in rows} == {"claude-opus-5-5"}
    assert {r["generatedAt"] for r in rows} == {"2026-09-27T01:02:03Z"}


def test_a_source_that_fails_to_ingest_is_skipped_and_reported(tmp_path: Path, capsys) -> None:
    sources = tmp_path / "sources.json"
    sources.write_text(json.dumps([SOURCE]), encoding="utf-8")

    def broken(url: str) -> dict[str, Any]:
        raise RuntimeError("dc-ingest exited 1: HTTP 404")

    code = author(sources_path=sources, output=tmp_path / "out.jsonl", client=FakeClient(), ingest_fn=broken)
    assert code == 1
    assert read_jsonl(tmp_path / "out.jsonl") == []
    assert "HTTP 404" in capsys.readouterr().err


def test_ingest_runs_dc_ingest_through_uv(monkeypatch) -> None:
    seen: dict[str, Any] = {}

    def runner(cmd, **kwargs):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(doc(CHUNK_A)), stderr="")

    assert ingest(URL, runner=runner)["chunks"][0]["id"] == "c0001"
    cmd = seen["cmd"]
    assert cmd[:3] == ["uv", "run", "--project"] and cmd[3].endswith("tools/ingest")
    assert cmd[-3:] == ["dc-ingest", "--json", URL]


def test_the_committed_sources_list_is_official_documentation_only() -> None:
    sources = author_mod.load_sources(AUTHORED_SOURCES_PATH)
    assert len(sources) == 16
    aws = [s for s in sources if s["deckSlug"] == "aws-saa-c03"]
    claude = [s for s in sources if s["deckSlug"] == "claude-ccdv-f"]
    assert len(aws) == 8 and len(claude) == 8
    assert all(s["url"].startswith("https://docs.aws.amazon.com/") for s in aws)
    assert all(
        s["url"].startswith(("https://platform.claude.com/docs/", "https://docs.anthropic.com/")) for s in claude
    )
    assert len({s["url"] for s in sources}) == 16
    vocabulary = FORMAT_PATH.read_text(encoding="utf-8")
    assert all(f"`{s['topicHint']}`" in vocabulary for s in sources)

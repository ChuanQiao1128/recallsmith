from __future__ import annotations

from typing import Any

from conftest import FakeLlm, FakeUsage, finding, reply, review_json

from ai_qa.prompts import SYSTEM_PROMPT
from dc_evals.dataset import load_dataset
from dc_evals.runner import content_sha256, qa_card, run_eval


def rows(n: int) -> list[dict[str, Any]]:
    return load_dataset()[:n]


def test_run_with_fake_llm_goes_through_review_card(settings) -> None:
    sample = rows(8)
    scripted = {
        row["sourceUid"]: [finding("blocker", "incorrect_answer", message=f"defect in {row['id']}")]
        if row["defect"]
        else []
        for row in sample
    }

    def respond(uid: str, kwargs: dict[str, Any]):
        return reply(review_json(*scripted[uid]), request_id=f"req_{uid}")

    fake = FakeLlm(respond)
    records = run_eval(sample, client=fake, settings=settings, review_date="2026-09-27", concurrency=3)

    assert len(fake.calls) == len(sample)
    for call in fake.calls:
        assert call["system"][0]["type"] == "text"
        assert call["system"][0]["text"] == SYSTEM_PROMPT
        assert call["model"] == "claude-opus-5"
        user = call["messages"][0]["content"]
        assert user.startswith("Review date: 2026-09-27\n<card>\n")
        assert "cardId" not in user and "contentSha256" not in user

    assert [r["id"] for r in records] == [row["id"] for row in sample]
    for row, record in zip(sample, records, strict=True):
        assert list(record) == [
            "type",
            "id",
            "defect",
            "status",
            "errorCode",
            "findings",
            "usage",
            "latencyMs",
            "requestId",
            "estimatedCostUsd",
        ]
        assert record["type"] == "item"
        assert record["defect"] == row["defect"]
        assert record["status"] == "done"
        assert record["requestId"] == f"req_{row['sourceUid']}"
        expected = scripted[row["sourceUid"]]
        assert [(f["severity"], f["category"], f["message"]) for f in record["findings"]] == [
            (f["severity"], f["category"], f["message"]) for f in expected
        ]
        assert all(f["cardId"] == int(row["id"][2:]) for f in record["findings"])


def test_qa_card_adds_card_id_and_content_hash() -> None:
    row = rows(1)[0]
    card = qa_card(row)
    assert card["cardId"] == int(row["id"][2:])
    assert len(card["contentSha256"]) == 64 and card["contentSha256"] == content_sha256(row["card"])
    assert {k: v for k, v in card.items() if k not in ("cardId", "contentSha256")} == row["card"]


def test_run_stops_at_the_cost_ceiling(settings) -> None:
    sample = rows(10)
    # 200,000 output tokens at $25/MTok = $5.00 per card.
    fake = FakeLlm(lambda uid, kwargs: reply(review_json(), usage=FakeUsage(input_tokens=0, output_tokens=200_000)))
    records = run_eval(sample, client=fake, settings=settings, review_date="2026-09-27", concurrency=1, max_cost_usd=12.0)
    assert [r["estimatedCostUsd"] for r in records] == [5.0, 5.0, 5.0]
    assert [r["id"] for r in records] == [row["id"] for row in sample[:3]]
    assert len(fake.calls) == 3

    fake = FakeLlm(lambda uid, kwargs: reply(review_json(), usage=FakeUsage(input_tokens=0, output_tokens=200_000)))
    records = run_eval(sample, client=fake, settings=settings, review_date="2026-09-27", concurrency=4, max_cost_usd=12.0)
    # Up to `concurrency` rows are in flight when the ceiling is reached; nothing new is submitted after.
    assert 3 <= len(records) <= 3 + 3
    assert [r["id"] for r in records] == [row["id"] for row in sample[: len(records)]]

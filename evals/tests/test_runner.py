from __future__ import annotations

from typing import Any

import pytest
from conftest import FakeLlm, FakeUsage, finding, reply, review_json

from ai_qa import providers
from ai_qa.prompts import SYSTEM_PROMPT
from ai_qa.settings import load_settings
from dc_evals.dataset import DATASETS, load_dataset
from dc_evals.runner import MODEL_MISMATCH, content_sha256, model_matches, qa_card, run_eval


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
        # X04 (ai-agent-12) adds rep, tier, the structured-output flag and the served model.
        assert list(record) == [
            "type",
            "id",
            "rep",
            "defect",
            "tier",
            "status",
            "errorCode",
            "findings",
            "usage",
            "latencyMs",
            "requestId",
            "estimatedCostUsd",
            "structured",
            "servedModel",
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


def test_a_row_served_by_another_model_fails(settings) -> None:
    """ai-agent-12: findings from a model other than the requested one are not evidence."""
    sample = rows(3)
    served = {sample[0]["sourceUid"]: "claude-opus-5-20260901", sample[1]["sourceUid"]: "claude-haiku-4-5"}

    def respond(uid: str, kwargs: dict[str, Any]):
        return reply(review_json(finding("blocker", "incorrect_answer")), model=served.get(uid, "claude-opus-5"))

    records = run_eval(sample, client=FakeLlm(respond), settings=settings, review_date="2026-09-27")
    assert [r["status"] for r in records] == ["done", "error", "done"]
    assert records[1]["errorCode"] == MODEL_MISMATCH and records[1]["findings"] == []
    assert [r["servedModel"] for r in records] == ["claude-opus-5-20260901", "claude-haiku-4-5", "claude-opus-5"]


@pytest.mark.parametrize(
    ("requested", "served", "matches"),
    [
        ("claude-opus-5", "claude-opus-5", True),
        ("claude-opus-5", "claude-opus-5-20260901", True),
        ("claude-opus-5", "claude-opus-5-5", False),
        ("claude-opus-5", "claude-sonnet-5", False),
        ("anthropic.claude-opus-5", "claude-opus-5", True),
        ("anthropic.claude-opus-5", "anthropic.claude-opus-5", True),
        ("us.anthropic.claude-opus-5-v1:0", "claude-opus-5", True),
    ],
)
def test_model_matches(requested: str, served: str, matches: bool) -> None:
    assert model_matches(requested, served) is matches


def test_each_item_records_whether_it_used_structured_outputs(settings) -> None:
    """ai-agent-12: the process-wide structured-output fallback can switch off mid-run; every item
    records what it actually used."""
    sample = rows(2)
    fake = FakeLlm(lambda uid, kwargs: reply(review_json()))
    first = run_eval(sample[:1], client=fake, settings=settings, review_date="2026-09-27")
    providers.disable_structured_outputs()
    second = run_eval(sample[1:], client=fake, settings=settings, review_date="2026-09-27")
    assert first[0]["structured"] is True and second[0]["structured"] is False
    assert "format" in fake.calls[0]["output_config"] and "format" not in fake.calls[1]["output_config"]

    off = load_settings({"AI_PROVIDER": "anthropic", "AI_MODEL": "claude-opus-5", "AI_STRUCTURED_OUTPUTS": "off"})
    assert run_eval(sample[:1], client=fake, settings=off, review_date="2026-09-27")[0]["structured"] is False


def test_records_carry_rep_and_tier(settings) -> None:
    sample = load_dataset(DATASETS["v2"].path)[:4]
    fake = FakeLlm(lambda uid, kwargs: reply(review_json()))
    records = run_eval(sample, client=fake, settings=settings, review_date="2026-09-27", rep=3)
    assert [r["rep"] for r in records] == [3, 3, 3, 3]
    assert [r["tier"] for r in records] == [row["tier"] for row in sample]

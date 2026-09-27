"""FakeLlm (mirrors services/ai-qa/tests/conftest.py; packages never import each other's tests)
and helpers. No test in this package calls a model or constructs a real client."""

from __future__ import annotations

import copy
import json
import re
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import pytest

from ai_qa import providers
from ai_qa.settings import Settings, load_settings
from dc_evals.dataset import DATASETS, file_sha256, load_dataset
from dc_evals.report import run_header

AI_ENV_KEYS = (
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_BEDROCK_REGION",
    "AI_EFFORT",
    "AI_STRUCTURED_OUTPUTS",
    "AI_QA_ENABLED",
    "AI_PRICE_INPUT_PER_MTOK",
    "AI_PRICE_OUTPUT_PER_MTOK",
)


@dataclass
class FakeBlock:
    type: str
    text: str | None = None
    thinking: str | None = None
    signature: str | None = None


@dataclass
class FakeUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


@dataclass
class FakeResponse:
    content: list[FakeBlock]
    stop_reason: str | None
    usage: FakeUsage
    _request_id: str | None
    stop_details: Any = None
    model: str | None = "claude-opus-5"


def reply(
    text: str,
    *,
    usage: FakeUsage | None = None,
    request_id: str = "req_test_1",
    model: str | None = "claude-opus-5",
) -> FakeResponse:
    return FakeResponse(
        content=[FakeBlock(type="thinking", thinking="(reasoning)", signature="sig"), FakeBlock(type="text", text=text)],
        stop_reason="end_turn",
        usage=usage or FakeUsage(input_tokens=100, output_tokens=20),
        _request_id=request_id,
        model=model,
    )


def review_json(*findings: dict[str, Any]) -> str:
    return json.dumps({"findings": list(findings)})


def finding(severity: str = "major", category: str = "ambiguous_stem", message: str = "m", fix: str | None = "f"):
    return {"severity": severity, "category": category, "message": message, "suggestedFix": fix}


_UID = re.compile(r'"stableUid":\s*"([^"]+)"')


class FakeLlm:
    """The slice of the anthropic client review_card uses. `respond(stable_uid, kwargs)` returns
    the FakeResponse for a call; calls are recorded (thread-safe: the runner uses a pool)."""

    def __init__(self, respond: Callable[[str, dict[str, Any]], FakeResponse]) -> None:
        self.respond = respond
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        self._lock = threading.Lock()

    def create(self, **kwargs: Any) -> FakeResponse:
        with self._lock:
            self.calls.append(copy.deepcopy(kwargs))
        user = kwargs["messages"][0]["content"]
        match = _UID.search(user)
        assert match, "the user turn carries the card JSON"
        return self.respond(match.group(1), kwargs)


@pytest.fixture(autouse=True)
def clean_ai_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for key in AI_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LOG_LEVEL", "error")
    providers.reset_structured_outputs()
    yield
    providers.reset_structured_outputs()


@pytest.fixture
def settings() -> Settings:
    return load_settings({"AI_PROVIDER": "anthropic", "AI_MODEL": "claude-opus-5"})


def item(
    defect: str | None,
    findings: list[dict[str, Any]] | None = None,
    *,
    status: str = "done",
    error_code: str | None = None,
    latency_ms: int = 1000,
    cost: float = 0.01,
    index: int = 1,
    rep: int = 1,
    tier: str | None = None,
    structured: bool | None = False,
    served_model: str | None = "anthropic.claude-opus-5",
) -> dict[str, Any]:
    """One run item record as the runner writes it."""
    return {
        "type": "item",
        "id": f"s-{index:04d}",
        "rep": rep,
        "defect": defect,
        "tier": tier,
        "status": status,
        "errorCode": error_code,
        "findings": [{"cardId": index, **f} for f in (findings or [])],
        "usage": {"inputTokens": 100, "outputTokens": 20, "cacheReadInputTokens": 0},
        "latencyMs": latency_ms,
        "requestId": "req_test_1",
        "estimatedCostUsd": cost,
        "structured": structured,
        "servedModel": served_model if status == "done" else None,
    }


def gate_header(dataset: str = "v3", **overrides: Any) -> dict[str, Any]:
    """A complete, gate-eligible run header: the gate dataset (seeded-v3), two repetitions, and the
    shipping configuration (Bedrock, anthropic.claude-opus-5, the current prompt version, effort
    high, structured outputs auto = off on Bedrock)."""
    from ai_qa.prompts import PROMPT_VERSION

    spec = DATASETS[dataset]
    rows = len(load_dataset(spec.path))
    reps = overrides.pop("reps", 2)
    header = run_header(
        run_id="run-1",
        started_at="2026-09-27T00:00:00Z",
        provider="bedrock",
        model="anthropic.claude-opus-5",
        prompt_version=PROMPT_VERSION,
        n=rows * reps,
        dataset=spec.name,
        dataset_sha256=file_sha256(spec.path),
        dataset_rows=rows,
        reps=reps,
        review_date="2026-09-27",
        effort="high",
        structured_outputs="auto",
        structured_outputs_at_start=False,
    )
    return {**header, **overrides}


def v2_header(**overrides: Any) -> dict[str, Any]:
    """A complete one-repetition run header for the committed seeded-v2 dataset (no longer the gate
    dataset: Y05 moved the gate to seeded-v3)."""
    return gate_header("v2", **{"reps": 1, **overrides})


def dataset_records(
    dataset: str = "v3",
    *,
    misses: dict[str, int] | None = None,
    false_positives: int = 0,
    unscored_controls: int = 0,
    rep: int = 1,
) -> list[dict[str, Any]]:
    """One record per dataset row: each defective row is caught in its own category except the
    first misses[class] rows of that class; the first `false_positives` controls get a major
    finding and the next `unscored_controls` controls end in a provider error."""
    misses = dict(misses or {})
    records = []
    control_index = 0
    for index, row in enumerate(load_dataset(DATASETS[dataset].path), start=1):
        defect = row["defect"]
        if defect is None:
            control_index += 1
            if control_index <= false_positives:
                records.append(item(None, [finding("major", "ambiguous_stem")], index=index, rep=rep))
            elif control_index <= false_positives + unscored_controls:
                records.append(
                    item(None, [], status="error", error_code="PROVIDER_TIMEOUT", index=index, rep=rep)
                )
            else:
                records.append(item(None, [], index=index, rep=rep))
            continue
        if misses.get(defect, 0) > 0:
            misses[defect] -= 1
            records.append(item(defect, [], index=index, rep=rep, tier=row["tier"]))
        else:
            hit = [finding("blocker" if defect in ("incorrect_answer", "multiple_correct") else "major", defect)]
            records.append(item(defect, hit, index=index, rep=rep, tier=row["tier"]))
    return records


def v2_records(**kwargs: Any) -> list[dict[str, Any]]:
    return dataset_records("v2", **kwargs)


def gate_records(
    *,
    misses: dict[str, int] | None = None,
    false_positives: int = 0,
    unscored_controls: int = 0,
    reps: int = 2,
) -> list[dict[str, Any]]:
    """dataset_records over the gate dataset for each of `reps` repetitions; misses, false
    positives and unscored controls apply to every repetition."""
    return [
        record
        for rep in range(1, reps + 1)
        for record in dataset_records(
            misses=misses, false_positives=false_positives, unscored_controls=unscored_controls, rep=rep
        )
    ]

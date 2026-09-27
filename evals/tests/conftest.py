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


def reply(text: str, *, usage: FakeUsage | None = None, request_id: str = "req_test_1") -> FakeResponse:
    return FakeResponse(
        content=[FakeBlock(type="thinking", thinking="(reasoning)", signature="sig"), FakeBlock(type="text", text=text)],
        stop_reason="end_turn",
        usage=usage or FakeUsage(input_tokens=100, output_tokens=20),
        _request_id=request_id,
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
) -> dict[str, Any]:
    """One run item record as the runner writes it."""
    return {
        "type": "item",
        "id": f"s-{index:04d}",
        "defect": defect,
        "status": status,
        "errorCode": error_code,
        "findings": [{"cardId": index, **f} for f in (findings or [])],
        "usage": {"inputTokens": 100, "outputTokens": 20, "cacheReadInputTokens": 0},
        "latencyMs": latency_ms,
        "requestId": "req_test_1",
        "estimatedCostUsd": cost,
    }

"""Per-record SQS binding of AWSTraceHeader (H00 §3.3): upstreamTraceId only while its record runs."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest

from ai_qa import handler, tracectx

UPSTREAM_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
UPSTREAM_HEADER = f"Root={UPSTREAM_ROOT};Parent=53995c3f42cd8ad8;Sampled=1"


def _is_error_line(d: dict[str, Any]) -> bool:
    return bool(d["tag"] == "ai-qa" and d["event"] == "unexpected_error")


@pytest.fixture(autouse=True)
def no_trace_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(tracectx.ENV_VAR, raising=False)
    tracectx.clear_upstream()
    yield
    tracectx.clear_upstream()


def _install(monkeypatch: pytest.MonkeyPatch, fail_ids: tuple[str, ...] = ()) -> None:
    def fake(*args: Any) -> bool:
        record = args[0]
        handler.log("info", "probe", mid=record.get("messageId"))
        if record.get("messageId") in fail_ids:
            raise RuntimeError("probe failure")
        return True

    monkeypatch.setattr(handler, "_process", fake)


def _event(header: object) -> dict[str, Any]:
    return {
        "Records": [
            {"messageId": "m1", "body": "{}", "attributes": {"AWSTraceHeader": header}},
            {"messageId": "m2", "body": "{}", "attributes": {}},
        ]
    }


def _lines(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    out = [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]
    return [d for d in out if "_aws" not in d]


def _probes(lines: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {d["mid"]: d for d in lines if d.get("tag") == "probe"}


def test_record_trace_header_is_bound_during_its_record_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _install(monkeypatch)
    result = handler.lambda_handler(_event(UPSTREAM_HEADER), None)
    probes = _probes(_lines(capsys))
    assert probes["m1"]["upstreamTraceId"] == UPSTREAM_ROOT
    assert list(probes["m1"])[:3] == ["level", "tag", "upstreamTraceId"]
    assert "upstreamTraceId" not in probes["m2"]
    assert result == {"batchItemFailures": []}
    assert tracectx.upstream() is None


def test_upstream_is_cleared_after_a_record_raises(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _install(monkeypatch, fail_ids=("m1",))
    result = handler.lambda_handler(_event(UPSTREAM_HEADER), None)
    lines = _lines(capsys)
    errors = [d for d in lines if d.get("level") == "error"]
    assert len(errors) == 1 and _is_error_line(errors[0])
    assert errors[0]["upstreamTraceId"] == UPSTREAM_ROOT
    assert errors[0]["messageId"] == "m1"
    assert "upstreamTraceId" not in _probes(lines)["m2"]
    assert result == {"batchItemFailures": [{"itemIdentifier": "m1"}]}
    assert tracectx.upstream() is None


def test_invalid_trace_header_is_not_logged(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    _install(monkeypatch)
    for header in ("Root=1-XYZ", 12345, "root=" + UPSTREAM_ROOT):
        handler.lambda_handler(_event(header), None)
        lines = _lines(capsys)
        assert len(_probes(lines)) == 2
        assert all("upstreamTraceId" not in d for d in lines)
    assert tracectx.upstream() is None

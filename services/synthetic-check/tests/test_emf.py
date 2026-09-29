"""The one EMF line of a run (H00 §5.2)."""

from __future__ import annotations

import json

import pytest

from synthetic_check import emf, tracectx
from synthetic_check.checks import CHECK_NAMES, CheckResult

ROOT = "1-5759e988-bd862e3fe1be46a994272793"


def _results(failed: set[str]) -> list[CheckResult]:
    return [CheckResult(n, n not in failed, None if n in failed else 200, 7, "TIMEOUT" if n in failed else None) for n in CHECK_NAMES]


def _line(capsys: pytest.CaptureFixture[str], results: list[CheckResult]) -> dict:
    emf.run_line("DeveloperCards", results, 1234, timestamp_ms=1790000000000)
    (line,) = capsys.readouterr().out.splitlines()
    return json.loads(line)


def test_emf_line_shape(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    line = _line(capsys, _results(set()))
    assert line["_aws"] == {
        "Timestamp": 1790000000000,
        "CloudWatchMetrics": [
            {
                "Namespace": "DeveloperCards",
                "Dimensions": [["Service"]],
                "Metrics": [
                    {"Name": "SyntheticCheckSuccess", "Unit": "Count"},
                    {"Name": "SyntheticCheckLatency", "Unit": "Milliseconds"},
                ],
            }
        ],
    }
    assert line["Service"] == "synthetic-check"
    assert line["SyntheticCheckSuccess"] == 1
    assert line["SyntheticCheckLatency"] == 1234
    assert line["failedChecks"] == []
    assert list(line["checks"]) == list(CHECK_NAMES)
    assert line["checks"]["api-health"] == {"ok": True, "status": 200, "ms": 7, "code": None}
    assert "xrayTraceId" not in line

    line = _line(capsys, _results({"cdn-deck", "api-health"}))
    assert line["SyntheticCheckSuccess"] == 0
    assert line["failedChecks"] == ["api-health", "cdn-deck"]
    assert line["checks"]["cdn-deck"] == {"ok": False, "status": None, "ms": 7, "code": "TIMEOUT"}
    assert line["SyntheticCheckSuccess"] in {0, 1}

    monkeypatch.setenv(tracectx.ENV_VAR, f"Root={ROOT};Parent=53995c3f42cd8ad8;Sampled=1")
    line = _line(capsys, _results(set()))
    assert line["xrayTraceId"] == ROOT

    monkeypatch.setenv(tracectx.ENV_VAR, "Root=1-XYZ")
    assert "xrayTraceId" not in _line(capsys, _results(set()))

    emf.run_line("DeveloperCards", [], 1)
    (line_text,) = capsys.readouterr().out.splitlines()
    assert json.loads(line_text)["SyntheticCheckSuccess"] == 0

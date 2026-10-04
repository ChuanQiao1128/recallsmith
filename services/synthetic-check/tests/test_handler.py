"""lambda_handler: event gate, one EMF line + one log line per run, never raises, no URL/body in logs."""

from __future__ import annotations

import json
from typing import Any

import pytest
from conftest import DECK_BODY, DECK_PATH, MOBILE_POOL, REMOTE_CONFIG_PATH, FakeSite, json_answer, jwks_path, remote_config

from synthetic_check import checks, handler
from synthetic_check.checks import CHECK_NAMES

EVENT = {"job": "synthetic-check"}


def _lines(capsys: pytest.CaptureFixture[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return [r for r in rows if "_aws" in r], [r for r in rows if "_aws" not in r]


def test_unknown_event_is_skipped_without_metric(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    for event in ({"job": "source-watch"}, {}, {"Records": []}, None, "synthetic-check", ["job"]):
        assert handler.lambda_handler(event, None) == {"skipped": "unknown-event"}
        emf_lines, log_lines = _lines(capsys)
        assert emf_lines == []
        assert [r["tag"] for r in log_lines] == ["synthetic-skip"]
    assert fake_site.requests == []


def test_run_returns_ok_and_failed_names(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    assert handler.lambda_handler(EVENT, None) == {"ok": True, "failed": [], "advisoryFailed": []}
    fake_site.routes["/"] = json_answer(500, {})
    fake_site.routes["/api/v1/me"] = json_answer(200, {})
    assert handler.lambda_handler(EVENT, None) == {"ok": False, "failed": ["console-index", "api-auth-guard"], "advisoryFailed": []}
    fake_site.routes["/content/manifest.json"] = json_answer(404, {})
    assert handler.lambda_handler(EVENT, None) == {
        "ok": False,
        "failed": ["cdn-manifest", "cdn-deck", "console-index", "api-auth-guard"],
        "advisoryFailed": [],
    }


def test_remote_config_alone_never_fails_the_run(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    """F2 (R28 review): GitHub raw down, or a document breaking a rule, keeps ok true and failed empty (the CD
    smoke and SyntheticCheckSuccess), so the paging alarm still sees a later API, CDN, console or Cognito outage;
    SyntheticRemoteConfigSuccess carries it to its own alarm."""
    fake_site.routes[REMOTE_CONFIG_PATH] = json_answer(503, {})
    assert handler.lambda_handler(EVENT, None) == {"ok": True, "failed": [], "advisoryFailed": ["remote-config"]}
    (line,), (log_line,) = _lines(capsys)
    assert line["SyntheticCheckSuccess"] == 1
    assert line["SyntheticRemoteConfigSuccess"] == 0
    assert line["failedChecks"] == ["remote-config"]
    assert log_line == {"level": "warn", "tag": "synthetic-run", "ok": True, "failedChecks": [], "advisoryFailed": ["remote-config"]}

    # A real outage while remote-config is still failing: SyntheticCheckSuccess drops, so the paging alarm fires.
    fake_site.routes["/health"] = json_answer(502, {})
    assert handler.lambda_handler(EVENT, None) == {"ok": False, "failed": ["api-health"], "advisoryFailed": ["remote-config"]}
    (line,), _ = _lines(capsys)
    assert (line["SyntheticCheckSuccess"], line["SyntheticRemoteConfigSuccess"]) == (0, 0)

    # remote-config back, the outage still on: only the core metric is 0.
    fake_site.routes[REMOTE_CONFIG_PATH] = json_answer(200, remote_config())
    assert handler.lambda_handler(EVENT, None) == {"ok": False, "failed": ["api-health"], "advisoryFailed": []}
    (line,), _ = _lines(capsys)
    assert (line["SyntheticCheckSuccess"], line["SyntheticRemoteConfigSuccess"]) == (0, 1)


def test_handler_never_raises_when_a_check_raises(
    fake_site: FakeSite, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom(*args: Any) -> int:
        raise RuntimeError("unexpected")

    monkeypatch.setattr(checks, "check_console_index", boom)
    assert handler.lambda_handler(EVENT, None) == {"ok": False, "failed": ["console-index"], "advisoryFailed": []}
    (line,), _ = _lines(capsys)
    assert line["checks"]["console-index"]["code"] == "ERROR"
    assert line["SyntheticCheckSuccess"] == 0

    monkeypatch.setattr(handler, "run_checks", boom)
    assert handler.lambda_handler(EVENT, None) == {
        "ok": False,
        "failed": [name for name in CHECK_NAMES if name not in checks.ADVISORY_CHECKS],
        "advisoryFailed": ["remote-config"],
    }
    (line,), (log_line,) = _lines(capsys)
    assert line["SyntheticCheckSuccess"] == 0
    assert log_line["tag"] == "synthetic-run" and log_line["level"] == "warn"


def test_one_emf_line_and_one_log_line_per_run(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    handler.lambda_handler(EVENT, None)
    emf_lines, log_lines = _lines(capsys)
    assert len(emf_lines) == 1 and emf_lines[0]["SyntheticCheckSuccess"] == 1
    assert log_lines == [{"level": "info", "tag": "synthetic-run", "ok": True, "failedChecks": [], "advisoryFailed": []}]

    fake_site.routes["/health"] = json_answer(502, {})
    handler.lambda_handler(EVENT, None)
    emf_lines, log_lines = _lines(capsys)
    assert len(emf_lines) == 1 and emf_lines[0]["failedChecks"] == ["api-health"]
    assert log_lines == [{"level": "warn", "tag": "synthetic-run", "ok": False, "failedChecks": ["api-health"], "advisoryFailed": []}]


def test_logs_carry_no_url_query_or_body(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    marker = "SECRETISH-BODY-MARKER"
    fake_site.routes["/health"] = json_answer(200, {"success": True, "data": {"ok": False}, "note": marker})
    fake_site.routes["/"] = (200, {"Content-Type": "text/plain", "X-Note": marker}, marker.encode())
    fake_site.routes["/content/" + DECK_PATH] = (200, {"Content-Type": "application/json"}, DECK_BODY + marker.encode())
    handler.lambda_handler(EVENT, None)
    out = capsys.readouterr().out
    for forbidden in (marker, "127.0.0.1", "http://", "https://", "?", "/health", "manifest.json", "deck.json", "User-Agent",
                      "/api/v1/", "recallsmith-config", ".well-known", "jwks.json", "consoletest1", "mobiletest1"):
        assert forbidden not in out, forbidden


def test_failure_details_carry_rule_ids_only(fake_site: FakeSite, capsys: pytest.CaptureFixture[str]) -> None:
    marker = "SECRETISH-KEY-MARKER"
    # A document whose bad value sits under a key name that must never be echoed.
    fake_site.routes[REMOTE_CONFIG_PATH] = json_answer(200, {"features": {marker: True}})
    fake_site.routes[jwks_path(MOBILE_POOL)] = json_answer(200, {"keys": [{"kid": marker, "kty": "EC", "alg": "ES256"}]})
    assert handler.lambda_handler(EVENT, None) == {"ok": False, "failed": ["cognito-mobile"], "advisoryFailed": ["remote-config"]}
    out = capsys.readouterr().out
    assert marker not in out
    (line,) = [json.loads(row) for row in out.splitlines() if "_aws" in row]
    assert line["checks"]["remote-config"] == {"ok": False, "status": 200, "ms": line["checks"]["remote-config"]["ms"], "code": "BAD_BODY", "detail": "features.unknown"}
    assert line["checks"]["cognito-mobile"]["detail"] == "jwks.rs256"
    assert "detail" not in line["checks"]["api-health"]

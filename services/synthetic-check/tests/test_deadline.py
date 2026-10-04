"""The overall run deadline (sre-cloud-8): a stalled check, a slow-drip body or a DNS stall never
keeps the run past RUN_DEADLINE_S, so the EMF line is always written before the Lambda timeout."""

from __future__ import annotations

import http.server
import json
import re
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import DECK_PATH, FakeSite

from synthetic_check import checks, handler
from synthetic_check.checks import CHECK_NAMES, RUN_DEADLINE_S, CheckResult, run_checks

SYNTHETIC_TF = Path(__file__).resolve().parents[3] / "infra" / "modules" / "worker" / "synthetic.tf"


def _release() -> Iterator[threading.Event]:
    event = threading.Event()
    yield event
    event.set()


release = pytest.fixture(name="release")(_release)


def _codes(results: list[CheckResult]) -> list[tuple[str, bool, str | None]]:
    return [(r.name, r.ok, r.code) for r in results]


def test_deadline_is_well_under_the_lambda_timeout() -> None:
    match = re.search(
        r'resource "aws_lambda_function" "synthetic_check" \{.*?\n\s*timeout\s*=\s*(\d+)', SYNTHETIC_TF.read_text(), re.S
    )
    assert match is not None
    lambda_timeout_s = int(match.group(1))
    assert 0 < RUN_DEADLINE_S <= lambda_timeout_s - 15


def test_a_stalled_check_is_timeout_and_the_rest_are_not_run(
    fake_site: FakeSite, monkeypatch: pytest.MonkeyPatch, release: threading.Event
) -> None:
    ran: list[str] = []

    def stalled(settings: Any, state: dict[str, Any]) -> int:
        ran.append("cdn-manifest")
        release.wait(10)
        return 200

    original = checks._check_fns

    def patched() -> Any:
        return tuple((name, stalled if name == "cdn-manifest" else fn) for name, fn in original())

    monkeypatch.setattr(checks, "_check_fns", patched)
    started = time.monotonic()
    results = run_checks(fake_site.settings(), deadline_s=0.5)
    assert time.monotonic() - started < 1.5
    assert _codes(results) == [
        ("api-health", True, None),
        *((name, False, "TIMEOUT") for name in CHECK_NAMES[1:]),
    ]
    assert all(r.status is None for r in results[1:])
    assert all(r.ms == 0 for r in results[2:])
    assert ran == ["cdn-manifest"]
    assert fake_site.paths == ["/health"]


def test_dns_stall_is_bounded_by_the_deadline(
    fake_site: FakeSite, monkeypatch: pytest.MonkeyPatch, release: threading.Event
) -> None:
    resolving: list[str] = []

    def stalled_getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        resolving.append(str(host))
        release.wait(10)
        raise socket.gaierror(socket.EAI_AGAIN, "stalled")

    monkeypatch.setattr(socket, "getaddrinfo", stalled_getaddrinfo)
    stall = "https://dns-stall.invalid"
    settings = fake_site.settings(API_BASE=stall, CDN_BASE=stall, CONSOLE_BASE=stall)
    started = time.monotonic()
    results = run_checks(settings, deadline_s=0.5)
    assert time.monotonic() - started < 1.5
    assert _codes(results) == [(name, False, "TIMEOUT") for name in CHECK_NAMES]
    assert resolving == ["dns-stall.invalid"]


def _slow_drip(handler_: http.server.BaseHTTPRequestHandler) -> None:
    try:
        handler_.send_response(200)
        handler_.send_header("Content-Type", "application/json")
        handler_.send_header("Content-Length", "100000")
        handler_.end_headers()
        for _ in range(40):
            handler_.wfile.write(b" ")
            handler_.wfile.flush()
            time.sleep(0.2)
    except OSError:
        return


def test_slow_drip_body_is_bounded_by_the_deadline(fake_site: FakeSite) -> None:
    # Every byte arrives well inside the 1 s per-operation timeout, so only the run deadline ends it.
    fake_site.routes["/content/" + DECK_PATH] = _slow_drip
    started = time.monotonic()
    results = run_checks(fake_site.settings(), deadline_s=1.5)
    assert time.monotonic() - started < 2.5
    assert _codes(results) == [
        ("api-health", True, None),
        ("cdn-manifest", True, None),
        *((name, False, "TIMEOUT") for name in CHECK_NAMES[2:]),
    ]


def test_handler_writes_the_emf_line_when_the_deadline_is_hit(
    fake_site: FakeSite, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], release: threading.Event
) -> None:
    def stalled(settings: Any, state: dict[str, Any]) -> int:
        release.wait(10)
        return 200

    monkeypatch.setattr(checks, "RUN_DEADLINE_S", 0.3)
    monkeypatch.setattr(checks, "check_api_health", stalled)
    started = time.monotonic()
    assert handler.lambda_handler({"job": "synthetic-check"}, None) == {"ok": False, "failed": list(CHECK_NAMES)}
    assert time.monotonic() - started < 1.5
    emf_lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if "_aws" in line]
    assert len(emf_lines) == 1
    assert emf_lines[0]["SyntheticCheckSuccess"] == 0
    assert {name: check["code"] for name, check in emf_lines[0]["checks"].items()} == {name: "TIMEOUT" for name in CHECK_NAMES}


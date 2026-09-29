"""tracectx (H00 §3.3): root parsing, log fields and the x-dc-trace-id header to core."""

from __future__ import annotations

import json
import random
from collections.abc import Iterator
from typing import Any

import pytest

from webhook_dispatcher import logs, tracectx
from webhook_dispatcher.internal_client import InternalClient, sign_internal

SECRET = "test-secret"
SAMPLE_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
SAMPLE_ENV = f"Root={SAMPLE_ROOT};Parent=53995c3f42cd8ad8;Sampled=1"
HEX = "0123456789abcdef"
OK_BODY = json.dumps({"success": True, "data": {}, "error": None, "traceId": "t", "version": "v1"}).encode()


def _no_trace_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(tracectx.ENV_VAR, raising=False)
    tracectx.clear_upstream()
    yield
    tracectx.clear_upstream()


no_trace_state = pytest.fixture(name="no_trace_state", autouse=True)(_no_trace_state)


def _hex(rng: random.Random, n: int) -> str:
    return "".join(rng.choice(HEX) for _ in range(n))


def _root(rng: random.Random) -> str:
    return f"1-{_hex(rng, 8)}-{_hex(rng, 24)}"


def _invalid_values(rng: random.Random, root: str) -> list[object]:
    upper = root.upper() if any(c.isalpha() for c in root[2:]) else root[:2] + "A" + root[3:]
    return [
        upper,
        f"Root={upper};Sampled=1",
        root + _hex(rng, 1),
        root[:-1],
        f"1-{_hex(rng, 7)}-{_hex(rng, 24)}",
        f"1-{_hex(rng, 8)}-{_hex(rng, 23)}",
        root[2:],
        "2-" + root[2:],
        f"Root={root}x;Parent={_hex(rng, 16)}",
        f"{root} junk",
        f"root={root};Sampled=1",
        f"ROOT={root}",
        f"Root={root[:-1]};Parent={_hex(rng, 16)}",
        f"Root=;Parent={_hex(rng, 16)}",
        f"Root=1-XYZ;Root={root}",
        f"Parent={_hex(rng, 16)};Sampled=1",
        f"Root={root};" + "x" * tracectx.MAX_HEADER_CHARS,
        "",
        None,
        123,
        root.encode(),
    ]


def test_root_parsing_property() -> None:
    rng = random.Random(20260929)
    valid = invalid = 0
    for _ in range(60):
        root = _root(rng)
        parent = _hex(rng, 16)
        sampled = rng.choice("01")
        assert tracectx.root_from_header(root) == root
        assert tracectx.root_from_header(f"Root={root};Parent={parent};Sampled={sampled}") == root
        assert tracectx.root_from_header(f"Parent={parent};Root={root};Sampled={sampled}") == root
        assert tracectx.root_from_header(f"  Root={root};Parent={parent}  ") == root
        valid += 1
        for value in _invalid_values(rng, root):
            assert tracectx.root_from_header(value) is None, value
            invalid += 1
    assert valid >= 50 and invalid >= 50


def test_current_root_reads_the_lambda_env(monkeypatch: pytest.MonkeyPatch) -> None:
    assert tracectx.current_root() is None
    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ENV)
    assert tracectx.current_root() == SAMPLE_ROOT
    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ROOT)
    assert tracectx.current_root() == SAMPLE_ROOT


def test_invalid_env_value_gives_no_root(monkeypatch: pytest.MonkeyPatch) -> None:
    for value in ("", "Root=1-XYZ;Parent=1", "1-5759E988-BD862E3FE1BE46A994272793", f"root={SAMPLE_ROOT}"):
        monkeypatch.setenv(tracectx.ENV_VAR, value)
        assert tracectx.current_root() is None
    monkeypatch.delenv(tracectx.ENV_VAR)
    assert tracectx.current_root() is None


def _log_keys(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    capsys.readouterr()
    logs.log("info", "probe", k=1)
    (line,) = capsys.readouterr().out.splitlines()
    return json.loads(line)


def test_log_fields_present_only_when_set(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    upstream_root = _root(random.Random(7))
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "k"]

    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ENV)
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "xrayTraceId", "k"]
    assert record["xrayTraceId"] == SAMPLE_ROOT

    tracectx.bind_upstream(f"Root={upstream_root};Parent=53995c3f42cd8ad8;Sampled=0")
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "xrayTraceId", "upstreamTraceId", "k"]
    assert record["upstreamTraceId"] == upstream_root

    monkeypatch.setenv(tracectx.ENV_VAR, "Root=1-XYZ")
    record = _log_keys(capsys)
    assert "xrayTraceId" not in record
    assert record["upstreamTraceId"] == upstream_root

    tracectx.clear_upstream()
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "k"]


def _post(local_server: Any) -> Any:
    srv = local_server(lambda *args: (200, {"Content-Type": "application/json"}, OK_BODY))
    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, clock_ms=lambda: 1790000000000)
    result = client.post("/api/internal/probe", {"a": 1})
    assert result.ok
    (captured,) = srv.requests
    assert captured.headers["x-internal-signature"] == sign_internal(
        SECRET, int(captured.headers["x-internal-timestamp"]), captured.body.decode("ascii")
    )
    return captured


def test_internal_client_sends_trace_header_when_root_exists(local_server: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ENV)
    captured = _post(local_server)
    assert captured.headers.get_all("x-dc-trace-id") == [SAMPLE_ROOT]


def test_internal_client_omits_trace_header_without_root(local_server: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    captured = _post(local_server)
    assert captured.headers.get("x-dc-trace-id") is None
    monkeypatch.setenv(tracectx.ENV_VAR, "Root=1-XYZ;Parent=1")
    captured = _post(local_server)
    assert captured.headers.get("x-dc-trace-id") is None

import json
import socket

from ai_qa.internal_client import RESULTS_PATH, InternalClient, canonical_body, sign_internal

SECRET = "test-secret"


def closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_internal_signature_matches_contract_vector() -> None:
    assert canonical_body({"a": 1}) == '{"a":1}'
    assert (
        sign_internal("test-secret", 1790000000000, '{"a":1}')
        == "v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85"
    )
    assert RESULTS_PATH == "/api/internal/ai-qa/results"


def test_body_is_ascii_and_signed_headers_are_sent(local_server) -> None:
    ok = json.dumps({"success": True, "data": {"runId": "r"}, "error": None, "traceId": "t", "version": "v1"})
    srv = local_server(lambda s, c: (200, {"Content-Type": "application/json"}, ok.encode()))
    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, clock_ms=lambda: 1790000000000)
    result = client.post(RESULTS_PATH, {"b": "café", "a": 1})
    assert result.ok and result.data == {"runId": "r"}
    (captured,) = srv.requests
    assert captured.body == b'{"a":1,"b":"caf\\u00e9"}'
    assert captured.headers["content-type"] == "application/json"
    assert captured.headers["x-internal-timestamp"] == "1790000000000"
    assert captured.headers["x-internal-signature"] == sign_internal(
        SECRET, 1790000000000, captured.body.decode("ascii")
    )


def test_retries_once_on_5xx_and_connection_error_never_raises(local_server) -> None:
    srv = local_server(lambda s, c: (502, {}, b""))
    sleeps: list[float] = []
    result = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=sleeps.append).post("/x", {})
    assert not result.ok and result.status == 502 and len(srv.requests) == 2 and sleeps == [1.0]

    sleeps.clear()
    result = InternalClient(f"http://127.0.0.1:{closed_port()}", SECRET, timeout_s=0.5, sleep=sleeps.append).post(
        "/x", {}
    )
    assert not result.ok and result.error.startswith("connection error") and sleeps == [1.0]

    srv = local_server(lambda s, c: (403, {}, b"{}"))
    result = InternalClient(srv.base_url, SECRET, sleep=sleeps.append).post("/x", {})
    assert not result.ok and result.status == 403 and len(srv.requests) == 1


OK_ENVELOPE = json.dumps({"success": True, "data": {"runId": "r"}, "error": None, "traceId": "t", "version": "v1"}).encode()


def test_429_is_retried_like_a_5xx(local_server) -> None:
    # cloud-security-resilience-12: the route throttle's 429 is transient, not permanent.
    answers = iter([429, 200])
    srv = local_server(lambda s, c: (next(answers), {"Content-Type": "application/json"}, OK_ENVELOPE))
    sleeps: list[float] = []
    result = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=sleeps.append).post("/x", {})
    assert result.ok and len(srv.requests) == 2 and sleeps == [1.0]


def test_retry_pauses_give_a_longer_backoff_schedule(local_server) -> None:
    srv = local_server(lambda s, c: (503, {}, b""))
    sleeps: list[float] = []
    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=sleeps.append)
    result = client.post("/x", {}, retry_pauses=[2.0, 5.0, 20.0])
    assert not result.ok and result.status == 503
    assert len(srv.requests) == 4 and sleeps == [2.0, 5.0, 20.0]


def test_longer_schedule_still_stops_at_the_budget(local_server) -> None:
    srv = local_server(lambda s, c: (503, {}, b""))
    clock = {"ms": 1_000_000}

    def fake_sleep(seconds: float) -> None:
        clock["ms"] += int(seconds * 1000)

    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=fake_sleep, clock_ms=lambda: clock["ms"])
    result = client.post("/x", {}, budget_s=10.0, retry_pauses=[2.0, 5.0, 20.0])
    # Tries at t=0, 2 and 7 s; after the 20 s pause the budget is gone.
    assert result.status == 503 and len(srv.requests) == 3


def test_rejected_signature_is_sent_again_with_the_previous_secret(local_server) -> None:
    # cloud-security-resilience-11: SSM already holds the new secret, core still verifies the old one.
    def core(srv, captured):
        body = captured.body.decode("ascii")
        ts = int(captured.headers["x-internal-timestamp"])
        if captured.headers["x-internal-signature"] != sign_internal("old-secret", ts, body):
            return 403, {}, b"{}"
        return 200, {"Content-Type": "application/json"}, OK_ENVELOPE

    srv = local_server(core)
    loads: list[str] = []

    def previous() -> str | None:
        loads.append("previous")
        return "old-secret"

    sleeps: list[float] = []
    client = InternalClient(srv.base_url, "new-secret", previous_secret=previous, timeout_s=2.0, sleep=sleeps.append)
    result = client.post("/x", {"a": 1})
    assert result.ok and len(srv.requests) == 2 and loads == ["previous"] and sleeps == []

    # Accepted at once: the previous secret is never read.
    loads.clear()
    ok_client = InternalClient(srv.base_url, "old-secret", previous_secret=previous, timeout_s=2.0)
    assert ok_client.post("/x", {}).ok and loads == []


def test_rejected_signature_without_a_usable_previous_secret_is_not_retried(local_server) -> None:
    srv = local_server(lambda s, c: (403, {}, b"{}"))
    for previous in (None, lambda: None, lambda: SECRET):
        srv.requests.clear()
        result = InternalClient(srv.base_url, SECRET, previous_secret=previous, timeout_s=2.0).post("/x", {})
        assert result.status == 403 and len(srv.requests) == 1

    # Both secrets rejected: two requests, then the 403 stands.
    srv.requests.clear()
    result = InternalClient(srv.base_url, SECRET, previous_secret=lambda: "old", timeout_s=2.0).post("/x", {})
    assert result.status == 403 and len(srv.requests) == 2

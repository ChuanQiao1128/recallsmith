import hashlib
import hmac
import json
import socket
import time

from webhook_dispatcher.internal_client import InternalClient, canonical_body, sign_internal

SECRET = "test-secret"


def closed_port() -> int:
    """A localhost port with no listener (bound, then released)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def envelope(data) -> bytes:
    return json.dumps(
        {"success": True, "data": data, "error": None, "traceId": "t-1", "version": "v1"}
    ).encode()


def verify_internal_signature(headers, raw_body: bytes) -> bool:
    """Mirror of Auth.VerifyInternalSignature: ms timestamp, ±5 min, "v1=" + hex HMAC of f"{ts}.{body}"."""
    ts_text = headers.get("x-internal-timestamp")
    sig = headers.get("x-internal-signature")
    if not ts_text or not sig:
        return False
    try:
        ts = int(ts_text)
    except ValueError:
        return False
    if abs(int(time.time() * 1000) - ts) > 5 * 60 * 1000:
        return False
    message = f"{ts}.{raw_body.decode('utf-8')}".encode("utf-8")
    expected = "v1=" + hmac.new(SECRET.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def fake_core(srv, captured):
    if not verify_internal_signature(captured.headers, captured.body):
        return 403, {"Content-Type": "application/json"}, json.dumps(
            {"success": False, "data": None, "error": {"code": "FORBIDDEN"}, "traceId": "t", "version": "v1"}
        ).encode()
    payload = json.loads(captured.body)
    return 200, {"Content-Type": "application/json"}, envelope(
        {"deliveryId": payload["deliveryId"], "status": "delivered", "stop": False}
    )


def test_internal_signature_matches_contract_vector() -> None:
    assert canonical_body({"a": 1}) == '{"a":1}'
    assert (
        sign_internal("test-secret", 1790000000000, '{"a":1}')
        == "v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85"
    )


def test_report_is_signed_and_read_from_the_envelope(local_server) -> None:
    srv = local_server(fake_core)
    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=lambda s: None)
    payload = {"outcome": "delivered", "deliveryId": "7b0c2a5e-1f0e-4d9c-8a61-2b8f3e4d5c6a", "note": "café"}
    result = client.post("/api/internal/webhooks/deliveries/report", payload)
    assert result.ok is True, result
    assert result.status == 200
    assert result.data == {"deliveryId": payload["deliveryId"], "status": "delivered", "stop": False}
    (captured,) = srv.requests
    assert captured.path == "/api/internal/webhooks/deliveries/report"
    assert captured.headers["Content-Type"] == "application/json"
    assert captured.body == canonical_body(payload).encode("ascii")
    assert b"\\u00e9" in captured.body

    wrong = InternalClient(srv.base_url, "not-the-secret", timeout_s=2.0, sleep=lambda s: None)
    rejected = wrong.post("/api/internal/webhooks/deliveries/report", payload)
    assert rejected.ok is False and rejected.status == 403
    assert len(srv.requests) == 2  # 403 is not retried


def test_envelope_with_success_false_is_not_ok(local_server) -> None:
    srv = local_server(lambda s, c: (200, {}, b'{"success":false,"data":null}'))
    result = InternalClient(srv.base_url, SECRET, sleep=lambda s: None).post("/x", {})
    assert result.ok is False and result.status == 200


def test_retries_once_on_5xx_then_reports_failure(local_server) -> None:
    srv = local_server(lambda s, c: (503, {}, b'{"success":false}'))
    sleeps: list[float] = []
    client = InternalClient(srv.base_url, SECRET, timeout_s=2.0, sleep=sleeps.append)
    result = client.post("/api/internal/webhooks/deliveries/report", {"a": 1})
    assert result.ok is False
    assert result.status == 503
    assert result.error == "HTTP 503"
    assert len(srv.requests) == 2
    assert sleeps == [1.0]


def test_retries_once_on_connection_error() -> None:
    sleeps: list[float] = []
    client = InternalClient(f"http://127.0.0.1:{closed_port()}", SECRET, timeout_s=0.5, sleep=sleeps.append)
    result = client.post("/x", {"a": 1})
    assert result.ok is False and result.status is None
    assert result.error and result.error.startswith("connection error")
    assert sleeps == [1.0]


def test_no_retry_when_the_budget_is_nearly_spent(local_server) -> None:
    srv = local_server(lambda s, c: (500, {}, b""))
    clock = {"ms": int(time.time() * 1000)}

    def fake_sleep(seconds: float) -> None:
        clock["ms"] += int(seconds * 1000)

    client = InternalClient(
        srv.base_url, SECRET, timeout_s=10.0, sleep=fake_sleep, clock_ms=lambda: clock["ms"]
    )
    # 2.5 s: the first attempt may start, the retry (1 s later, 1.5 s left) may not.
    result = client.post("/x", {"a": 1}, budget_s=2.5)
    assert result.ok is False and result.status == 500
    assert len(srv.requests) == 1

    # 1.5 s: not even the first attempt starts.
    result = client.post("/x", {"a": 1}, budget_s=1.5)
    assert result.ok is False and result.error == "budget exhausted"
    assert len(srv.requests) == 1

import hashlib
import hmac
import socket

from webhook_dispatcher.delivery import HttpResult, classify, post_json
from webhook_dispatcher.signing import sign_webhook

BODY = '{"data":{"subscriptionId":7,"message":"DeveloperCards test event"},"environment":"prod","event":"webhook.test","eventId":"0b8f3c1e-3a55-4b7e-9d2a-5d7f0f6a1b2c","occurredAt":"2026-10-01T03:04:05.678Z"}'

DELIVERY_ID = "7b0c2a5e-1f0e-4d9c-8a61-2b8f3e4d5c6a"


def closed_port() -> int:
    """A localhost port with no listener (bound, then released)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def ok(srv, captured):
    return 204, {}, b""


def contract_headers(ts: int) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "User-Agent": "DeveloperCards-Webhooks/1",
        "X-DeveloperCards-Event": "webhook.test",
        "X-DeveloperCards-Delivery": DELIVERY_ID,
        "X-DeveloperCards-Timestamp": str(ts),
        "X-DeveloperCards-Signature": sign_webhook("whsec-test", ts, BODY),
    }


def test_posts_exact_body_and_contract_headers(local_server) -> None:
    def verify(srv, captured):
        h = captured.headers
        ts = h["X-DeveloperCards-Timestamp"]
        expected = hmac.new(b"whsec-test", f"{ts}.".encode() + captured.body, hashlib.sha256).hexdigest()
        good = (
            captured.body == BODY.encode("utf-8")
            and h["Content-Type"] == "application/json"
            and h["User-Agent"] == "DeveloperCards-Webhooks/1"
            and h["X-DeveloperCards-Event"] == "webhook.test"
            and h["X-DeveloperCards-Delivery"] == DELIVERY_ID
            and ts.isdigit()
            and hmac.compare_digest(h["X-DeveloperCards-Signature"], expected)
        )
        return (200 if good else 400), {}, b"x" * 200_000  # a large body is read partially and dropped

    srv = local_server(verify)
    result = post_json(
        f"{srv.base_url}/hooks/in?x=1",
        BODY.encode("utf-8"),
        contract_headers(1790000000),
        2.0,
        connect_address="127.0.0.1",
    )
    assert result.status == 200, result
    assert result.error is None and not result.timed_out
    assert classify(result) == "delivered"
    (captured,) = srv.requests
    assert captured.path == "/hooks/in?x=1"


def test_connects_to_the_vetted_address_and_keeps_the_host_header(local_server) -> None:
    srv = local_server(ok)
    result = post_json(
        f"http://hooks.example.test:{srv.port}/in",
        BODY.encode("utf-8"),
        contract_headers(1790000000),
        2.0,
        connect_address="127.0.0.1",
    )
    assert result.status == 204
    (captured,) = srv.requests
    assert captured.headers["Host"] == f"hooks.example.test:{srv.port}"


def test_redirect_is_not_followed(local_server) -> None:
    second = local_server(ok)

    def redirect(srv, captured):
        return 302, {"Location": f"{second.base_url}/stolen"}, b""

    first = local_server(redirect)
    result = post_json(
        f"{first.base_url}/in",
        BODY.encode("utf-8"),
        contract_headers(1790000000),
        2.0,
        connect_address="127.0.0.1",
    )
    assert result.status == 302
    assert classify(result) == "permanent"
    assert len(first.requests) == 1
    assert second.requests == []


def test_timeout_is_reported_as_retryable(local_server) -> None:
    def stall(srv, captured):
        srv.release.wait(10)  # released at fixture teardown
        return 200, {}, b""

    srv = local_server(stall)
    result = post_json(
        f"{srv.base_url}/in",
        BODY.encode("utf-8"),
        contract_headers(1790000000),
        0.2,
        connect_address="127.0.0.1",
    )
    assert result.timed_out is True
    assert result.status is None
    assert classify(result) == "retryable"
    assert result.duration_ms >= 150


def test_connection_error_is_retryable() -> None:
    result = post_json(f"http://hooks.example.test:{closed_port()}/in", b"{}", {}, 0.5, connect_address="127.0.0.1")
    assert result.status is None
    assert result.error is not None and result.error.startswith("connection error: ")
    assert classify(result) == "retryable"


def test_classification_table() -> None:
    def r(status):
        return HttpResult(status, None, False, 1)

    for status in (200, 201, 204, 299):
        assert classify(r(status)) == "delivered"
    for status in (408, 429, 500, 502, 503, 504, 599):
        assert classify(r(status)) == "retryable"
    for status in (100, 301, 302, 304, 307, 400, 401, 403, 404, 410, 422):
        assert classify(r(status)) == "permanent"
    assert classify(HttpResult(None, "timeout", True, 1)) == "retryable"

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

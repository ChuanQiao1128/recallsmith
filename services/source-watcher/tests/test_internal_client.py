import hashlib
import hmac
import json

from source_watcher.internal_client import (
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    REPORT_PATH,
    TARGETS_PATH,
    InternalClient,
    canonical_body,
    sign_internal,
)

SECRET = "test-secret"
PREVIOUS = "test-secret-previous"


def envelope(data: dict) -> bytes:
    return json.dumps({"success": True, "data": data, "error": None, "traceId": "t", "version": "v1"}).encode()


class TestInternalClient:
    def test_internal_signature_matches_contract_vector(self):
        assert sign_internal("test-secret", 1790000000000, '{"a":1}') == (
            "v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85"
        )
        assert canonical_body({"a": 1}) == '{"a":1}'
        assert (HEADER_TIMESTAMP, HEADER_SIGNATURE) == ("x-internal-timestamp", "x-internal-signature")
        assert TARGETS_PATH == "/api/internal/source-watch/targets"
        assert REPORT_PATH == "/api/internal/source-watch/report"

    def test_request_is_signed_over_the_canonical_body(self, local_server):
        srv = local_server(lambda s, r, _: (200, {"Content-Type": "application/json"}, envelope({"targets": []})))
        client = InternalClient(srv.base_url, SECRET, clock_ms=lambda: 1790000000000)
        payload = {"watchRunId": "é-run", "v": 1, "max": 60}
        result = client.post(TARGETS_PATH, payload)
        assert result.ok and result.data == {"targets": []}
        request = srv.requests[0]
        assert request.path == TARGETS_PATH
        raw = request.body.decode("ascii")
        assert raw == '{"max":60,"v":1,"watchRunId":"\\u00e9-run"}' == canonical_body(payload)
        assert request.headers[HEADER_TIMESTAMP] == "1790000000000"
        expected = "v1=" + hmac.new(SECRET.encode(), f"1790000000000.{raw}".encode(), hashlib.sha256).hexdigest()
        assert request.headers[HEADER_SIGNATURE] == expected

    def test_previous_secret_is_tried_once_on_401_or_403(self, local_server):
        for status in (401, 403):
            def respond(srv, req, _, status=status):
                ts = req.headers[HEADER_TIMESTAMP]
                good = sign_internal(PREVIOUS, int(ts), req.body.decode())
                if req.headers[HEADER_SIGNATURE] == good:
                    return 200, {}, envelope({"changed": 0})
                return status, {}, b"{}"

            srv = local_server(respond)
            loads: list[int] = []

            def previous() -> str:
                loads.append(1)
                return PREVIOUS

            ok = InternalClient(srv.base_url, SECRET, previous_secret=previous, sleep=lambda s: None).post(REPORT_PATH, {"v": 1})
            assert ok.ok and len(srv.requests) == 2 and loads == [1]

            srv.requests.clear()
            wrong = InternalClient(srv.base_url, SECRET, previous_secret=lambda: "also-wrong", sleep=lambda s: None).post(REPORT_PATH, {"v": 1})
            assert not wrong.ok and wrong.status == status and len(srv.requests) == 2

            srv.requests.clear()
            none = InternalClient(srv.base_url, SECRET, previous_secret=lambda: None, sleep=lambda s: None).post(REPORT_PATH, {"v": 1})
            assert not none.ok and len(srv.requests) == 1

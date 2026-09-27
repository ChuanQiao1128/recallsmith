import hashlib
import hmac
import json
from dataclasses import dataclass, field
from typing import Any

import pytest

from webhook_dispatcher import handler, settings
from webhook_dispatcher.delivery import HttpResult
from webhook_dispatcher.internal_client import InternalResult, canonical_body
from webhook_dispatcher.signing import sign_webhook
from webhook_dispatcher.urlguard import GuardResult

SIGNING_NAME = "/developercards/prod/webhook-signing-secret"
INTERNAL_NAME = "/developercards/prod/internal-shared-secret"
ARN = "arn:aws:sqs:ap-southeast-2:123456789012:developercards-webhook-events"
QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/developercards-webhook-events"
DELIVERY_ID = "7b0c2a5e-1f0e-4d9c-8a61-2b8f3e4d5c6a"
EVENT_ID = "0b8f3c1e-3a55-4b7e-9d2a-5d7f0f6a1b2c"
BODY = '{"data":{"deckId":3,"deckSlug":"aws-saa-c03"},"environment":"prod","event":"deck.published","eventId":"0b8f3c1e-3a55-4b7e-9d2a-5d7f0f6a1b2c","occurredAt":"2026-10-01T03:04:05.678Z"}'
NOW = 1790000000.75


class FakeSSM:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def get_parameter(self, Name: str, WithDecryption: bool) -> dict[str, Any]:
        assert WithDecryption is True
        if Name not in self.values:
            raise LookupError("ParameterNotFound")
        return {"Parameter": {"Name": Name, "Value": self.values[Name]}}


class FakeSQS:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.error = error

    def change_message_visibility(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error


class FakeInternalClient:
    result = InternalResult(True, 200, {"deliveryId": DELIVERY_ID, "status": "x", "stop": False}, None)
    posts: list[tuple[str, str, dict[str, Any], float | None]] = []

    def __init__(self, base_url: str, secret: str) -> None:
        self.base_url = base_url
        self.secret = secret

    def post(self, path: str, payload: dict[str, Any], *, budget_s: float | None = None) -> InternalResult:
        FakeInternalClient.posts.append((self.base_url, path, payload, budget_s))
        return FakeInternalClient.result


class Context:
    def get_remaining_time_in_millis(self) -> int:
        return 30_000


@dataclass
class World:
    ssm: FakeSSM
    sqs: FakeSQS
    guard: GuardResult
    http: HttpResult | Exception
    guard_calls: list[str] = field(default_factory=list)
    http_calls: list[dict[str, Any]] = field(default_factory=list)

    @property
    def reports(self) -> list[tuple[str, str, dict[str, Any], float | None]]:
        return FakeInternalClient.posts


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    w = World(
        ssm=FakeSSM({SIGNING_NAME: "whsec-test", INTERNAL_NAME: "test-secret"}),
        sqs=FakeSQS(),
        guard=GuardResult("ok", host="hooks.example.test", port=443, addresses=("93.184.216.34",)),
        http=HttpResult(200, None, False, 42),
    )
    settings.set_clients(ssm=w.ssm, sqs=w.sqs)
    FakeInternalClient.posts = []
    FakeInternalClient.result = InternalResult(
        True, 200, {"deliveryId": DELIVERY_ID, "status": "x", "stop": False}, None
    )

    def fake_guard(url: str) -> GuardResult:
        w.guard_calls.append(url)
        return w.guard

    def fake_post(url: str, body: bytes, headers: dict[str, str], timeout: float, *, connect_address: str) -> HttpResult:
        w.http_calls.append(
            {"url": url, "body": body, "headers": headers, "timeout": timeout, "connect_address": connect_address}
        )
        if isinstance(w.http, Exception):
            raise w.http
        return w.http

    monkeypatch.setattr(handler, "check_url", fake_guard)
    monkeypatch.setattr(handler, "post_json", fake_post)
    monkeypatch.setattr(handler, "internal_client_factory", FakeInternalClient)
    monkeypatch.setattr(handler, "now", lambda: NOW)
    for key in ("SIGNING_SECRET_SSM_NAME", "INTERNAL_SECRET_SSM_NAME", "CORE_API_BASE", "METRICS_NAMESPACE", "WEBHOOK_HTTP_TIMEOUT_SECONDS"):
        monkeypatch.delenv(key, raising=False)
    return w


def message(**overrides: Any) -> dict[str, Any]:
    m = {
        "v": 1,
        "deliveryId": DELIVERY_ID,
        "eventId": EVENT_ID,
        "event": "deck.published",
        "subscriptionId": 12,
        "url": "https://hooks.example.test/in",
        "occurredAt": "2026-10-01T03:04:05.678Z",
        "body": BODY,
    }
    m.update(overrides)
    return m


def sqs_event(n: int = 1, body: Any = None, message_id: str = "m-1") -> dict[str, Any]:
    raw = body if isinstance(body, str) else json.dumps(body if body is not None else message())
    return {
        "Records": [
            {
                "messageId": message_id,
                "receiptHandle": f"rh-{message_id}",
                "body": raw,
                "attributes": {"ApproximateReceiveCount": str(n)},
                "eventSourceARN": ARN,
                "eventSource": "aws:sqs",
            }
        ]
    }


def metric_lines(out: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in out.splitlines() if line.startswith('{"_aws"')]


def attempts_outcomes(out: str) -> list[str]:
    return [m["Outcome"] for m in metric_lines(out) if "WebhookDeliveryAttempts" in m]


def report_failures(out: str) -> int:
    return sum(1 for m in metric_lines(out) if "WebhookReportFailures" in m)


def test_2xx_is_delivered_and_acked(world: World, capsys) -> None:
    world.http = HttpResult(204, None, False, 42)
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}

    (call,) = world.http_calls
    assert call["url"] == "https://hooks.example.test/in"
    assert call["body"] == BODY.encode("utf-8")
    assert call["timeout"] == 10.0
    assert call["connect_address"] == "93.184.216.34"
    assert call["headers"] == {
        "Content-Type": "application/json",
        "User-Agent": "DeveloperCards-Webhooks/1",
        "X-DeveloperCards-Event": "deck.published",
        "X-DeveloperCards-Delivery": DELIVERY_ID,
        "X-DeveloperCards-Timestamp": "1790000000",
        "X-DeveloperCards-Signature": sign_webhook("whsec-test", 1790000000, BODY),
    }
    assert world.sqs.calls == []

    ((base, path, payload, budget),) = world.reports
    assert base == "https://api.developercards.app"
    assert path == "/api/internal/webhooks/deliveries/report"
    assert payload == {
        "deliveryId": DELIVERY_ID,
        "attempt": 1,
        "outcome": "delivered",
        "statusCode": 204,
        "durationMs": 42,
        "error": None,
    }
    assert budget == pytest.approx(28.0)

    out = capsys.readouterr().out
    assert attempts_outcomes(out) == ["delivered"]
    latency = [m for m in metric_lines(out) if "WebhookDeliveryLatency" in m]
    assert [m["WebhookDeliveryLatency"] for m in latency] == [42]
    assert report_failures(out) == 0
    (log,) = [json.loads(l) for l in out.splitlines() if '"tag":"webhook_delivery"' in l]
    assert log["deliveryId"] == DELIVERY_ID and log["eventId"] == EVENT_ID
    assert log["event"] == "deck.published" and log["subscriptionId"] == 12
    assert log["host"] == "hooks.example.test" and log["attempt"] == 1
    assert log["outcome"] == "delivered" and log["statusCode"] == 204 and log["durationMs"] == 42


RETRYABLE = [
    HttpResult(503, None, False, 10),
    HttpResult(408, None, False, 10),
    HttpResult(429, None, False, 10),
    HttpResult(None, "timeout", True, 10),
]


@pytest.mark.parametrize(("n", "delay"), [(1, 30), (2, 120), (3, 480), (4, 900)])
@pytest.mark.parametrize("result", RETRYABLE, ids=["503", "408", "429", "timeout"])
def test_retryable_outcomes_back_off_30_120_480_900(world: World, capsys, n: int, delay: int, result: HttpResult) -> None:
    world.http = result
    response = handler.lambda_handler(sqs_event(n), Context())
    assert response == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert world.sqs.calls == [{"QueueUrl": QUEUE_URL, "ReceiptHandle": "rh-m-1", "VisibilityTimeout": delay}]
    ((_, _, payload, _),) = world.reports
    assert payload["outcome"] == "retry" and payload["attempt"] == n
    assert payload["statusCode"] == result.status
    assert payload["error"] == ("timeout" if result.timed_out else f"HTTP {result.status}")
    assert attempts_outcomes(capsys.readouterr().out) == ["retry"]


def test_connection_and_dns_errors_are_retryable(world: World) -> None:
    world.http = HttpResult(None, "connection error: ConnectionRefusedError", False, 3)
    assert handler.lambda_handler(sqs_event(2), Context())["batchItemFailures"] == [{"itemIdentifier": "m-1"}]
    assert world.reports[-1][2]["error"] == "connection error: ConnectionRefusedError"

    world.guard = GuardResult("dns_error", "DNS resolution failed", host="hooks.example.test")
    assert handler.lambda_handler(sqs_event(3), Context())["batchItemFailures"] == [{"itemIdentifier": "m-1"}]
    assert len(world.http_calls) == 1  # no request on a DNS failure
    assert world.reports[-1][2]["error"] == "DNS resolution failed"
    assert world.reports[-1][2]["outcome"] == "retry"
    assert [c["VisibilityTimeout"] for c in world.sqs.calls] == [120, 480]


def test_fifth_retryable_attempt_is_dead_and_not_acked(world: World, capsys) -> None:
    world.http = HttpResult(500, None, False, 10)
    response = handler.lambda_handler(sqs_event(5), Context())
    assert response == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert world.sqs.calls == []
    assert world.reports[0][2]["outcome"] == "dead"
    assert world.reports[0][2]["attempt"] == 5
    assert attempts_outcomes(capsys.readouterr().out) == ["dead"]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 422, 301, 302, 307])
def test_other_4xx_and_3xx_are_failed_and_acked(world: World, capsys, status: int) -> None:
    world.http = HttpResult(status, None, False, 10)
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}
    assert world.sqs.calls == []
    payload = world.reports[0][2]
    assert payload["outcome"] == "failed" and payload["statusCode"] == status
    assert payload["error"] == f"HTTP {status}"
    assert attempts_outcomes(capsys.readouterr().out) == ["failed"]


def test_url_rejected_sends_no_request_and_is_acked(world: World, capsys) -> None:
    world.guard = GuardResult("rejected", "resolves to a non-public address", host="hooks.example.test")
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}
    assert world.http_calls == []
    assert world.sqs.calls == []
    payload = world.reports[0][2]
    assert payload["outcome"] == "failed"
    assert payload["statusCode"] is None and payload["durationMs"] == 0
    assert payload["error"] == "URL_REJECTED: resolves to a non-public address"
    out = capsys.readouterr().out
    assert attempts_outcomes(out) == ["failed"]
    assert not [m for m in metric_lines(out) if "WebhookDeliveryLatency" in m]


def test_report_stop_true_acks_instead_of_retrying(world: World) -> None:
    world.http = HttpResult(503, None, False, 10)
    FakeInternalClient.result = InternalResult(True, 200, {"deliveryId": DELIVERY_ID, "status": "retrying", "stop": True}, None)
    assert handler.lambda_handler(sqs_event(2), Context()) == {"batchItemFailures": []}
    assert world.sqs.calls == []


def test_report_failure_does_not_change_the_decision(world: World, capsys) -> None:
    FakeInternalClient.result = InternalResult(False, 503, None, "HTTP 503")
    world.http = HttpResult(503, None, False, 10)
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert [c["VisibilityTimeout"] for c in world.sqs.calls] == [30]
    world.http = HttpResult(200, None, False, 10)
    assert handler.lambda_handler(sqs_event(2), Context()) == {"batchItemFailures": []}
    out = capsys.readouterr().out
    assert report_failures(out) == 2
    assert attempts_outcomes(out) == ["retry", "delivered"]

    # A missing internal secret skips the report and counts it as a failure.
    settings.clear_secret_cache()
    world.ssm.values[INTERNAL_NAME] = "PLACEHOLDER-set-by-supervisor"
    posts_before = len(world.reports)
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}
    assert len(world.reports) == posts_before
    assert report_failures(capsys.readouterr().out) == 1


@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "[]",
        json.dumps(message(v=2, deliveryId="not-a-uuid")),
        json.dumps(message(deliveryId="not-a-uuid")),
        json.dumps(message(eventId=5)),
        json.dumps(message(subscriptionId="12")),
        json.dumps(message(url=None)),
        json.dumps(message(body={"a": 1})),
        json.dumps({k: v for k, v in message().items() if k != "occurredAt"}),
    ],
)
def test_bad_message_shape_is_acked_without_retry(world: World, capsys, body: str) -> None:
    assert handler.lambda_handler(sqs_event(1, body=body), Context()) == {"batchItemFailures": []}
    assert world.http_calls == [] and world.reports == [] and world.sqs.calls == []
    out = capsys.readouterr().out
    assert attempts_outcomes(out) == []
    assert "webhook_bad_message" in out
    assert BODY not in out


@pytest.mark.parametrize(
    "body",
    [
        json.dumps(message(v=2)),
        json.dumps(message(v=True)),
        json.dumps({k: v for k, v in message().items() if k != "v"}),
        json.dumps({"v": 2, "deliveryId": DELIVERY_ID, "shape": "from a newer producer"}),
    ],
)
def test_unknown_message_version_goes_to_the_dlq_instead_of_being_dropped(world: World, capsys, body: str) -> None:
    # A newer producer's message is failed (SQS redrives it to the alarmed DLQ), never silently acked.
    assert handler.lambda_handler(sqs_event(1, body=body), Context()) == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert world.http_calls == [] and world.reports == [] and world.sqs.calls == []
    out = capsys.readouterr().out
    assert "webhook_unsupported_version" in out and "webhook_bad_message" not in out
    assert attempts_outcomes(out) == []
    assert BODY not in out


def test_rotation_sends_a_second_signature_made_with_the_previous_secret(world: World) -> None:
    world.ssm.values[SIGNING_NAME + "-previous"] = "whsec-old"
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}
    (call,) = world.http_calls
    headers = call["headers"]
    # The primary header is unchanged: bare hex over the current secret.
    assert headers["X-DeveloperCards-Signature"] == sign_webhook("whsec-test", 1790000000, BODY)
    assert headers["X-DeveloperCards-Signature-Previous"] == sign_webhook("whsec-old", 1790000000, BODY)

    # Rotation finished (previous parameter deleted): after the cache TTL only one signature goes out.
    del world.ssm.values[SIGNING_NAME + "-previous"]
    settings.clear_secret_cache()
    handler.lambda_handler(sqs_event(1), Context())
    assert "X-DeveloperCards-Signature-Previous" not in world.http_calls[-1]["headers"]

    # A previous value equal to the current one (or the placeholder) adds nothing.
    for value in ("whsec-test", "PLACEHOLDER-set-by-supervisor"):
        world.ssm.values[SIGNING_NAME + "-previous"] = value
        settings.clear_secret_cache()
        handler.lambda_handler(sqs_event(1), Context())
        assert "X-DeveloperCards-Signature-Previous" not in world.http_calls[-1]["headers"]


def test_missing_previous_secret_is_looked_up_once_per_ttl(world: World, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    lookups: list[str] = []
    original = world.ssm.get_parameter

    def counting(Name: str, WithDecryption: bool) -> dict[str, Any]:
        lookups.append(Name)
        return original(Name=Name, WithDecryption=WithDecryption)

    monkeypatch.setattr(world.ssm, "get_parameter", counting)
    for _ in range(3):
        assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": []}
    assert lookups.count(SIGNING_NAME + "-previous") == 1
    assert lookups.count(SIGNING_NAME) == 1
    # An absent optional parameter is normal: no warning.
    assert "ssm_secret_unavailable" not in capsys.readouterr().out


def test_attempt_timeout_leaves_time_to_report(world: World) -> None:
    class Short:
        def __init__(self, ms: int) -> None:
            self.ms = ms

        def get_remaining_time_in_millis(self) -> int:
            return self.ms

    handler.lambda_handler(sqs_event(1), Short(12_000))
    assert world.http_calls[-1]["timeout"] == pytest.approx(12.0 - handler.ATTEMPT_REPORT_RESERVE_S)
    handler.lambda_handler(sqs_event(1), Short(2_000))
    assert world.http_calls[-1]["timeout"] == handler.MIN_ATTEMPT_TIMEOUT_S
    handler.lambda_handler(sqs_event(1), Short(30_000))
    assert world.http_calls[-1]["timeout"] == 10.0
    handler.lambda_handler(sqs_event(1), None)
    assert world.http_calls[-1]["timeout"] == 10.0


def test_unexpected_exception_returns_batch_item_failure(world: World, capsys) -> None:
    world.http = RuntimeError("kaboom https://hooks.example.test/in")
    event = sqs_event(1, message_id="m-1")
    event["Records"].append(sqs_event(1, message_id="m-2")["Records"][0])
    event["Records"][1]["attributes"] = {}  # also unexpected: no receive count
    response = handler.lambda_handler(event, Context())
    assert response == {"batchItemFailures": [{"itemIdentifier": "m-1"}, {"itemIdentifier": "m-2"}]}
    out = capsys.readouterr().out
    assert "RuntimeError" in out and "KeyError" in out
    assert "kaboom" not in out


def test_missing_signing_secret_sends_nothing_and_retries(world: World, capsys) -> None:
    world.ssm.values[SIGNING_NAME] = "PLACEHOLDER-set-by-supervisor"
    response = handler.lambda_handler(sqs_event(1), Context())
    assert response == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert world.http_calls == [] and world.guard_calls == []
    assert [c["VisibilityTimeout"] for c in world.sqs.calls] == [30]
    payload = world.reports[0][2]
    assert payload["outcome"] == "retry" and payload["error"] == "SIGNING_SECRET_MISSING"

    # The fifth receive with the secret still unset goes to the DLQ path.
    assert handler.lambda_handler(sqs_event(5), Context()) == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert world.reports[-1][2]["outcome"] == "dead"

    # Once the supervisor sets the value, the next invocation delivers.
    world.ssm.values[SIGNING_NAME] = "whsec-test"
    assert handler.lambda_handler(sqs_event(2), Context()) == {"batchItemFailures": []}
    assert len(world.http_calls) == 1


def test_visibility_failure_still_fails_the_item(world: World, capsys) -> None:
    world.sqs.error = RuntimeError("AccessDenied")
    settings.set_clients(sqs=world.sqs)
    world.http = HttpResult(502, None, False, 10)
    assert handler.lambda_handler(sqs_event(1), Context()) == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}
    assert "webhook_visibility_failed" in capsys.readouterr().out


def test_logs_never_contain_url_path_body_or_secrets(world: World, capsys, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_LEVEL", "debug")
    url = "https://hooks.example.test/services/T000/B000/SECRETPATH?token=abc"
    signature = sign_webhook("whsec-test", 1790000000, BODY)
    for http in (HttpResult(200, None, False, 5), HttpResult(503, None, False, 5), HttpResult(None, "timeout", True, 5)):
        world.http = http
        FakeInternalClient.result = InternalResult(False, 500, None, "HTTP 500")
        handler.lambda_handler(sqs_event(1, body=message(url=url)), Context())
    world.guard = GuardResult("rejected", "address is not public", host="hooks.example.test")
    handler.lambda_handler(sqs_event(1, body=message(url=url)), Context())
    handler.lambda_handler(sqs_event(1, body=json.dumps(message(url=url, v=9))), Context())
    world.http = RuntimeError(url)
    world.guard = GuardResult("ok", host="hooks.example.test", addresses=("93.184.216.34",))
    handler.lambda_handler(sqs_event(1, body=message(url=url)), Context())

    out = capsys.readouterr().out
    assert "hooks.example.test" in out
    for forbidden in ("SECRETPATH", "token=abc", "/services/T000", "whsec-test", "test-secret", BODY, '"deckSlug"', signature):
        assert forbidden not in out, forbidden


def test_end_to_end_against_local_servers(local_server, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    """Real delivery.post_json and InternalClient against 127.0.0.1; only the guard and AWS are faked."""
    receiver = local_server(lambda s, c: (202, {}, b"ok"))

    def core(srv, captured):
        ts = captured.headers["x-internal-timestamp"]
        expected = "v1=" + hmac.new(b"test-secret", f"{ts}.".encode() + captured.body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(captured.headers["x-internal-signature"], expected):
            return 403, {}, b"{}"
        payload = json.loads(captured.body)
        data = {"deliveryId": payload["deliveryId"], "status": "delivered", "stop": False}
        return 200, {}, json.dumps({"success": True, "data": data, "error": None, "traceId": "t", "version": "v1"}).encode()

    core_server = local_server(core)
    settings.set_clients(ssm=FakeSSM({SIGNING_NAME: "whsec-test", INTERNAL_NAME: "test-secret"}), sqs=FakeSQS())
    monkeypatch.setenv("CORE_API_BASE", core_server.base_url)
    monkeypatch.setenv("WEBHOOK_HTTP_TIMEOUT_SECONDS", "2")
    monkeypatch.setattr(
        handler, "check_url", lambda url: GuardResult("ok", host="hooks.example.test", port=receiver.port, addresses=("127.0.0.1",))
    )
    url = f"http://hooks.example.test:{receiver.port}/in"
    assert handler.lambda_handler(sqs_event(1, body=message(url=url)), Context()) == {"batchItemFailures": []}

    (delivered,) = receiver.requests
    assert delivered.body == BODY.encode("utf-8")
    assert delivered.headers["Host"] == f"hooks.example.test:{receiver.port}"
    ts = int(delivered.headers["X-DeveloperCards-Timestamp"])
    assert delivered.headers["X-DeveloperCards-Signature"] == sign_webhook("whsec-test", ts, BODY)

    (report,) = core_server.requests
    payload = json.loads(report.body)
    assert report.body == canonical_body(payload).encode("ascii")
    assert payload["outcome"] == "delivered" and payload["statusCode"] == 202 and payload["attempt"] == 1
    assert report_failures(capsys.readouterr().out) == 0


def test_queue_url_is_derived_from_the_event_source_arn() -> None:
    assert handler.queue_url_from_arn(ARN) == QUEUE_URL
    with pytest.raises(ValueError):
        handler.queue_url_from_arn("arn:aws:sns:ap-southeast-2:123456789012:topic")

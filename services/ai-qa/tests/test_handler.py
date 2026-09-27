import hashlib
import hmac
import json
import time

import anthropic
import pytest
from conftest import FakeLlm, card, finding, reply, request, review_json, status_error

from ai_qa import handler, settings
from ai_qa.prompts import PROMPT_VERSION

SECRET = "test-secret"
INTERNAL_NAME = "/developercards/prod/internal-shared-secret"
KEY_NAME = "/developercards/prod/anthropic-api-key"
RUN_ID = "5f0c7a52-2b8e-4c1a-9d3e-7a1b2c3d4e5f"
ITEM_KEYS = {
    "cardId",
    "contentSha256",
    "status",
    "errorCode",
    "findings",
    "usage",
    "latencyMs",
    "requestId",
    "estimatedCostUsd",
}


class FakeSsm:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values
        self.calls: list[str] = []

    def get_parameter(self, Name: str, WithDecryption: bool):
        assert WithDecryption is True
        self.calls.append(Name)
        if Name not in self.values:
            raise RuntimeError("ParameterNotFound")
        return {"Parameter": {"Name": Name, "Value": self.values[Name]}}


class FakeContext:
    def __init__(self, remaining_s: float) -> None:
        self.remaining_ms = int(remaining_s * 1000)

    def get_remaining_time_in_millis(self) -> int:
        return self.remaining_ms


def verify_internal_signature(headers, raw_body: bytes) -> bool:
    """Mirror of Auth.VerifyInternalSignature (contract §4.3)."""
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
    """The J13 results route, contract-only: HMAC check, then the §7.7 envelope."""
    if captured.path != "/api/internal/ai-qa/results" or not verify_internal_signature(
        captured.headers, captured.body
    ):
        body = {"success": False, "data": None, "error": {"code": "FORBIDDEN"}, "traceId": "t", "version": "v1"}
        return 403, {"Content-Type": "application/json"}, json.dumps(body).encode()
    payload = json.loads(captured.body)
    data = {"runId": payload["runId"], "runStatus": "running", "cardsDone": len(payload["items"]), "cardCount": 5}
    envelope = {"success": True, "data": data, "error": None, "traceId": "t", "version": "v1"}
    return 200, {"Content-Type": "application/json"}, json.dumps(envelope).encode()


@pytest.fixture
def core(local_server, monkeypatch):
    srv = local_server(fake_core)
    monkeypatch.setenv("CORE_API_BASE", srv.base_url)
    return srv


@pytest.fixture
def ssm():
    fake = FakeSsm({INTERNAL_NAME: SECRET})
    settings.set_clients(ssm=fake)
    return fake


@pytest.fixture
def llm(monkeypatch):
    fake = FakeLlm()
    made = []

    def factory(cfg, *, api_key=None):
        made.append((cfg.provider, api_key))
        return fake

    monkeypatch.setattr(handler, "client_factory", factory)
    fake.made = made
    return fake


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("AI_QA_ENABLED", "1")


def message(cards=None, **over) -> str:
    body = {
        "v": 1,
        "runId": RUN_ID,
        "chunk": 0,
        "chunkCount": 1,
        "promptVersion": "qa-v1",
        "deck": {"id": 12, "slug": "claude-ccdv-f", "title": "Claude CCDV-F"},
        "reviewDate": "2026-10-01",
        "cards": cards if cards is not None else [card(0), card(1), card(2)],
    }
    body.update(over)
    return json.dumps(body)


def event(*bodies: str) -> dict:
    return {"Records": [{"messageId": f"m-{i}", "body": body} for i, body in enumerate(bodies)]}


def reports(core) -> list[dict]:
    return [json.loads(r.body) for r in core.requests]


def test_disabled_reports_every_card_skipped_without_model_calls(core, ssm, llm, monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "anthropic")  # proves the key is not read when disabled
    result = handler.lambda_handler(event(message()), FakeContext(600))
    assert result == {"batchItemFailures": []}
    assert llm.calls == [] and llm.made == []
    assert ssm.calls == [INTERNAL_NAME]
    (body,) = reports(core)
    assert [i["cardId"] for i in body["items"]] == [101, 102, 103]
    for item in body["items"]:
        assert set(item) == ITEM_KEYS
        assert item["status"] == "skipped" and item["errorCode"] == "DISABLED"
        assert item["usage"] == {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0}
        assert item["findings"] == [] and item["estimatedCostUsd"] == 0.0


def test_happy_chunk_reports_all_items_and_acks(core, ssm, llm, enabled, capsys) -> None:
    llm.script = [
        reply(review_json(), request_id="req_1"),
        reply(review_json(finding("major", "outdated_fact", "Changed in 2025.", None)), request_id="req_2"),
        reply(review_json(), request_id="req_3"),
    ]
    result = handler.lambda_handler(event(message()), None)
    assert result == {"batchItemFailures": []}
    assert len(llm.calls) == 3
    assert llm.made == [("bedrock", None)]  # bedrock: no key read
    assert ssm.calls == [INTERNAL_NAME]
    (body,) = reports(core)
    assert [i["status"] for i in body["items"]] == ["done"] * 3
    assert [i["requestId"] for i in body["items"]] == ["req_1", "req_2", "req_3"]
    assert body["items"][1]["findings"][0]["cardId"] == 102
    out = capsys.readouterr().out
    assert "Nightly database dumps" not in out  # no card text in logs
    assert "Changed in 2025." not in out  # no model output in logs
    assert SECRET not in out

    # The client is cached per container: a second message builds no new client.
    llm.script = [reply(review_json())]
    handler.lambda_handler(event(message([card(0)])), None)
    assert len(llm.made) == 1


@pytest.mark.parametrize(
    "exc,code",
    [
        (lambda: status_error(anthropic.AuthenticationError, 401), "PROVIDER_AUTH"),
        (lambda: status_error(anthropic.PermissionDeniedError, 403), "PROVIDER_ACCESS_DENIED"),
        (lambda: status_error(anthropic.NotFoundError, 404), "CONFIG"),
    ],
)
def test_fail_fast_codes_fill_the_rest_of_the_chunk_without_calls(core, ssm, llm, enabled, exc, code) -> None:
    llm.script = [reply(review_json()), exc()]
    result = handler.lambda_handler(event(message()), FakeContext(600))
    assert result == {"batchItemFailures": []}  # deterministic: acked
    assert len(llm.calls) == 2
    (body,) = reports(core)
    assert [(i["status"], i["errorCode"]) for i in body["items"]] == [
        ("done", None),
        ("error", code),
        ("error", code),
    ]
    assert body["items"][2]["usage"]["inputTokens"] == 0


@pytest.mark.parametrize(
    "exc,code",
    [
        (lambda: status_error(anthropic.RateLimitError, 429), "PROVIDER_RATE_LIMITED"),
        (lambda: status_error(anthropic.InternalServerError, 500), "PROVIDER_ERROR"),
        (lambda: anthropic.APITimeoutError(request=request()), "PROVIDER_TIMEOUT"),
    ],
)
def test_retryable_codes_report_finished_items_then_fail_the_message(core, ssm, llm, enabled, exc, code, capsys) -> None:
    llm.script = [reply(review_json()), exc()]
    result = handler.lambda_handler(event(message()), FakeContext(600))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert len(llm.calls) == 2
    (body,) = reports(core)
    assert [(i["cardId"], i["status"]) for i in body["items"]] == [(101, "done")]
    assert f'"ErrorCode":"{code}"' in capsys.readouterr().out

    # First card fails: nothing finished, nothing reported.
    core.requests.clear()
    llm.script = [exc()]
    result = handler.lambda_handler(event(message()), FakeContext(600))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert core.requests == []


ARN = "arn:aws:sqs:ap-southeast-2:123456789012:developercards-ai-qa-jobs"
QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/123456789012/developercards-ai-qa-jobs"


class FakeSqs:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[dict] = []
        self.error = error

    def change_message_visibility(self, **kwargs) -> None:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error


def sqs_record_event(body: str, n: int = 1) -> dict:
    return {
        "Records": [
            {
                "messageId": "m-0",
                "receiptHandle": f"rh-{n}",
                "body": body,
                "attributes": {"ApproximateReceiveCount": str(n)},
                "eventSourceARN": ARN,
            }
        ]
    }


def test_redelivered_chunk_makes_no_model_call_for_cards_already_reported(core, ssm, llm, enabled, monkeypatch) -> None:
    sqs = FakeSqs()
    settings.set_clients(sqs=sqs)
    monkeypatch.setattr(handler, "jitter", lambda lo, hi: 97.6)

    # Receive 1: card 101 done, card 102 rate limited.
    llm.script = [reply(review_json(finding())), status_error(anthropic.RateLimitError, 429)]
    result = handler.lambda_handler(sqs_record_event(message(), n=1), FakeContext(600))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert [(i["cardId"], i["status"]) for i in reports(core)[0]["items"]] == [(101, "done")]
    # Back in 60-120 s, not after the queue's 3600 s visibility.
    assert sqs.calls == [{"QueueUrl": QUEUE_URL, "ReceiptHandle": "rh-1", "VisibilityTimeout": 97}]

    # Receive 2: only 102 and 103 reach the model; 101 is neither reviewed nor reported again.
    llm.calls.clear()
    llm.script = [reply(review_json()), reply(review_json())]
    result = handler.lambda_handler(sqs_record_event(message(), n=2), FakeContext(600))
    assert result == {"batchItemFailures": []}
    assert len(llm.calls) == 2
    assert [i["cardId"] for i in reports(core)[1]["items"]] == [102, 103]
    assert len(sqs.calls) == 1

    # A third copy (SQS at-least-once) has nothing left to do: no call, no report, acked.
    llm.calls.clear()
    assert handler.lambda_handler(sqs_record_event(message(), n=3), FakeContext(600)) == {"batchItemFailures": []}
    assert llm.calls == [] and len(core.requests) == 2


def test_unreported_cards_are_reviewed_again_on_redelivery(local_server, ssm, llm, enabled, monkeypatch) -> None:
    # A failed report is not remembered: the redelivery must review and report the card again.
    answers = iter([400, 200])

    def flaky_core(srv, captured):
        status = next(answers)
        if status != 200:
            return status, {}, b"{}"
        return fake_core(srv, captured)

    srv = local_server(flaky_core)
    monkeypatch.setenv("CORE_API_BASE", srv.base_url)
    settings.set_clients(sqs=FakeSqs())
    llm.script = [reply(review_json()), status_error(anthropic.InternalServerError, 500)]
    assert handler.lambda_handler(sqs_record_event(message(), n=1), FakeContext(600))["batchItemFailures"]
    llm.calls.clear()
    llm.script = [reply(review_json())] * 3
    assert handler.lambda_handler(sqs_record_event(message(), n=2), FakeContext(600)) == {"batchItemFailures": []}
    assert len(llm.calls) == 3


def test_remembered_items_are_keyed_by_content_hash(core, ssm, llm, enabled) -> None:
    llm.script = [reply(review_json())]
    handler.lambda_handler(event(message([card(0)])), FakeContext(600))
    edited = {**card(0), "contentSha256": "d" * 64}
    llm.script = [reply(review_json())]
    assert handler.lambda_handler(event(message([edited])), FakeContext(600)) == {"batchItemFailures": []}
    assert len(llm.calls) == 2


def test_visibility_change_failure_still_fails_the_message(core, ssm, llm, enabled, capsys) -> None:
    settings.set_clients(sqs=FakeSqs(error=RuntimeError("AccessDenied")))
    llm.script = [status_error(anthropic.RateLimitError, 429)]
    result = handler.lambda_handler(sqs_record_event(message(), n=1), FakeContext(600))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    out = capsys.readouterr().out
    assert '"visibility_failed"' in out and "RuntimeError" in out and "AccessDenied" not in out


def test_per_card_outcomes_do_not_stop_the_chunk(core, ssm, llm, enabled) -> None:
    llm.script = [
        reply(None, stop_reason="refusal"),
        reply("{", stop_reason="max_tokens"),
        reply("nope"),
        reply("still nope"),
    ]
    result = handler.lambda_handler(event(message()), None)
    assert result == {"batchItemFailures": []}
    (body,) = reports(core)
    assert [(i["status"], i["errorCode"]) for i in body["items"]] == [
        ("refused", "REFUSAL"),
        ("error", "MAX_TOKENS"),
        ("error", "SCHEMA_INVALID"),
    ]


def test_placeholder_api_key_is_config_error(core, llm, enabled, monkeypatch) -> None:
    monkeypatch.setattr(handler, "client_factory", handler.make_client)  # the real factory
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    fake_ssm = FakeSsm({INTERNAL_NAME: SECRET, KEY_NAME: "PLACEHOLDER-set-by-supervisor"})
    settings.set_clients(ssm=fake_ssm)
    result = handler.lambda_handler(event(message()), FakeContext(600))
    assert result == {"batchItemFailures": []}
    assert fake_ssm.calls == [INTERNAL_NAME, KEY_NAME]
    assert llm.calls == []
    (body,) = reports(core)
    assert body["provider"] == "anthropic" and body["model"] == "claude-opus-5"
    assert [(i["status"], i["errorCode"]) for i in body["items"]] == [("error", "CONFIG")] * 3


def test_invalid_settings_report_config_without_calls(core, ssm, llm, enabled, monkeypatch) -> None:
    monkeypatch.setenv("AI_MODEL", "claude-opus-5")  # a first-party id is never sent to Bedrock
    result = handler.lambda_handler(event(message()), None)
    assert result == {"batchItemFailures": []}
    assert llm.calls == [] and llm.made == []
    (body,) = reports(core)
    assert [i["errorCode"] for i in body["items"]] == ["CONFIG"] * 3
    assert body["provider"] == "bedrock"


def test_missing_internal_secret_fails_the_message_without_model_calls(core, llm, enabled) -> None:
    settings.set_clients(ssm=FakeSsm({INTERNAL_NAME: "PLACEHOLDER-set-by-supervisor"}))
    result = handler.lambda_handler(event(message()), None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert llm.calls == [] and llm.made == []
    assert core.requests == []


def test_deadline_guard_stops_before_the_lambda_timeout(core, ssm, llm, enabled) -> None:
    result = handler.lambda_handler(event(message()), FakeContext(100))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert llm.calls == [] and llm.options == []
    assert core.requests == []

    llm.script = [reply(review_json())]
    result = handler.lambda_handler(event(message([card(0)])), FakeContext(300))
    assert result == {"batchItemFailures": []}
    assert llm.options == [{"timeout": 120.0, "max_retries": 0}]

    llm.options.clear()
    handler.reset_client_cache()  # a fresh container: card 101 was already reported by this one
    llm.script = [reply(review_json())]
    handler.lambda_handler(event(message([card(0)])), FakeContext(160))
    assert llm.options == [{"timeout": 120.0, "max_retries": 0}]

    llm.options.clear()
    handler.reset_client_cache()
    llm.script = [reply(review_json())]
    handler.lambda_handler(event(message([card(0)])), FakeContext(600))
    assert llm.options == [{"timeout": 120.0, "max_retries": 2}]
    assert handler.DEADLINE_MARGIN_SECONDS == 150 and handler.CALL_TIMEOUT_SECONDS == 120


@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "[]",
        message(v=2),
        message(runId=7),
        message(chunk=-1),
        message(chunk=True),
        message(chunkCount=0),
        message(promptVersion=None),
        message(deck="aws"),
        message(reviewDate="2026-13-01"),
        message(reviewDate="01/10/2026"),
        message(cards=[]),
        message(cards=[{**card(0), "cardId": "101"}]),
        message(cards=[{**card(0), "contentSha256": None}]),
        message(cards=[{k: v for k, v in card(0).items() if k != "explanation"}]),
        message(cards=[{**card(0), "difficulty": 2.5}]),
        message(cards=["card"]),
    ],
)
def test_bad_message_shape_is_acked(core, ssm, llm, enabled, body) -> None:
    result = handler.lambda_handler(event(body), None)
    assert result == {"batchItemFailures": []}
    assert llm.calls == [] and core.requests == []


def test_report_failure_fails_the_message(local_server, ssm, llm, enabled, monkeypatch) -> None:
    down = local_server(lambda s, c: (503, {}, b""))
    monkeypatch.setenv("CORE_API_BASE", down.base_url)
    llm.script = [reply(review_json())]
    result = handler.lambda_handler(event(message([card(0)])), None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert len(down.requests) == 2  # one retry on 5xx

    rejecting = local_server(lambda s, c: (403, {}, b"{}"))
    monkeypatch.setenv("CORE_API_BASE", rejecting.base_url)
    llm.script = [reply(review_json()), reply(review_json())]
    result = handler.lambda_handler(event(message([card(0)]), message([card(1)])), FakeContext(600))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}, {"itemIdentifier": "m-1"}]}
    assert len(rejecting.requests) == 2  # 403 is not retried
    assert llm.script == []


def test_unexpected_exception_fails_only_that_record(core, ssm, llm, enabled) -> None:
    llm.script = [KeyError("boom"), reply(review_json())]
    result = handler.lambda_handler(event(message([card(0)]), message([card(1)])), None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-0"}]}
    assert len(reports(core)) == 1


def test_results_body_matches_contract(core, ssm, llm, enabled, monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("AI_MODEL", "claude-opus-5")
    ssm.values[KEY_NAME] = "test-key"
    llm.script = [reply(review_json(finding("blocker", "incorrect_answer", "Wrong class.", "Use Deep Archive?")))]
    result = handler.lambda_handler(event(message([card(1)], chunk=2, chunkCount=3, promptVersion="qa-v0")), None)
    assert result == {"batchItemFailures": []}
    assert llm.made == [("anthropic", "test-key")]
    (captured,) = core.requests
    assert captured.path == "/api/internal/ai-qa/results"
    assert verify_internal_signature(captured.headers, captured.body)
    assert captured.headers["content-type"] == "application/json"
    captured.body.decode("ascii")  # the bytes sent are ASCII
    body = json.loads(captured.body)
    assert captured.body == json.dumps(body, separators=(",", ":"), ensure_ascii=True, sort_keys=True).encode()
    assert set(body) == {"v", "runId", "chunk", "provider", "model", "promptVersion", "items"}
    assert body["v"] == 1 and body["runId"] == RUN_ID and body["chunk"] == 2
    assert body["provider"] == "anthropic" and body["model"] == "claude-opus-5"
    assert body["promptVersion"] == PROMPT_VERSION  # what actually ran, not what was asked
    (item,) = body["items"]
    assert set(item) == ITEM_KEYS
    assert item["cardId"] == 102 and item["contentSha256"] == "b" * 64
    assert item["status"] == "done" and item["errorCode"] is None
    assert item["findings"] == [
        {
            "cardId": 102,
            "severity": "blocker",
            "category": "incorrect_answer",
            "message": "Wrong class.",
            "suggestedFix": "Use Deep Archive?",
        }
    ]
    assert set(item["usage"]) == {"inputTokens", "outputTokens", "cacheReadInputTokens"}
    assert isinstance(item["latencyMs"], int) and isinstance(item["estimatedCostUsd"], float)
    assert item["requestId"] == "req_test_1"

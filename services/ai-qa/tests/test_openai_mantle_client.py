"""OpenAiMantleClient (provider openai-mantle, C03 / R18C contract L1) against a fake HTTP transport and
fake credentials: no AWS call and no model call is ever made."""

import dataclasses
import json

import pytest
from botocore.credentials import Credentials
from conftest import card, finding, review_json
from test_handler import INTERNAL_NAME, SECRET, FakeSsm, event, fake_core, message, reports
from test_profiles import DRAFT_ID, draft_card, set_env

from ai_qa import handler, openai_mantle_client, profiles, providers, settings
from ai_qa.openai_mantle_client import MantleConnectionError, MantleError, OpenAiMantleClient
from ai_qa.prompts import SYSTEM_PROMPT_AUTOMATION
from ai_qa.review import error_code_for, request_kwargs, review_card
from ai_qa.settings import ConfigError, load_settings

MODEL = "openai.gpt-5.5"
REVIEW_DATE = "2026-10-01"
URL = "https://bedrock-mantle.us-east-1.api.aws/openai/v1/chat/completions"
MANTLE = load_settings(
    {
        "AI_PROVIDER": "openai-mantle",
        "AI_MODEL": MODEL,
        "AI_EFFORT": "high",
        "AI_PRICE_INPUT_PER_MTOK": "5.5",
        "AI_PRICE_OUTPUT_PER_MTOK": "33",
    }
)
AUTOMATION_ENV = {
    "AI_QA_AUTOMATION_PROVIDER": "openai-mantle",
    "AI_QA_AUTOMATION_MODEL": MODEL,
    "AI_QA_AUTOMATION_REGION": "us-east-1",
    "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "5.5",
    "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK": "33",
}


def fake_credentials() -> Credentials:
    return Credentials("AKIDEXAMPLE", "not-a-real-secret-key", "session-token")


def completion(
    text="{}", finish="stop", prompt_tokens=1000, completion_tokens=200, cached=0, refusal=None, request_id="mantle-1"
):
    body = {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "model": MODEL,
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": text, "refusal": refusal}, "finish_reason": finish}
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "prompt_tokens_details": {"cached_tokens": cached},
        },
    }
    headers = {"Content-Type": "application/json"}
    if request_id is not None:
        headers["x-amzn-RequestId"] = request_id
    return 200, headers, json.dumps(body).encode()


def error_reply(status, message="error", code=None, request_id="mantle-err"):
    error = {"message": message, "type": "invalid_request_error"}
    if code is not None:
        error["code"] = code
    return status, {"x-amzn-RequestId": request_id}, json.dumps({"error": error}).encode()


class FakeTransport:
    """Records every request; `script` items are (status, headers, body) replies or exceptions."""

    def __init__(self, *script):
        self.script = list(script)
        self.requests = []

    def __call__(self, url, headers, body, timeout):
        self.requests.append({"url": url, "headers": headers, "body": json.loads(body), "timeout": timeout})
        if not self.script:
            raise AssertionError("FakeTransport: no scripted reply left")
        nxt = self.script.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt


def client_with(*script, max_retries=2, timeout=120.0, region="us-east-1"):
    transport = FakeTransport(*script)
    sleeps = []
    client = OpenAiMantleClient(
        region=region,
        timeout=timeout,
        max_retries=max_retries,
        transport=transport,
        credentials_provider=fake_credentials,
        sleep=sleeps.append,
    )
    return client, transport, sleeps


# --- request ------------------------------------------------------------------------------------


def test_request_is_chat_completions_on_bedrock_mantle_signed_for_bedrock_mantle() -> None:
    client, transport, _ = client_with(completion())
    kwargs = request_kwargs(MANTLE, [{"role": "user", "content": "Review this card."}], structured=False)
    client.messages.create(**kwargs)

    (sent,) = transport.requests
    assert sent["url"] == URL
    assert sent["timeout"] == 120.0
    assert sent["body"] == {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": kwargs["system"][0]["text"]},
            {"role": "user", "content": "Review this card."},
        ],
        "max_completion_tokens": 16000,
        "reasoning_effort": "high",
    }
    headers = {key.lower(): value for key, value in sent["headers"].items()}
    assert headers["content-type"] == "application/json"
    assert headers["authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")
    assert "/us-east-1/bedrock-mantle/aws4_request" in headers["authorization"]
    assert headers["x-amz-security-token"] == "session-token"
    assert "x-amz-date" in headers


def test_region_comes_from_the_client() -> None:
    client, transport, _ = client_with(completion(), region="us-east-2")
    client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=10)
    assert transport.requests[0]["url"] == "https://bedrock-mantle.us-east-2.api.aws/openai/v1/chat/completions"
    assert "/us-east-2/bedrock-mantle/aws4_request" in transport.requests[0]["headers"]["Authorization"]


def test_assistant_blocks_are_flattened_and_blank_turns_filled() -> None:
    client, transport, _ = client_with(completion())
    client.messages.create(
        model=MODEL,
        system=[{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
        messages=[
            {"role": "user", "content": "u1"},
            {"role": "assistant", "content": [{"type": "thinking", "thinking": "x"}, {"type": "text", "text": "t"}]},
            {"role": "user", "content": [{"type": "text", "text": "u2"}]},
            {"role": "assistant", "content": []},
        ],
        max_tokens=50,
        thinking={"type": "adaptive"},
    )
    body = transport.requests[0]["body"]
    assert body["messages"] == [
        {"role": "system", "content": "a\nb"},
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "t"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": openai_mantle_client.EMPTY_TURN_TEXT},
    ]
    assert "reasoning_effort" not in body  # no output_config: nothing to send


@pytest.mark.parametrize(
    "effort,sent", [("low", "low"), ("medium", "medium"), ("high", "high"), ("xhigh", "xhigh"), ("max", "xhigh")]
)
def test_ai_effort_is_sent_as_reasoning_effort_and_recorded(effort, sent) -> None:
    """ai-agent-9: the effort is sent, and effective_effort names exactly what was sent."""
    cfg = dataclasses.replace(MANTLE, effort=effort)
    client, transport, _ = client_with(completion())
    client.messages.create(**request_kwargs(cfg, [{"role": "user", "content": "x"}], structured=False))
    assert transport.requests[0]["body"]["reasoning_effort"] == sent
    assert providers.effective_effort(cfg) == sent


def test_structured_output_format_is_rejected_and_off() -> None:
    client, transport, _ = client_with()
    with pytest.raises(ConfigError):
        client.messages.create(**request_kwargs(MANTLE, [{"role": "user", "content": "x"}], structured=True))
    assert transport.requests == []
    assert providers.structured_outputs_on(MANTLE) is False
    assert providers.structured_outputs_on(dataclasses.replace(MANTLE, structured_outputs="on")) is False


def test_missing_credentials_are_config() -> None:
    client = OpenAiMantleClient(transport=FakeTransport(), credentials_provider=lambda: None)
    with pytest.raises(ConfigError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=10)
    assert error_code_for(info.value) == "CONFIG"


# --- response -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "finish,mapped",
    [("stop", "end_turn"), ("length", "max_tokens"), ("content_filter", "refusal"), ("tool_calls", "tool_calls")],
)
def test_finish_reason_maps_to_stop_reason(finish, mapped) -> None:
    client, _, _ = client_with(completion(finish=finish))
    response = client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert response.stop_reason == mapped
    assert response.raw_stop_reason == finish


def test_usage_and_request_id_are_mapped() -> None:
    client, _, _ = client_with(completion(text='{"findings":[]}', prompt_tokens=1200, completion_tokens=300, cached=200))
    response = client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert response.content[0].type == "text" and response.content[0].text == '{"findings":[]}'
    # prompt_tokens includes the cached tokens; the Anthropic shape counts them apart.
    assert (response.usage.input_tokens, response.usage.cache_read_input_tokens) == (1000, 200)
    assert (response.usage.output_tokens, response.usage.cache_creation_input_tokens) == (300, 0)
    assert response._request_id == "mantle-1"
    no_header, _, _ = client_with(completion(request_id=None))
    reply = no_header.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert reply._request_id == "chatcmpl-1"


def test_refusal_message_reads_as_a_refusal() -> None:
    client, _, _ = client_with(completion(text=None, refusal="I can't help with that."))
    response = client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert response.stop_reason == "refusal" and response.content[0].text == ""


def test_review_card_end_to_end_with_the_automation_prices() -> None:
    body = review_json(finding("major", "incorrect_answer"))
    client, transport, _ = client_with(completion(text=body, prompt_tokens=1000, completion_tokens=100))
    item = review_card(card(7), client=client, settings=MANTLE, review_date=REVIEW_DATE)
    assert item["status"] == "done" and [f["category"] for f in item["findings"]] == ["incorrect_answer"]
    assert item["usage"]["inputTokens"] == 1000 and item["usage"]["outputTokens"] == 100
    assert item["requestId"] == "mantle-1"
    assert item["estimatedCostUsd"] == pytest.approx((1000 * 5.5 + 100 * 33) / 1_000_000)
    assert len(transport.requests) == 1


def test_non_json_reply_is_a_provider_error() -> None:
    client, _, _ = client_with((200, {}, b"<html>"))
    with pytest.raises(MantleError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert error_code_for(info.value) == "PROVIDER_ERROR"


# --- errors and retries -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "reply,code",
    [
        (error_reply(401, "The security token included in the request is invalid."), "PROVIDER_AUTH"),
        (error_reply(403, "User is not authorized to perform: bedrock-mantle:CreateInference"), "PROVIDER_ACCESS_DENIED"),
        # The Bedrock allowlisting answers (review.ACCESS_DENIED_MARKERS) on a 400.
        (error_reply(400, "Operation not allowed. Please verify you are a corporate customer."), "PROVIDER_ACCESS_DENIED"),
        (error_reply(400, "Access to this model is not allowed in your account."), "PROVIDER_ACCESS_DENIED"),
        (error_reply(400, "You don't have access to the model with the specified model ID."), "PROVIDER_ACCESS_DENIED"),
        (error_reply(400, "Unsupported value: 'reasoning_effort'."), "CONFIG"),
        (error_reply(404, "The model openai.gpt-5.5 does not exist."), "CONFIG"),
        (error_reply(400, "denied", code="AccessDeniedException"), "PROVIDER_ACCESS_DENIED"),
        (error_reply(408, "timeout"), "PROVIDER_TIMEOUT"),
        (
            (400, {"x-amzn-ErrorType": "ValidationException:http://internal"}, b'{"message":"bad"}'),
            "CONFIG",
        ),
    ],
)
def test_error_answers_map_to_the_bounded_codes(reply, code) -> None:
    client, transport, sleeps = client_with(reply)
    with pytest.raises(MantleError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert error_code_for(info.value) == code
    assert len(transport.requests) == 1 and sleeps == []  # a 4xx other than 429 is never retried


def test_error_keeps_the_request_id_and_a_bounded_message() -> None:
    client, _, _ = client_with(error_reply(400, "x" * 5000))
    with pytest.raises(MantleError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert info.value.request_id == "mantle-err"
    assert len(info.value.message) == openai_mantle_client.MAX_ERROR_MESSAGE_CHARS
    assert "x" * 50 not in str(info.value)  # str() never carries the provider text


@pytest.mark.parametrize("status,code", [(429, "PROVIDER_RATE_LIMITED"), (500, "PROVIDER_ERROR"), (503, "PROVIDER_ERROR")])
def test_retryable_statuses_are_retried_then_mapped(status, code) -> None:
    client, transport, sleeps = client_with(*[error_reply(status)] * 3, max_retries=2)
    with pytest.raises(MantleError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert error_code_for(info.value) == code
    assert len(transport.requests) == 3 and sleeps == [0.5, 1.0]


def test_a_retry_that_succeeds_returns_the_reply() -> None:
    client, transport, sleeps = client_with(error_reply(503), MantleConnectionError("URLError"), completion())
    response = client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert response.stop_reason == "end_turn"
    assert len(transport.requests) == 3 and sleeps == [0.5, 1.0]


def test_connection_errors_are_provider_timeout() -> None:
    client, transport, _ = client_with(MantleConnectionError("TimeoutError"), max_retries=0)
    with pytest.raises(MantleConnectionError) as info:
        client.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert error_code_for(info.value) == "PROVIDER_TIMEOUT"
    assert len(transport.requests) == 1


def test_with_options_sets_timeout_and_retries_and_keeps_the_transport() -> None:
    client, transport, _ = client_with(completion(), max_retries=2, timeout=120.0)
    assert client.with_options() is client
    variant = client.with_options(timeout=30.0, max_retries=0)
    assert (variant.timeout, variant.max_retries, variant.region) == (30.0, 0, "us-east-1")
    assert client.with_options(timeout=30.0, max_retries=0) is variant
    variant.messages.create(model=MODEL, system="s", messages=[{"role": "user", "content": "u"}], max_tokens=9)
    assert transport.requests[0]["timeout"] == 30.0


def test_urllib_transport_maps_no_response_to_a_connection_error(monkeypatch) -> None:
    def refuse(*_args, **_kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(openai_mantle_client.urllib.request, "urlopen", refuse)
    with pytest.raises(MantleConnectionError):
        openai_mantle_client._urllib_transport(URL, {}, b"{}", 1.0)


# --- settings, profile and client wiring --------------------------------------------------------


def test_make_client_builds_the_mantle_client_in_the_automation_region() -> None:
    cfg = load_settings({**AUTOMATION_ENV, "AI_QA_AUTOMATION_REGION": "us-east-2"})
    derived = profiles.settings_for(cfg, "automation")
    client = providers.make_client(derived)
    assert isinstance(client, OpenAiMantleClient)
    assert client.url == "https://bedrock-mantle.us-east-2.api.aws/openai/v1/chat/completions"
    assert (client.timeout, client.max_retries) == (providers.CLIENT_TIMEOUT_SECONDS, providers.CLIENT_MAX_RETRIES)
    # The human reviewer and its region are untouched.
    assert (derived.bedrock_region, cfg.provider, cfg.bedrock_region) == ("ap-southeast-2", "bedrock", "ap-southeast-2")


def test_automation_region_defaults_to_us_east_1() -> None:
    assert load_settings({}).automation_region == "us-east-1"
    assert load_settings({"AI_QA_AUTOMATION_REGION": "  "}).automation_region == "us-east-1"


def test_an_invalid_region_fails_only_the_automation_profile() -> None:
    cfg = load_settings({**AUTOMATION_ENV, "AI_QA_AUTOMATION_REGION": "https://evil.example"})
    assert cfg.automation_region == "us-east-1"
    assert profiles.settings_for(cfg, "default") is cfg
    with pytest.raises(ConfigError, match="AI_QA_AUTOMATION_REGION"):
        profiles.settings_for(cfg, "automation")


@pytest.mark.parametrize(
    "env,error",
    [
        ({"AI_PROVIDER": "openai-mantle"}, "AI_MODEL is required"),
        ({"AI_PROVIDER": "openai-mantle", "AI_MODEL": "anthropic.claude-opus-5"}, "must not be an 'anthropic.'"),
    ],
)
def test_openai_mantle_needs_a_non_claude_model(env, error) -> None:
    with pytest.raises(ConfigError, match=error):
        load_settings(env)


class TestHandler:
    """The automation profile end to end through the handler with the real adapter on a fake transport."""

    @pytest.fixture
    def harness(self, local_server, monkeypatch):
        srv = local_server(fake_core)
        monkeypatch.setenv("CORE_API_BASE", srv.base_url)
        settings.set_clients(ssm=FakeSsm({INTERNAL_NAME: SECRET}))
        transport = FakeTransport()
        made = []

        def factory(cfg, *, api_key=None):
            made.append(cfg)
            return OpenAiMantleClient(
                region=cfg.automation_region,
                timeout=providers.CLIENT_TIMEOUT_SECONDS,
                max_retries=providers.CLIENT_MAX_RETRIES,
                transport=transport,
                credentials_provider=fake_credentials,
                sleep=lambda _s: None,
            )

        monkeypatch.setattr(handler, "client_factory", factory)
        return srv, transport, made

    def test_draft_is_reviewed_on_bedrock_mantle_with_the_effort_sent(self, harness, monkeypatch, capsys) -> None:
        core, transport, made = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1", "AI_EFFORT": "high"})
        transport.script = [completion(text=review_json(), prompt_tokens=1000, completion_tokens=100)]
        result = handler.lambda_handler(event(message([draft_card()], target="draft", profile="automation")), None)
        assert result == {"batchItemFailures": []}
        assert [cfg.provider for cfg in made] == ["openai-mantle"]

        (sent,) = transport.requests
        assert sent["url"] == URL
        assert sent["body"]["model"] == MODEL and sent["body"]["reasoning_effort"] == "high"
        assert sent["body"]["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT_AUTOMATION}

        (report,) = reports(core)
        assert (report["provider"], report["model"], report["profile"]) == ("openai-mantle", MODEL, "automation")
        (item,) = report["items"]
        assert (item["cardId"], item["status"]) == (DRAFT_ID, "done")
        assert item["estimatedCostUsd"] == pytest.approx((1000 * 5.5 + 100 * 33) / 1_000_000)

        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
        assert not [line for line in lines if line.get("event") == "effort_not_sent"]
        (result_line,) = [line for line in lines if line.get("event") == "card_result"]
        assert result_line["effort"] == "high"

    def test_allowlisting_error_fails_fast_as_access_denied(self, harness, monkeypatch) -> None:
        core, transport, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        transport.script = [error_reply(400, "Operation not allowed. Please verify you are a corporate customer.")]
        result = handler.lambda_handler(event(message([draft_card()], target="draft", profile="automation")), None)
        assert result == {"batchItemFailures": []}
        (report,) = reports(core)
        assert [(i["status"], i["errorCode"]) for i in report["items"]] == [("error", "PROVIDER_ACCESS_DENIED")]
        assert len(transport.requests) == 1

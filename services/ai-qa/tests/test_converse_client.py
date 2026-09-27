"""ConverseClient against a stubbed bedrock-runtime client (botocore Stubber): no AWS call is made."""

import boto3
import botocore.exceptions
import pytest
from botocore.stub import ANY, Stubber
from conftest import FakeLlm, card, finding, review_json

from ai_qa import converse_client, providers
from ai_qa.converse_client import ConverseClient
from ai_qa.prompts import SYSTEM_PROMPT
from ai_qa.review import error_code_for, request_kwargs, review_card
from ai_qa.settings import ConfigError, load_settings

MODEL = "global.openai.gpt-5.5"
REVIEW_DATE = "2026-10-01"
CONVERSE = load_settings(
    {
        "AI_PROVIDER": "bedrock-converse",
        "AI_MODEL": MODEL,
        "AI_PRICE_INPUT_PER_MTOK": "2",
        "AI_PRICE_OUTPUT_PER_MTOK": "10",
    }
)


class Runtimes:
    """A runtime factory that records each botocore Config and hands out stubbed clients."""

    def __init__(self) -> None:
        self.made: list[tuple[str, object]] = []
        self.stubbers: list[Stubber] = []

    def __call__(self, region, config):
        # botocore rewrites config.retries while building the client: record what was asked for.
        self.made.append((region, {"read_timeout": config.read_timeout, "retries": dict(config.retries)}))
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=config,
            aws_access_key_id="test",
            aws_secret_access_key="test",
        )
        stubber = Stubber(client)
        stubber.activate()
        self.stubbers.append(stubber)
        return client


def converse_reply(text="{}", stop="end_turn", input_tokens=100, output_tokens=20, request_id="bedrock-req-1"):
    content = [{"text": text}] if text is not None else []
    return {
        "output": {"message": {"role": "assistant", "content": content}},
        "stopReason": stop,
        "usage": {"inputTokens": input_tokens, "outputTokens": output_tokens, "totalTokens": input_tokens + output_tokens},
        "metrics": {"latencyMs": 900},
        "ResponseMetadata": {"RequestId": request_id, "HTTPStatusCode": 200},
    }


def client_with(*responses, expected=None):
    runtimes = Runtimes()
    client = ConverseClient(region="ap-southeast-2", timeout=120, max_retries=2, runtime_factory=runtimes)
    runtime = client.runtime()
    stubber = runtimes.stubbers[0]
    for response in responses:
        stubber.add_response("converse", response, expected)
    return client, runtime, stubber, runtimes


def test_request_maps_system_messages_and_max_tokens() -> None:
    kwargs = request_kwargs(CONVERSE, [{"role": "user", "content": "Review this card."}], structured=False)
    expected = {
        "modelId": MODEL,
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": [{"text": "Review this card."}]}],
        "inferenceConfig": {"maxTokens": 16000},
    }
    client, _, stubber, _ = client_with(converse_reply(), expected=expected)
    response = client.messages.create(**kwargs)  # thinking and output_config.effort are ignored
    stubber.assert_no_pending_responses()
    assert response.content[0].type == "text" and response.content[0].text == "{}"


def test_system_blocks_are_joined_and_assistant_blocks_flattened() -> None:
    messages = [
        {"role": "user", "content": "u1"},
        {
            "role": "assistant",
            "content": [
                converse_client.TextBlock(text="first"),
                {"type": "thinking", "thinking": "hidden"},
                {"type": "text", "text": "second"},
            ],
        },
        {"role": "user", "content": [{"type": "text", "text": "u2"}]},
        {"role": "assistant", "content": []},
    ]
    expected = {
        "modelId": MODEL,
        "system": [{"text": "a\nb"}],
        "messages": [
            {"role": "user", "content": [{"text": "u1"}]},
            {"role": "assistant", "content": [{"text": "first\nsecond"}]},
            {"role": "user", "content": [{"text": "u2"}]},
            {"role": "assistant", "content": [{"text": converse_client.EMPTY_TURN_TEXT}]},
        ],
        "inferenceConfig": {"maxTokens": 50},
    }
    client, _, stubber, _ = client_with(converse_reply(), expected=expected)
    client.messages.create(
        model=MODEL,
        system=[{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
        messages=messages,
        max_tokens=50,
        thinking={"type": "adaptive"},
    )
    stubber.assert_no_pending_responses()


def test_structured_output_format_is_rejected() -> None:
    client, _, _, _ = client_with()
    kwargs = request_kwargs(CONVERSE, [{"role": "user", "content": "x"}], structured=True)
    with pytest.raises(ConfigError):
        client.messages.create(**kwargs)
    assert providers.structured_outputs_on(CONVERSE) is False
    forced_on = load_settings({"AI_PROVIDER": "bedrock-converse", "AI_MODEL": MODEL, "AI_STRUCTURED_OUTPUTS": "on"})
    assert providers.structured_outputs_on(forced_on) is False


@pytest.mark.parametrize(
    "stop,mapped",
    [
        ("end_turn", "end_turn"),
        ("stop_sequence", "end_turn"),
        ("max_tokens", "max_tokens"),
        ("content_filtered", "refusal"),
        ("guardrail_intervened", "refusal"),
    ],
)
def test_response_maps_stop_reason_usage_and_request_id(stop, mapped) -> None:
    client, _, _, _ = client_with(converse_reply("hi", stop=stop, input_tokens=7, output_tokens=3, request_id="rid-9"))
    response = client.messages.create(model=MODEL, system=[], messages=[{"role": "user", "content": "x"}], max_tokens=10)
    assert response.stop_reason == mapped
    assert response.content[0].text == "hi"
    assert response.usage.input_tokens == 7 and response.usage.output_tokens == 3
    assert response.usage.cache_creation_input_tokens == 0 and response.usage.cache_read_input_tokens == 0
    assert response._request_id == "rid-9"


def test_response_without_text_has_an_empty_text_block() -> None:
    response = converse_client.to_response(converse_reply(None))
    assert [(b.type, b.text) for b in response.content] == [("text", "")]


def test_with_options_sets_read_timeout_and_standard_retries() -> None:
    runtimes = Runtimes()
    base = ConverseClient(region="ap-southeast-2", timeout=120, max_retries=2, runtime_factory=runtimes)
    variant = base.with_options(timeout=95.5, max_retries=0)
    assert variant is not base
    assert variant.with_options(timeout=None, max_retries=None) is variant
    assert base.with_options(timeout=95.5, max_retries=0) is variant  # cached per container
    variant.runtime()
    base.runtime()
    (region_a, cfg_a), (_, cfg_b) = runtimes.made
    assert region_a == "ap-southeast-2"
    assert cfg_a == {"read_timeout": 95.5, "retries": {"max_attempts": 1, "mode": "standard"}}
    assert cfg_b == {"read_timeout": 120, "retries": {"max_attempts": 3, "mode": "standard"}}


def test_make_client_uses_the_bedrock_region() -> None:
    cfg = load_settings({"AI_PROVIDER": "bedrock-converse", "AI_MODEL": "deepseek.v3.2", "AI_BEDROCK_REGION": "us-west-2"})
    client = providers.make_client(cfg)
    assert isinstance(client, ConverseClient)
    assert client.region == "us-west-2" and client.timeout == 120 and client.max_retries == 2


def test_review_card_through_converse_sums_usage_and_prices_the_estimate() -> None:
    bad = converse_reply("not json", input_tokens=1000, output_tokens=100, request_id="r1")
    good = converse_reply(
        review_json(finding("minor", "incorrect_answer", "Wrong.", None)), input_tokens=2000, output_tokens=200, request_id="r2"
    )
    client, _, stubber, _ = client_with(bad, good, expected=None)
    item = review_card(card(0), client=client, settings=CONVERSE, review_date=REVIEW_DATE)
    stubber.assert_no_pending_responses()
    assert item["status"] == "done"
    assert item["findings"][0]["severity"] == "blocker"  # the category map, not the model
    assert item["usage"] == {"inputTokens": 3000, "outputTokens": 300, "cacheReadInputTokens": 0}
    assert item["requestId"] == "r2"
    assert item["estimatedCostUsd"] == round((3000 * 2 + 300 * 10) / 1_000_000, 6)


def test_review_card_through_converse_repair_turn_is_text() -> None:
    bad = converse_reply("not json")
    good = converse_reply(review_json())
    client, _, stubber, _ = client_with(bad)
    stubber.add_response(
        "converse",
        good,
        {
            "modelId": MODEL,
            "system": ANY,
            "messages": [
                {"role": "user", "content": ANY},
                {"role": "assistant", "content": [{"text": "not json"}]},
                {"role": "user", "content": ANY},
            ],
            "inferenceConfig": {"maxTokens": 16000},
        },
    )
    assert review_card(card(0), client=client, settings=CONVERSE, review_date=REVIEW_DATE)["status"] == "done"
    stubber.assert_no_pending_responses()


def test_content_filter_is_a_refusal_item() -> None:
    client, _, _, _ = client_with(converse_reply("", stop="content_filtered"))
    item = review_card(card(0), client=client, settings=CONVERSE, review_date=REVIEW_DATE)
    assert (item["status"], item["errorCode"]) == ("refused", "REFUSAL")


def client_error(code, message="error", status=400):
    return botocore.exceptions.ClientError(
        {
            "Error": {"Code": code, "Message": message},
            "ResponseMetadata": {"RequestId": "bedrock-err-1", "HTTPStatusCode": status},
        },
        "Converse",
    )


ERROR_ROWS = [
    ("access_denied", lambda: client_error("AccessDeniedException", status=403), "PROVIDER_ACCESS_DENIED"),
    (
        "not_allowed",
        lambda: client_error("ValidationException", "Access to this model is not allowed for this account."),
        "PROVIDER_ACCESS_DENIED",
    ),
    (
        "corporate",
        lambda: client_error("ValidationException", "Please verify you are a corporate customer to use this model."),
        "PROVIDER_ACCESS_DENIED",
    ),
    (
        "countries",
        lambda: client_error("ValidationException", "This model is not available in unsupported countries."),
        "PROVIDER_ACCESS_DENIED",
    ),
    ("validation", lambda: client_error("ValidationException", "maxTokens exceeds the model limit"), "CONFIG"),
    ("not_found", lambda: client_error("ResourceNotFoundException", status=404), "CONFIG"),
    ("throttled", lambda: client_error("ThrottlingException", status=429), "PROVIDER_RATE_LIMITED"),
    ("quota", lambda: client_error("ServiceQuotaExceededException", status=400), "PROVIDER_RATE_LIMITED"),
    ("model_timeout", lambda: client_error("ModelTimeoutException", status=408), "PROVIDER_TIMEOUT"),
    (
        "read_timeout",
        lambda: botocore.exceptions.ReadTimeoutError(endpoint_url="https://bedrock-runtime.test"),
        "PROVIDER_TIMEOUT",
    ),
    (
        "endpoint",
        lambda: botocore.exceptions.EndpointConnectionError(endpoint_url="https://bedrock-runtime.test"),
        "PROVIDER_TIMEOUT",
    ),
    ("model_error", lambda: client_error("ModelErrorException", status=424), "PROVIDER_ERROR"),
    ("internal", lambda: client_error("InternalServerException", status=500), "PROVIDER_ERROR"),
    ("unavailable", lambda: client_error("ServiceUnavailableException", status=503), "PROVIDER_ERROR"),
    ("other_5xx", lambda: client_error("SomethingNewException", status=502), "PROVIDER_ERROR"),
    ("other_4xx", lambda: client_error("SomethingElseException", status=409), "CONFIG"),
    ("config", lambda: ConfigError("structured outputs are off for bedrock-converse"), "CONFIG"),
]


@pytest.mark.parametrize("name,make_exc,code", ERROR_ROWS, ids=[r[0] for r in ERROR_ROWS])
def test_converse_errors_map_to_bounded_codes(name, make_exc, code) -> None:
    assert error_code_for(make_exc()) == code
    llm = FakeLlm([make_exc()])
    item = review_card(card(0), client=llm, settings=CONVERSE, review_date=REVIEW_DATE)
    assert (item["status"], item["errorCode"], item["findings"]) == ("error", code, [])


def test_client_error_request_id_is_kept() -> None:
    llm = FakeLlm([client_error("ThrottlingException", status=429)])
    item = review_card(card(0), client=llm, settings=CONVERSE, review_date=REVIEW_DATE)
    assert item["requestId"] == "bedrock-err-1"


def test_stubbed_client_error_reaches_the_item() -> None:
    client, _, stubber, _ = client_with()
    stubber.add_client_error("converse", service_error_code="AccessDeniedException", http_status_code=403)
    item = review_card(card(0), client=client, settings=CONVERSE, review_date=REVIEW_DATE)
    assert item["errorCode"] == "PROVIDER_ACCESS_DENIED"


def test_converse_reply_names_no_served_model() -> None:
    # D03, ai-agent-19: Converse carries no model id, so the response says None rather than guessing.
    assert converse_client.to_response(converse_reply("x")).model is None

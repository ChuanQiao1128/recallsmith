"""The optional second reviewer: settings, merge policy and the handler path (FakeLlm only)."""

import json
from pathlib import Path

import botocore.exceptions
import pytest
from conftest import FakeLlm, FakeUsage, card, finding, reply, review_json
from test_handler import INTERNAL_NAME, SECRET, FakeSsm, event, fake_core, message, reports

from ai_qa import handler, second_opinion, settings
from ai_qa.schema import CATEGORIES
from ai_qa.settings import ConfigError, load_settings

SECOND_MODEL = "global.moonshotai.kimi-k3"
PREFIX = f"[second opinion: {SECOND_MODEL}] "
PROD_ENV = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"
SECOND_ENV = {
    "AI_QA_SECOND_PROVIDER": "bedrock-converse",
    "AI_QA_SECOND_MODEL": SECOND_MODEL,
    "AI_QA_SECOND_PRICE_INPUT_PER_MTOK": "1",
    "AI_QA_SECOND_PRICE_OUTPUT_PER_MTOK": "4",
}


# --- settings -----------------------------------------------------------------------------------


def test_prod_env_keeps_bedrock_and_the_second_opinion_off() -> None:
    env = json.loads(PROD_ENV.read_text())
    cfg = load_settings(env)
    assert cfg.provider == "bedrock"
    assert cfg.second_provider is None and cfg.second_model is None
    assert second_opinion.enabled(cfg) is False
    assert not any(key.startswith("AI_QA_SECOND_") for key in env)


def test_converse_provider_requires_a_non_anthropic_model() -> None:
    with pytest.raises(ConfigError, match="AI_MODEL is required"):
        load_settings({"AI_PROVIDER": "bedrock-converse"})
    with pytest.raises(ConfigError, match="must not be an 'anthropic.' model"):
        load_settings({"AI_PROVIDER": "bedrock-converse", "AI_MODEL": "anthropic.claude-opus-5"})
    cfg = load_settings({"AI_PROVIDER": "bedrock-converse", "AI_MODEL": "qwen.qwen3-235b-a22b-2507-v1:0"})
    assert (cfg.provider, cfg.model) == ("bedrock-converse", "qwen.qwen3-235b-a22b-2507-v1:0")


def test_second_opinion_settings() -> None:
    cfg = load_settings(SECOND_ENV)
    assert (cfg.second_provider, cfg.second_model) == ("bedrock-converse", SECOND_MODEL)
    assert cfg.second_scope == {"incorrect_answer", "multiple_correct", "outdated_fact", "source_unsupported"}
    assert (cfg.second_price_input_per_mtok, cfg.second_price_output_per_mtok) == (1.0, 4.0)
    assert (cfg.provider, cfg.model, cfg.price_input_per_mtok) == ("bedrock", "anthropic.claude-opus-5", 5.0)

    derived = second_opinion.second_settings(cfg)
    assert (derived.provider, derived.model) == ("bedrock-converse", SECOND_MODEL)
    assert (derived.price_input_per_mtok, derived.price_output_per_mtok) == (1.0, 4.0)

    assert load_settings({**SECOND_ENV, "AI_QA_SECOND_SCOPE": "all"}).second_scope == set(CATEGORIES)
    listed = load_settings({**SECOND_ENV, "AI_QA_SECOND_SCOPE": "answer_leak, other"})
    assert listed.second_scope == {"answer_leak", "other"}
    # bedrock / anthropic second reviewers get their provider's default model.
    assert load_settings({"AI_QA_SECOND_PROVIDER": "anthropic"}).second_model == "claude-opus-5"


@pytest.mark.parametrize(
    "env,match",
    [
        ({"AI_QA_SECOND_PROVIDER": "openai"}, "AI_QA_SECOND_PROVIDER"),
        ({"AI_QA_SECOND_PROVIDER": "bedrock-converse"}, "AI_QA_SECOND_MODEL is required"),
        ({"AI_QA_SECOND_PROVIDER": "bedrock-converse", "AI_QA_SECOND_MODEL": "anthropic.claude-opus-5"}, "anthropic"),
        ({**SECOND_ENV, "AI_QA_SECOND_SCOPE": "facts,nonsense"}, "AI_QA_SECOND_SCOPE"),
        ({**SECOND_ENV, "AI_QA_SECOND_PRICE_INPUT_PER_MTOK": "-1"}, "AI_QA_SECOND_PRICE_INPUT_PER_MTOK"),
    ],
)
def test_invalid_second_opinion_settings_are_config_errors(env, match) -> None:
    with pytest.raises(ConfigError, match=match):
        load_settings(env)


def test_unset_second_price_estimates_zero_and_logs_once(capsys) -> None:
    cfg = load_settings({"AI_QA_SECOND_PROVIDER": "bedrock-converse", "AI_QA_SECOND_MODEL": SECOND_MODEL})
    assert cfg.second_price_input_per_mtok is None
    first = second_opinion.second_settings(cfg)
    second_opinion.second_settings(cfg)
    assert (first.price_input_per_mtok, first.price_output_per_mtok) == (0.0, 0.0)
    assert capsys.readouterr().out.count("second_opinion_price_unset") == 1


# --- merge --------------------------------------------------------------------------------------


def item(findings, input_tokens=100, output_tokens=20, cache_read=0, latency=1000, cost=0.001, status="done", code=None):
    return {
        "cardId": 101,
        "contentSha256": "a" * 64,
        "status": status,
        "errorCode": code,
        "findings": findings,
        "usage": {"inputTokens": input_tokens, "outputTokens": output_tokens, "cacheReadInputTokens": cache_read},
        "latencyMs": latency,
        "requestId": "req_primary",
        "estimatedCostUsd": cost,
    }


def final(severity, category, message="m"):
    return {"cardId": 101, "severity": severity, "category": category, "message": message, "suggestedFix": None}


def test_merge_adds_only_new_in_scope_categories_with_the_prefix() -> None:
    cfg = load_settings(SECOND_ENV)
    primary = item([final("major", "ambiguous_stem", "p1"), final("major", "outdated_fact", "p2")], cache_read=50)
    second = item(
        [
            final("blocker", "incorrect_answer", "wrong key"),  # in scope, new → added
            final("blocker", "incorrect_answer", "again"),  # same category twice → only the first
            final("major", "outdated_fact", "dup"),  # already in the primary → not added
            final("major", "answer_leak", "leak"),  # out of scope → not added
        ],
        input_tokens=300,
        output_tokens=40,
        latency=2000,
        cost=0.0005,
    )
    merged, added, code = second_opinion.apply(primary, second, cfg)
    assert (added, code) == (1, None)
    assert [(f["category"], f["message"]) for f in merged["findings"]] == [
        ("incorrect_answer", PREFIX + "wrong key"),
        ("ambiguous_stem", "p1"),
        ("outdated_fact", "p2"),
    ]
    assert merged["findings"][0]["severity"] == "blocker"
    assert merged["usage"] == {"inputTokens": 400, "outputTokens": 60, "cacheReadInputTokens": 50}
    assert merged["latencyMs"] == 3000
    assert merged["estimatedCostUsd"] == 0.0015
    assert (merged["status"], merged["errorCode"], merged["requestId"]) == ("done", None, "req_primary")
    assert primary["findings"][0]["message"] == "p1"  # the primary item is not mutated


def test_merge_keeps_the_message_limit_and_the_findings_cap() -> None:
    cfg = load_settings({**SECOND_ENV, "AI_QA_SECOND_SCOPE": "all"})
    long = final("blocker", "incorrect_answer", "x" * 1000)
    merged, added, _ = second_opinion.apply(item([]), item([long]), cfg)
    assert added == 1 and len(merged["findings"][0]["message"]) == 1000
    assert merged["findings"][0]["message"].startswith(PREFIX)

    ten = [final("minor", "other", str(i)) for i in range(10)]
    merged, added, _ = second_opinion.apply(item(ten), item([long]), cfg)
    assert added == 0 and merged["findings"] == ten


@pytest.mark.parametrize(
    "second,code",
    [
        (item([], status="refused", code="REFUSAL"), "REFUSAL"),
        (item([], status="error", code="PROVIDER_RATE_LIMITED"), "PROVIDER_RATE_LIMITED"),
        (None, "PROVIDER_ERROR"),
    ],
)
def test_failed_second_review_leaves_the_primary_unchanged(second, code) -> None:
    primary = item([final("major", "ambiguous_stem")])
    merged, added, got = second_opinion.apply(primary, second, load_settings(SECOND_ENV))
    assert merged is primary and added is None and got == code


# --- handler ------------------------------------------------------------------------------------


@pytest.fixture
def setup(local_server, monkeypatch):
    srv = local_server(fake_core)
    monkeypatch.setenv("CORE_API_BASE", srv.base_url)
    monkeypatch.setenv("AI_QA_ENABLED", "1")
    for key, value in SECOND_ENV.items():
        monkeypatch.setenv(key, value)
    settings.set_clients(ssm=FakeSsm({INTERNAL_NAME: SECRET}))
    clients = {"bedrock": FakeLlm(), "bedrock-converse": FakeLlm()}

    def factory(cfg, *, api_key=None):
        return clients[cfg.provider]

    monkeypatch.setattr(handler, "client_factory", factory)
    return srv, clients


def emf_lines(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.startswith('{"_aws"')]


def test_handler_merges_the_second_opinion_and_emits_the_added_count(setup, capsys) -> None:
    core, clients = setup
    clients["bedrock"].script = [
        reply(review_json(finding("major", "ambiguous_stem", "stem")), usage=FakeUsage(1000, 100), request_id="p")
    ]
    clients["bedrock-converse"].script = [
        reply(
            review_json(finding("major", "incorrect_answer", "key is wrong"), finding("minor", "weak_distractor", "d")),
            usage=FakeUsage(2000, 200),
            request_id="s",
        )
    ]
    result = handler.lambda_handler(event(message([card(0)])), None)
    assert result == {"batchItemFailures": []}
    (primary_call,) = clients["bedrock"].calls
    (second_call,) = clients["bedrock-converse"].calls
    assert second_call["model"] == SECOND_MODEL
    assert second_call["system"] == primary_call["system"] and second_call["messages"] == primary_call["messages"]
    assert "format" not in second_call["output_config"]

    (body,) = reports(core)
    (got,) = body["items"]
    assert (body["provider"], body["model"]) == ("bedrock", "anthropic.claude-opus-5")
    assert [(f["severity"], f["category"], f["message"]) for f in got["findings"]] == [
        ("blocker", "incorrect_answer", PREFIX + "key is wrong"),
        ("major", "ambiguous_stem", "stem"),
    ]
    assert got["usage"] == {"inputTokens": 3000, "outputTokens": 300, "cacheReadInputTokens": 0}
    assert got["requestId"] == "p"
    assert got["estimatedCostUsd"] == round((1000 * 5 + 100 * 25 + 2000 * 1 + 200 * 4) / 1_000_000, 6)
    metrics = emf_lines(capsys.readouterr().out)
    assert [m["AiQaSecondOpinionAdded"] for m in metrics if "AiQaSecondOpinionAdded" in m] == [1]


@pytest.mark.parametrize(
    "failure,code",
    [
        (
            lambda: botocore.exceptions.ClientError(
                {"Error": {"Code": "ThrottlingException", "Message": "slow down"}}, "Converse"
            ),
            "PROVIDER_RATE_LIMITED",
        ),
        (lambda: reply(None, stop_reason="refusal"), "REFUSAL"),
        (lambda: KeyError("unmapped"), "PROVIDER_ERROR"),
    ],
)
def test_handler_second_failure_leaves_the_primary_item_untouched(setup, capsys, failure, code) -> None:
    core, clients = setup
    clients["bedrock"].script = [reply(review_json(finding("major", "ambiguous_stem", "stem")), request_id="p")]
    clients["bedrock-converse"].script = [failure()]
    result = handler.lambda_handler(event(message([card(0)])), None)
    assert result == {"batchItemFailures": []}  # a failed second opinion never fails the chunk
    (got,) = reports(core)[0]["items"]
    assert (got["status"], got["errorCode"]) == ("done", None)
    assert [f["message"] for f in got["findings"]] == ["stem"]
    assert got["usage"] == {"inputTokens": 100, "outputTokens": 20, "cacheReadInputTokens": 0}
    out = capsys.readouterr().out
    failed = [json.loads(line) for line in out.splitlines() if '"second_opinion_failed"' in line]
    assert len(failed) == 1 and failed[0]["errorCode"] == code
    assert "slow down" not in out and "unmapped" not in out  # the error code only
    errors = [m for m in emf_lines(out) if "AiQaSecondOpinionErrors" in m]
    assert len(errors) == 1 and errors[0]["ErrorCode"] == code
    assert not any("AiQaSecondOpinionAdded" in m for m in emf_lines(out))


def test_handler_skips_the_second_opinion_when_the_primary_did_not_finish(setup) -> None:
    core, clients = setup
    clients["bedrock"].script = [reply(None, stop_reason="refusal")]
    handler.lambda_handler(event(message([card(0)])), None)
    assert clients["bedrock-converse"].calls == []
    (got,) = reports(core)[0]["items"]
    assert got["errorCode"] == "REFUSAL"


def test_handler_without_second_provider_makes_one_call(setup, monkeypatch) -> None:
    core, clients = setup
    monkeypatch.delenv("AI_QA_SECOND_PROVIDER")
    clients["bedrock"].script = [reply(review_json())]
    handler.lambda_handler(event(message([card(0)])), None)
    assert len(clients["bedrock"].calls) == 1 and clients["bedrock-converse"].calls == []

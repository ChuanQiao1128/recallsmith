"""The automation reviewer profile and "target": "draft" messages (A00 §9.2, §9.3; FakeLlm only)."""

import dataclasses
import json
from pathlib import Path

import pytest
from conftest import FakeLlm, FakeUsage, card, finding, reply, review_json
from test_handler import (
    INTERNAL_NAME,
    RUN_ID,
    SECRET,
    FakeSsm,
    event,
    fake_core,
    message,
    reports,
    verify_internal_signature,
)

from ai_qa import handler, profiles, settings
from ai_qa.prompts import PROMPT_VERSION, PROMPT_VERSION_AUTOMATION, SYSTEM_PROMPT, SYSTEM_PROMPT_AUTOMATION
from ai_qa.settings import ConfigError, load_settings

PROD_ENV = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"
AUTOMATION_MODEL = "global.openai.gpt-5.5"
DRAFT_ID = 4711
AUTOMATION_ENV = {
    "AI_QA_AUTOMATION_PROVIDER": "bedrock-converse",
    "AI_QA_AUTOMATION_MODEL": AUTOMATION_MODEL,
    "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "2",
    "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK": "10",
}
SECOND_ENV = {
    "AI_QA_SECOND_PROVIDER": "bedrock-converse",
    "AI_QA_SECOND_MODEL": "global.moonshotai.kimi-k3",
    "AI_QA_SECOND_PRICE_INPUT_PER_MTOK": "1",
    "AI_QA_SECOND_PRICE_OUTPUT_PER_MTOK": "4",
}
REPORT_KEYS = {"v", "runId", "chunk", "provider", "model", "promptVersion", "items"}

# The A00 §9.2 message, with real strings for the elided values.
CONTRACT_DRAFT_MESSAGE = {
    "v": 1,
    "runId": "0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f",
    "chunk": 0,
    "chunkCount": 1,
    "promptVersion": "qa-v4",
    "target": "draft",
    "profile": "automation",
    "deck": {"id": 12, "slug": "aws-saa-c03", "title": "AWS SAA-C03"},
    "reviewDate": "2026-10-01",
    "cards": [
        {
            "cardId": DRAFT_ID,
            "stableUid": "aws-s3-glacier-restore-07",
            "contentSha256": "d" * 64,
            "difficulty": 2,
            "topic": "4.1 Cost-optimized storage",
            "question": "Which S3 storage class restores archived objects within a few hours at the lowest cost?",
            "explanation": "S3 Glacier Flexible Retrieval: standard retrievals finish in 3 to 5 hours.",
            "codeSnippet": None,
            "codeLanguage": None,
            "realWorldUsage": None,
            "mcq": None,
            "source": {
                "url": "https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html",
                "quote": "Standard retrievals typically finish within 3-5 hours.",
            },
        }
    ],
}


def set_env(monkeypatch, env) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)


def draft_card() -> dict:
    return {**card(0), "cardId": DRAFT_ID}


def model_calls(clients) -> int:
    return sum(len(client.calls) for client in clients.values())


class TestSettingsFor:
    """profiles.settings_for and the AI_QA_AUTOMATION_* keys."""

    def test_settings_for_default_returns_the_same_settings(self) -> None:
        cfg = load_settings({**AUTOMATION_ENV, **SECOND_ENV})
        assert profiles.settings_for(cfg, "default") is cfg

    def test_settings_for_automation_uses_the_automation_reviewer(self) -> None:
        cfg = load_settings({**AUTOMATION_ENV, **SECOND_ENV})
        assert (cfg.automation_provider, cfg.automation_model) == ("bedrock-converse", AUTOMATION_MODEL)
        derived = profiles.settings_for(cfg, "automation")
        assert (derived.provider, derived.model) == ("bedrock-converse", AUTOMATION_MODEL)
        assert (derived.price_input_per_mtok, derived.price_output_per_mtok) == (2.0, 10.0)
        assert derived.second_provider is None and derived.second_model is None
        changed = {
            "provider",
            "model",
            "price_input_per_mtok",
            "price_output_per_mtok",
            "second_provider",
            "second_model",
        }
        for field in dataclasses.fields(cfg):
            if field.name not in changed:
                assert getattr(derived, field.name) == getattr(cfg, field.name), field.name

    @pytest.mark.parametrize("env", [{}, {"AI_QA_AUTOMATION_PROVIDER": "  "}])
    def test_automation_profile_without_provider_or_model_is_config_error(self, env) -> None:
        cfg = load_settings(env)  # never raises: the automation reviewer is optional at load time
        assert cfg.automation_provider is None and cfg.automation_model is None
        with pytest.raises(ConfigError, match="AI_QA_AUTOMATION_PROVIDER") as info:
            profiles.settings_for(cfg, "automation")
        assert "AI_QA_AUTOMATION_MODEL" in str(info.value)
        # A provider without a model is rejected by load_settings already, so a hand-built one is the
        # only way to reach the model check.
        partial = dataclasses.replace(cfg, automation_provider="bedrock-converse")
        with pytest.raises(ConfigError, match="AI_QA_AUTOMATION_MODEL"):
            profiles.settings_for(partial, "automation")

    @pytest.mark.parametrize(
        "missing", ["AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK", "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK"]
    )
    def test_automation_profile_without_a_price_is_config_error(self, missing) -> None:
        env = {key: value for key, value in AUTOMATION_ENV.items() if key != missing}
        cfg = load_settings(env)  # an absent price never raises at load time
        with pytest.raises(ConfigError) as info:
            profiles.settings_for(cfg, "automation")
        reason = str(info.value)
        assert "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK" in reason and "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK" in reason
        assert "daily USD cap" in reason

    @pytest.mark.parametrize("profile", ["fast", "", "Automation", "DEFAULT"])
    def test_unknown_profile_is_config_error(self, profile) -> None:
        with pytest.raises(ConfigError):
            profiles.settings_for(load_settings(AUTOMATION_ENV), profile)

    @pytest.mark.parametrize(
        "env,match",
        [
            ({"AI_QA_AUTOMATION_PROVIDER": "openai"}, "AI_QA_AUTOMATION_PROVIDER"),
            ({"AI_QA_AUTOMATION_PROVIDER": "bedrock-converse"}, "AI_QA_AUTOMATION_MODEL is required"),
            (
                {"AI_QA_AUTOMATION_PROVIDER": "bedrock-converse", "AI_QA_AUTOMATION_MODEL": "anthropic.claude-opus-5"},
                "AI_QA_AUTOMATION_MODEL",
            ),
            (
                {**AUTOMATION_ENV, "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "-1"},
                "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK",
            ),
            (
                {**AUTOMATION_ENV, "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK": "cheap"},
                "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK",
            ),
        ],
    )
    def test_invalid_automation_settings_are_config_errors(self, env, match) -> None:
        # B03 cloud-security-resilience-7: an invalid automation key no longer fails load_settings
        # (that took down the default human card QA); it is a CONFIG error for the automation
        # profile only.
        cfg = load_settings(env)
        assert cfg.automation_config_error is not None
        assert profiles.settings_for(cfg, "default") is cfg
        with pytest.raises(ConfigError, match=match):
            profiles.settings_for(cfg, "automation")

    def test_prod_env_loads_with_the_automation_reviewer(self) -> None:
        env = json.loads(PROD_ENV.read_text())
        cfg = load_settings(env)
        assert cfg.automation_provider == "bedrock-converse"
        assert cfg.automation_model == AUTOMATION_MODEL
        assert (cfg.provider, cfg.model) == ("bedrock", "anthropic.claude-opus-5")  # the human reviewer is unchanged
        if "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK" not in env or "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK" not in env:
            with pytest.raises(ConfigError, match="AI_QA_AUTOMATION_PRICE_"):
                profiles.settings_for(cfg, "automation")
        else:
            derived = profiles.settings_for(cfg, "automation")
            assert (derived.provider, derived.model) == ("bedrock-converse", AUTOMATION_MODEL)


# --- messages -----------------------------------------------------------------------------------


def test_contract_draft_message_parses() -> None:
    msg = handler.parse_message(json.dumps(CONTRACT_DRAFT_MESSAGE))
    assert msg is not None
    assert msg["target"] == "draft" and msg["profile"] == "automation"
    assert msg["cards"][0]["cardId"] == DRAFT_ID
    # Absent keys mean the human card path with the default reviewer.
    plain = handler.parse_message(message())
    assert plain is not None and "target" not in plain and "profile" not in plain


class TestHandler:
    """The handler path: fake core, one FakeLlm per provider (no model is called)."""

    @pytest.fixture(autouse=True)
    def no_automation_env(self, monkeypatch):
        for key in AUTOMATION_ENV:
            monkeypatch.delenv(key, raising=False)

    @pytest.fixture
    def harness(self, local_server, monkeypatch):
        """Fake core, the internal secret, one FakeLlm per provider and the settings each client got."""
        srv = local_server(fake_core)
        monkeypatch.setenv("CORE_API_BASE", srv.base_url)
        settings.set_clients(ssm=FakeSsm({INTERNAL_NAME: SECRET}))
        clients = {"bedrock": FakeLlm(), "bedrock-converse": FakeLlm()}
        made = []

        def factory(cfg, *, api_key=None):
            made.append(cfg)
            return clients[cfg.provider]

        monkeypatch.setattr(handler, "client_factory", factory)
        return srv, clients, made

    @pytest.mark.parametrize("over", [{"target": "deck"}, {"target": 1}, {"profile": "fast"}, {"profile": None}])
    def test_unknown_target_or_profile_is_a_bad_message(self, harness, monkeypatch, capsys, over) -> None:
        core, clients, made = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        assert handler.parse_message(message(**over)) is None
        result = handler.lambda_handler(event(message(**over)), None)
        assert result == {"batchItemFailures": []}  # acked
        out = capsys.readouterr().out
        assert '"bad_message"' in out
        assert core.requests == []
        assert made == [] and model_calls(clients) == 0

    def test_draft_report_carries_target_and_profile_and_the_automation_reviewer(self, harness, monkeypatch) -> None:
        core, clients, made = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock-converse"].script = [reply(review_json(), usage=FakeUsage(1000, 100), request_id="d")]
        result = handler.lambda_handler(event(message([draft_card()], target="draft", profile="automation")), None)
        assert result == {"batchItemFailures": []}
        assert [cfg.provider for cfg in made] == ["bedrock-converse"]
        assert made[0].model == AUTOMATION_MODEL
        assert clients["bedrock"].calls == []
        (call,) = clients["bedrock-converse"].calls
        assert call["model"] == AUTOMATION_MODEL

        (captured,) = core.requests
        assert verify_internal_signature(captured.headers, captured.body)
        body = json.loads(captured.body)
        assert captured.body == json.dumps(body, separators=(",", ":"), ensure_ascii=True, sort_keys=True).encode()
        assert set(body) == REPORT_KEYS | {"target", "profile"}
        assert body["target"] == "draft" and body["profile"] == "automation"
        assert (body["provider"], body["model"]) == ("bedrock-converse", AUTOMATION_MODEL)
        assert body["runId"] == RUN_ID
        (item,) = body["items"]
        assert item["cardId"] == DRAFT_ID
        assert (item["status"], item["errorCode"]) == ("done", None)
        assert item["estimatedCostUsd"] == round((1000 * 2 + 100 * 10) / 1_000_000, 6)

    def test_automation_profile_never_runs_the_second_opinion(self, harness, monkeypatch) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, **SECOND_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock-converse"].script = [reply(review_json()), reply(review_json())]
        handler.lambda_handler(event(message([draft_card(), card(1)], target="draft", profile="automation")), None)
        assert model_calls(clients) == 2  # one per card
        assert clients["bedrock"].calls == []
        assert [call["model"] for call in clients["bedrock-converse"].calls] == [AUTOMATION_MODEL] * 2

        # The same Lambda still runs the second opinion for a default message: the switch is per profile.
        clients["bedrock"].script = [reply(review_json())]
        clients["bedrock-converse"].script = [reply(review_json())]
        handler.lambda_handler(event(message([card(2)])), None)
        assert model_calls(clients) == 4
        assert clients["bedrock-converse"].calls[-1]["model"] == SECOND_ENV["AI_QA_SECOND_MODEL"]
        assert [set(body) for body in reports(core)] == [REPORT_KEYS | {"target", "profile"}, REPORT_KEYS]

    def test_automation_profile_missing_price_reports_config_for_every_card(self, harness, monkeypatch, capsys) -> None:
        core, clients, made = harness
        env = {key: value for key, value in AUTOMATION_ENV.items() if "PRICE" not in key}
        set_env(monkeypatch, {**env, "AI_QA_ENABLED": "1"})
        result = handler.lambda_handler(
            event(message([draft_card(), card(1)], target="draft", profile="automation")), None
        )
        assert result == {"batchItemFailures": []}  # acked
        assert made == [] and model_calls(clients) == 0
        (body,) = reports(core)
        assert (body["provider"], body["model"]) == ("bedrock-converse", AUTOMATION_MODEL)
        assert body["target"] == "draft" and body["profile"] == "automation"
        assert [(i["status"], i["errorCode"]) for i in body["items"]] == [("error", "CONFIG")] * 2
        logged = [
            json.loads(line) for line in capsys.readouterr().out.splitlines() if '"profile_config_invalid"' in line
        ]
        assert len(logged) == 1 and logged[0]["profile"] == "automation"

    def test_default_profile_report_has_no_target_or_profile_key(self, harness, monkeypatch) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock"].script = [reply(review_json()), reply(review_json())]
        handler.lambda_handler(event(message([card(0)]), message([card(1)], target="card", profile="default")), None)
        bodies = reports(core)
        assert len(bodies) == 2
        for body in bodies:
            assert set(body) == REPORT_KEYS
            assert (body["provider"], body["model"]) == ("bedrock", "anthropic.claude-opus-5")
        assert clients["bedrock-converse"].calls == []

    def test_recheck_message_with_automation_profile_reports_profile_only(self, harness, monkeypatch) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock-converse"].script = [reply(review_json())]
        handler.lambda_handler(event(message([card(0)], profile="automation")), None)
        (body,) = reports(core)
        assert set(body) == REPORT_KEYS | {"profile"}
        assert body["profile"] == "automation" and "target" not in body
        assert (body["provider"], body["model"]) == ("bedrock-converse", AUTOMATION_MODEL)

    def test_disabled_lambda_skips_automation_messages_too(self, harness, monkeypatch) -> None:
        core, clients, made = harness
        set_env(monkeypatch, AUTOMATION_ENV)  # AI_QA_ENABLED unset
        result = handler.lambda_handler(
            event(message([draft_card(), card(1)], target="draft", profile="automation")), None
        )
        assert result == {"batchItemFailures": []}
        assert made == [] and model_calls(clients) == 0
        (body,) = reports(core)
        assert [(i["status"], i["errorCode"]) for i in body["items"]] == [("skipped", "DISABLED")] * 2
        assert body["items"][0]["cardId"] == DRAFT_ID
        assert body["target"] == "draft" and body["profile"] == "automation"


class TestAutomationPromptAndIsolation:
    """B03 (R18B): the qa-v4-auto prompt for the automation profile (K1), and an invalid automation
    setting that disables only the automation profile (cloud-security-resilience-7)."""

    @pytest.fixture(autouse=True)
    def no_automation_env(self, monkeypatch):
        for key in AUTOMATION_ENV:
            monkeypatch.delenv(key, raising=False)

    @pytest.fixture
    def harness(self, local_server, monkeypatch):
        srv = local_server(fake_core)
        monkeypatch.setenv("CORE_API_BASE", srv.base_url)
        settings.set_clients(ssm=FakeSsm({INTERNAL_NAME: SECRET}))
        clients = {"bedrock": FakeLlm(), "bedrock-converse": FakeLlm()}
        made = []

        def factory(cfg, *, api_key=None):
            made.append(cfg)
            return clients[cfg.provider]

        monkeypatch.setattr(handler, "client_factory", factory)
        return srv, clients, made

    def test_prompt_version_and_system_prompt_per_profile(self) -> None:
        assert profiles.prompt_version_for("default") == PROMPT_VERSION == "qa-v4"
        assert profiles.system_prompt_for("default") is SYSTEM_PROMPT
        assert profiles.prompt_version_for("automation") == PROMPT_VERSION_AUTOMATION == "qa-v4-auto"
        assert profiles.system_prompt_for("automation") is SYSTEM_PROMPT_AUTOMATION

    def test_automation_message_reviews_with_qa_v4_auto_and_echoes_it(self, harness, monkeypatch, capsys) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock-converse"].script = [reply(review_json())]
        handler.lambda_handler(
            event(message([draft_card()], target="draft", profile="automation", promptVersion="qa-v4-auto")), None
        )
        (call,) = clients["bedrock-converse"].calls
        assert call["system"][0]["text"] == SYSTEM_PROMPT_AUTOMATION
        (body,) = reports(core)
        assert body["promptVersion"] == "qa-v4-auto"
        assert '"prompt_version_mismatch"' not in capsys.readouterr().out

    def test_default_message_still_reviews_with_qa_v4(self, harness, monkeypatch, capsys) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock"].script = [reply(review_json())]
        handler.lambda_handler(event(message([card(0)], promptVersion="qa-v4")), None)
        (call,) = clients["bedrock"].calls
        assert call["system"][0]["text"] == SYSTEM_PROMPT
        (body,) = reports(core)
        assert body["promptVersion"] == "qa-v4"
        assert '"prompt_version_mismatch"' not in capsys.readouterr().out

    def test_version_check_is_against_the_profile_version(self, harness, monkeypatch, capsys) -> None:
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1"})
        clients["bedrock-converse"].script = [reply(review_json())]
        # An automation message still asking for the human prompt version is logged as a mismatch.
        handler.lambda_handler(event(message([draft_card()], profile="automation", promptVersion="qa-v4")), None)
        logged = [
            json.loads(line) for line in capsys.readouterr().out.splitlines() if '"prompt_version_mismatch"' in line
        ]
        assert len(logged) == 1
        assert (logged[0]["requested"], logged[0]["running"], logged[0]["profile"]) == ("qa-v4", "qa-v4-auto", "automation")
        (body,) = reports(core)
        assert body["promptVersion"] == "qa-v4-auto"  # what actually ran

    @pytest.mark.parametrize(
        "bad",
        [
            {"AI_QA_AUTOMATION_PROVIDER": "openai"},
            {"AI_QA_AUTOMATION_PROVIDER": "bedrock-converse", "AI_QA_AUTOMATION_MODEL": "anthropic.claude-opus-5"},
        ],
    )
    def test_invalid_automation_setting_keeps_default_card_qa_running(self, harness, monkeypatch, bad) -> None:
        core, clients, made = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, **bad, "AI_QA_ENABLED": "1"})
        clients["bedrock"].script = [reply(review_json(finding()))]
        result = handler.lambda_handler(event(message([card(0)])), None)
        assert result == {"batchItemFailures": []}
        (body,) = reports(core)
        assert set(body) == REPORT_KEYS
        assert (body["provider"], body["model"]) == ("bedrock", "anthropic.claude-opus-5")
        (item,) = body["items"]
        assert (item["status"], item["errorCode"]) == ("done", None)
        assert len(item["findings"]) == 1
        assert [cfg.provider for cfg in made] == ["bedrock"]

    @pytest.mark.parametrize(
        "bad,provider",
        [
            ({"AI_QA_AUTOMATION_PROVIDER": "openai"}, "unset"),
            (
                {"AI_QA_AUTOMATION_PROVIDER": "bedrock-converse", "AI_QA_AUTOMATION_MODEL": "anthropic.claude-opus-5"},
                "bedrock-converse",
            ),
        ],
    )
    def test_invalid_automation_setting_fails_automation_messages_with_config(
        self, harness, monkeypatch, capsys, bad, provider
    ) -> None:
        core, clients, made = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, **bad, "AI_QA_ENABLED": "1"})
        result = handler.lambda_handler(event(message([draft_card()], target="draft", profile="automation")), None)
        assert result == {"batchItemFailures": []}  # acked
        assert made == [] and model_calls(clients) == 0
        (body,) = reports(core)
        assert body["provider"] == provider and body["model"] == "unset"
        assert body["promptVersion"] == "qa-v4-auto"
        assert [(i["status"], i["errorCode"]) for i in body["items"]] == [("error", "CONFIG")]
        out = capsys.readouterr().out
        assert '"profile_config_invalid"' in out and '"config_invalid"' not in out

    def test_effective_effort_is_recorded_never_dropped_silently(self, harness, monkeypatch, capsys) -> None:
        """B03 ai-agent-9: AI_EFFORT is not sent on the Converse path (no documented field), so the
        effort is recorded as provider-default in the card log and the usage EMF line; the Mantle
        reviewer records the configured effort."""
        core, clients, _ = harness
        set_env(monkeypatch, {**AUTOMATION_ENV, "AI_QA_ENABLED": "1", "AI_EFFORT": "high"})
        clients["bedrock-converse"].script = [reply(review_json())]
        clients["bedrock"].script = [reply(review_json())]
        handler.lambda_handler(event(message([draft_card()], target="draft", profile="automation")), None)
        handler.lambda_handler(event(message([card(1)])), None)
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]

        (not_sent,) = [line for line in lines if line.get("event") == "effort_not_sent"]
        assert (not_sent["provider"], not_sent["configuredEffort"], not_sent["effectiveEffort"]) == (
            "bedrock-converse",
            "high",
            "provider-default",
        )
        results = {line["cardId"]: line for line in lines if line.get("event") == "card_result"}
        assert results[DRAFT_ID]["effort"] == "provider-default"
        assert results[102]["effort"] == "high"
        usage = {line["Provider"]: line for line in lines if "AiQaCardsReviewed" in line}
        assert usage["bedrock-converse"]["Effort"] == "provider-default"
        assert usage["bedrock"]["Effort"] == "high"
        # A plain property, never a dimension: the metric series are unchanged.
        assert usage["bedrock"]["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service", "Provider"]]

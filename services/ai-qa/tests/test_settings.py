import json
from pathlib import Path

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from ai_qa import settings
from ai_qa.settings import ConfigError, Settings, is_truthy, load_secret, load_settings

PROD_ENV = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"


def test_defaults_match_contract() -> None:
    s = load_settings({})
    assert s == Settings(
        provider="bedrock",
        model="anthropic.claude-opus-5",
        bedrock_region="ap-southeast-2",
        effort="high",
        structured_outputs="auto",
        enabled=False,
        price_input_per_mtok=5.0,
        price_output_per_mtok=25.0,
    )
    assert s.anthropic_api_key_ssm_name == "/developercards/prod/anthropic-api-key"
    assert s.internal_secret_ssm_name == "/developercards/prod/ai-qa-results-secret"
    assert s.core_api_base == "https://api.developercards.app"
    assert s.metrics_namespace == "DeveloperCards"
    # The first eight fields are the public API, in this order.
    names = [f for f in Settings.__dataclass_fields__][:8]
    assert names == [
        "provider",
        "model",
        "bedrock_region",
        "effort",
        "structured_outputs",
        "enabled",
        "price_input_per_mtok",
        "price_output_per_mtok",
    ]
    with pytest.raises(AttributeError):
        s.model = "x"  # frozen


def test_anthropic_provider_defaults_to_first_party_model_id() -> None:
    assert load_settings({"AI_PROVIDER": "anthropic"}).model == "claude-opus-5"
    assert load_settings({"AI_PROVIDER": "anthropic", "AI_MODEL": "  "}).model == "claude-opus-5"
    assert load_settings({"AI_PROVIDER": "bedrock", "AI_MODEL": ""}).model == "anthropic.claude-opus-5"


def test_model_id_prefix_must_match_provider() -> None:
    with pytest.raises(ConfigError):
        load_settings({"AI_PROVIDER": "bedrock", "AI_MODEL": "claude-opus-5"})
    with pytest.raises(ConfigError):
        load_settings({"AI_PROVIDER": "anthropic", "AI_MODEL": "anthropic.claude-opus-5"})
    assert load_settings({"AI_MODEL": "anthropic.claude-opus-5"}).model == "anthropic.claude-opus-5"


@pytest.mark.parametrize(
    "env",
    [
        {"AI_PROVIDER": "openai"},
        {"AI_EFFORT": "extreme"},
        {"AI_STRUCTURED_OUTPUTS": "maybe"},
        {"AI_PRICE_INPUT_PER_MTOK": "-1"},
        {"AI_PRICE_OUTPUT_PER_MTOK": "cheap"},
        {"AI_PRICE_OUTPUT_PER_MTOK": "nan"},
    ],
)
def test_invalid_values_raise_config_error(env) -> None:
    with pytest.raises(ConfigError):
        load_settings(env)
    assert issubclass(ConfigError, ValueError)


def test_truthy_flags_follow_route_metrics_rule() -> None:
    for value in ("1", " 1 ", "true", "TRUE", "True", "yes", " YES "):
        assert is_truthy(value), value
        assert load_settings({"AI_QA_ENABLED": value}).enabled is True
    for value in (None, "", "0", "false", "no", "on", "enabled", "2", "y"):
        assert not is_truthy(value), value
    for value in ("", "0", "false", "on"):
        assert load_settings({"AI_QA_ENABLED": value}).enabled is False


def test_prod_env_file_matches_contract() -> None:
    data = json.loads(PROD_ENV.read_text())
    assert data == {
        "AI_PROVIDER": "bedrock",
        "AI_MODEL": "anthropic.claude-opus-5",
        "AI_BEDROCK_REGION": "ap-southeast-2",
        "AI_EFFORT": "high",
        "AI_STRUCTURED_OUTPUTS": "auto",
        "AI_QA_ENABLED": "0",
        "ANTHROPIC_API_KEY_SSM_NAME": "/developercards/prod/anthropic-api-key",
        "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/ai-qa-results-secret",  # per-route secret (Z08)
        "CORE_API_BASE": "https://api.developercards.app",
        "METRICS_NAMESPACE": "DeveloperCards",
        "AI_PRICE_INPUT_PER_MTOK": "5",
        "AI_PRICE_OUTPUT_PER_MTOK": "25",
        "LOG_LEVEL": "info",
    }
    s = load_settings(data)
    assert s.enabled is False
    assert s == load_settings({})  # the committed file is exactly the defaults


def client_error(code: str) -> ClientError:
    """What boto3 raises for an SSM error response with this code."""
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "GetParameter")


class FakeSsm:
    def __init__(self, values):
        self.values = values
        self.calls = []

    def get_parameter(self, Name, WithDecryption):
        self.calls.append((Name, WithDecryption))
        value = self.values[Name]
        if isinstance(value, BaseException):
            raise value
        return {"Parameter": {"Name": Name, "Value": value}}


def test_load_secret_treats_placeholder_and_errors_as_missing_and_caches_success() -> None:
    ssm = FakeSsm(
        {
            "/p/placeholder": "PLACEHOLDER-set-by-supervisor",
            "/p/blank": "  ",
            "/p/broken": RuntimeError("boom"),
            "/p/ok": "test-secret",
        }
    )
    assert load_secret("/p/placeholder", ssm) is None
    assert load_secret("/p/placeholder", ssm) is None
    assert load_secret("/p/blank", ssm) is None
    assert load_secret("/p/broken", ssm) is None
    assert load_secret("/p/ok", ssm) == "test-secret"
    assert load_secret("/p/ok", ssm) == "test-secret"
    assert ssm.calls.count(("/p/placeholder", True)) == 2  # not cached
    assert ssm.calls.count(("/p/ok", True)) == 1  # cached on success


def test_loaded_secret_expires_after_the_ttl(monkeypatch) -> None:
    # cloud-security-resilience-11: a rotated secret reaches a warm container within the TTL.
    now = {"t": 1000.0}
    monkeypatch.setattr(settings, "clock", lambda: now["t"])
    ssm = FakeSsm({"/p/secret": "old"})
    assert load_secret("/p/secret", ssm) == "old"
    ssm.values["/p/secret"] = "new"
    now["t"] += settings.SECRET_TTL_SECONDS - 1
    assert load_secret("/p/secret", ssm) == "old"
    now["t"] += 1
    assert load_secret("/p/secret", ssm) == "new"
    assert settings.SECRET_TTL_SECONDS == 300


def test_optional_secret_absence_is_cached_for_the_ttl(monkeypatch, capsys) -> None:
    now = {"t": 1000.0}
    monkeypatch.setattr(settings, "clock", lambda: now["t"])
    ssm = FakeSsm({"/p/secret-previous": client_error("ParameterNotFound")})
    assert load_secret("/p/secret-previous", ssm, optional=True) is None
    assert load_secret("/p/secret-previous", ssm, optional=True) is None
    assert len(ssm.calls) == 1
    assert "ssm_secret_unavailable" not in capsys.readouterr().out  # absence is normal: debug only
    now["t"] += settings.SECRET_TTL_SECONDS
    ssm.values["/p/secret-previous"] = "old"
    assert load_secret("/p/secret-previous", ssm, optional=True) == "old"
    assert settings.previous_secret_name("/p/secret") == "/p/secret-previous"


@pytest.mark.parametrize(
    "make_error",
    [
        pytest.param(lambda: client_error("ThrottlingException"), id="throttling"),
        pytest.param(lambda: client_error("AccessDeniedException"), id="access-denied"),
        pytest.param(lambda: EndpointConnectionError(endpoint_url="https://ssm.test"), id="network"),
        pytest.param(lambda: RuntimeError("boom"), id="unexpected"),
    ],
)
def test_optional_read_error_is_not_cached_as_absent(monkeypatch, capsys, make_error) -> None:
    # cloud-security-resilience-16 (same rule as the dispatcher): only ParameterNotFound means
    # "absent". A throttle during a rotation must not hide "-previous" for the whole TTL.
    monkeypatch.setattr(settings, "clock", lambda: 1000.0)
    ssm = FakeSsm({"/p/secret-previous": make_error()})
    assert load_secret("/p/secret-previous", ssm, optional=True) is None
    assert '"ssm_secret_unavailable"' in capsys.readouterr().out  # a real problem: warn level
    ssm.values["/p/secret-previous"] = "old"
    assert load_secret("/p/secret-previous", ssm, optional=True) == "old"
    assert len(ssm.calls) == 2


def test_parameter_not_found_is_recognised_by_code_and_by_modeled_class() -> None:
    class ParameterNotFound(Exception):
        pass

    assert settings.is_parameter_not_found(client_error("ParameterNotFound"))
    assert settings.is_parameter_not_found(ParameterNotFound())
    assert not settings.is_parameter_not_found(client_error("ThrottlingException"))
    assert not settings.is_parameter_not_found(RuntimeError("ParameterNotFound"))


def test_max_receives_defaults_to_the_deployed_redrive_policy() -> None:
    # cloud-security-resilience-12: must equal the ai-qa queue's maxReceiveCount (2 today).
    assert load_settings({}).max_receives == 2
    assert load_settings({"AI_QA_MAX_RECEIVES": "3"}).max_receives == 3
    for bad in ("0", "-1", "x", " "):
        assert load_settings({"AI_QA_MAX_RECEIVES": bad}).max_receives == 2

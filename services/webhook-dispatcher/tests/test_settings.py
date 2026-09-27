import json
from pathlib import Path

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from webhook_dispatcher import settings

ENV_FILE = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"

CONTRACT = {
    "SIGNING_SECRET_SSM_NAME": "/developercards/prod/webhook-signing-secret",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/internal-shared-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "METRICS_NAMESPACE": "DeveloperCards",
    "WEBHOOK_HTTP_TIMEOUT_SECONDS": "10",
    "LOG_LEVEL": "info",
}


def client_error(code: str) -> ClientError:
    """What boto3 raises for an SSM error response with this code."""
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "GetParameter")


class FakeSSM:
    def __init__(self, values: dict[str, str] | None = None, error: Exception | None = None) -> None:
        self.values = values or {}
        self.error = error
        self.calls: list[dict[str, object]] = []

    def get_parameter(self, **kwargs: object) -> dict[str, dict[str, str]]:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return {"Parameter": {"Value": self.values[str(kwargs["Name"])]}}


def test_prod_env_file_matches_contract() -> None:
    assert json.loads(ENV_FILE.read_text()) == CONTRACT
    assert settings.DEFAULTS == CONTRACT
    cfg = settings.load_settings(CONTRACT)
    assert cfg == settings.load_settings({})
    assert cfg.signing_secret_ssm_name == "/developercards/prod/webhook-signing-secret"
    assert cfg.internal_secret_ssm_name == "/developercards/prod/internal-shared-secret"
    assert cfg.core_api_base == "https://api.developercards.app"
    assert cfg.metrics_namespace == "DeveloperCards"
    assert cfg.http_timeout_seconds == 10.0
    assert cfg.log_level == "info"


def test_placeholder_secret_counts_as_missing() -> None:
    name = "/developercards/prod/webhook-signing-secret"
    ssm = FakeSSM({name: "PLACEHOLDER-set-by-supervisor"})
    assert settings.load_secret(name, ssm) is None
    assert ssm.calls == [{"Name": name, "WithDecryption": True}]
    # Not cached: once the supervisor sets the value, the next invocation sees it.
    ssm.values[name] = "whsec-test"
    assert settings.load_secret(name, ssm) == "whsec-test"
    assert len(ssm.calls) == 2
    # Cached after a successful load.
    ssm.values[name] = "changed"
    assert settings.load_secret(name, ssm) == "whsec-test"
    assert len(ssm.calls) == 2


def test_empty_value_and_ssm_errors_count_as_missing(capsys) -> None:
    name = "/developercards/prod/internal-shared-secret"
    assert settings.load_secret(name, FakeSSM({name: ""})) is None
    assert settings.load_secret(name, FakeSSM(error=RuntimeError("boom test-secret"))) is None
    out = capsys.readouterr().out
    assert "RuntimeError" in out
    assert "boom" not in out and "test-secret" not in out


def test_loaded_secret_expires_after_the_ttl(monkeypatch) -> None:
    name = "/developercards/prod/webhook-signing-secret"
    t = [1000.0]
    monkeypatch.setattr(settings, "clock", lambda: t[0])
    ssm = FakeSSM({name: "whsec-old"})
    assert settings.load_secret(name, ssm) == "whsec-old"
    ssm.values[name] = "whsec-new"
    t[0] += settings.SECRET_TTL_SECONDS - 1
    assert settings.load_secret(name, ssm) == "whsec-old"
    assert len(ssm.calls) == 1
    t[0] += 1
    # A rotation reaches a warm container within the TTL (≤ 5 minutes).
    assert settings.load_secret(name, ssm) == "whsec-new"
    assert len(ssm.calls) == 2
    assert settings.SECRET_TTL_SECONDS <= 300


def test_optional_secret_absence_is_cached_for_the_ttl(monkeypatch, capsys) -> None:
    name = settings.previous_secret_name("/developercards/prod/webhook-signing-secret")
    assert name == "/developercards/prod/webhook-signing-secret-previous"
    t = [50.0]
    monkeypatch.setattr(settings, "clock", lambda: t[0])
    ssm = FakeSSM(error=client_error("ParameterNotFound"))
    assert settings.load_secret(name, ssm, optional=True) is None
    assert settings.load_secret(name, ssm, optional=True) is None
    assert len(ssm.calls) == 1
    assert "ssm_secret_unavailable" not in capsys.readouterr().out  # debug only
    ssm.error = None
    ssm.values[name] = "whsec-old"
    t[0] += settings.SECRET_TTL_SECONDS
    assert settings.load_secret(name, ssm, optional=True) == "whsec-old"


def test_presend_claim_flag_is_off_unless_set() -> None:
    assert settings.load_settings({}).presend_claim is False
    for value in ("1", "true", " YES "):
        assert settings.load_settings({"WEBHOOK_PRESEND_CLAIM": value}).presend_claim is True
    assert settings.load_settings({"WEBHOOK_PRESEND_CLAIM": "0"}).presend_claim is False
    assert settings.subscription_secret_name("/p/s", 12) == "/p/s-sub-12"


# cloud-security-resilience-16 / automation-20: only ParameterNotFound means "absent". Any other
# read error says nothing about whether the parameter exists, so it is neither cached nor turned
# into "absent" (which would let a caller fall back to another secret).
UNREADABLE_ERRORS = [
    pytest.param(lambda: client_error("ThrottlingException"), id="throttling"),
    pytest.param(lambda: client_error("AccessDeniedException"), id="access-denied"),
    pytest.param(lambda: EndpointConnectionError(endpoint_url="https://ssm.test"), id="network"),
    pytest.param(lambda: RuntimeError("boom"), id="unexpected"),
]


@pytest.mark.parametrize("make_error", UNREADABLE_ERRORS)
def test_optional_read_error_is_not_absence_and_is_not_cached(make_error, capsys) -> None:
    name = "/developercards/prod/webhook-signing-secret-sub-12"
    ssm = FakeSSM({name: "whsec-sub-12"}, error=make_error())
    with pytest.raises(settings.SecretUnreadable):
        settings.load_secret(name, ssm, optional=True)
    # A real problem, not the normal absence: logged at warn level (error class only).
    out = capsys.readouterr().out
    assert "ssm_secret_unavailable" in out and "whsec" not in out
    # The next read goes to SSM again and sees the value.
    ssm.error = None
    assert settings.load_secret(name, ssm, optional=True) == "whsec-sub-12"
    assert len(ssm.calls) == 2


@pytest.mark.parametrize("make_error", UNREADABLE_ERRORS)
def test_required_read_error_still_counts_as_missing(make_error) -> None:
    name = "/developercards/prod/webhook-signing-secret"
    ssm = FakeSSM({name: "whsec-test"}, error=make_error())
    assert settings.load_secret(name, ssm) is None
    ssm.error = None
    assert settings.load_secret(name, ssm) == "whsec-test"


def test_parameter_not_found_is_recognised_by_code_and_by_modeled_class() -> None:
    class ParameterNotFound(Exception):
        pass

    assert settings.is_parameter_not_found(client_error("ParameterNotFound"))
    assert settings.is_parameter_not_found(ParameterNotFound())
    assert not settings.is_parameter_not_found(client_error("AccessDeniedException"))
    assert not settings.is_parameter_not_found(RuntimeError("ParameterNotFound"))


def test_optional_read_without_an_ssm_client_is_unreadable(monkeypatch) -> None:
    def broken() -> object:
        raise RuntimeError("no credentials")

    monkeypatch.setattr(settings, "ssm_client", broken)
    with pytest.raises(settings.SecretUnreadable):
        settings.get_secret("/developercards/prod/webhook-signing-secret-previous", optional=True)
    assert settings.get_secret("/developercards/prod/webhook-signing-secret") is None


def test_subscription_secrets_flag_is_off_unless_set() -> None:
    assert settings.load_settings({}).subscription_secrets is False
    for value in ("1", "true", " YES "):
        assert settings.load_settings({"WEBHOOK_SUBSCRIPTION_SECRETS": value}).subscription_secrets is True
    assert settings.load_settings({"WEBHOOK_SUBSCRIPTION_SECRETS": "0"}).subscription_secrets is False

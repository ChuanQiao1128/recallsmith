import json
from pathlib import Path

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
    ssm = FakeSSM(error=RuntimeError("ParameterNotFound"))
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

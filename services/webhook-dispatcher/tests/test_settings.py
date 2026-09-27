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

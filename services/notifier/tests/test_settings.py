import json
from pathlib import Path

from conftest import OWNER, RECIPIENT_NAME, SECRET, SECRET_NAME, FakeSSM

from notifier import settings
from notifier.settings import (
    PLACEHOLDER_VALUE,
    SECRET_TTL_SECONDS,
    Settings,
    get_recipient,
    get_secret,
    load_settings,
    previous_secret_name,
)

ENV_FILE = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"
CONTRACT = {
    "NOTIFY_FROM": "DeveloperCards Automation <automation@developercards.app>",
    "NOTIFY_RECIPIENT_SSM_NAME": "/developercards/prod/notify-recipient",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/notifier-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "SES_REGION": "ap-southeast-2",
    "SES_CONFIGURATION_SET": "developercards-automation",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


class TestSettings:
    def test_prod_env_file_matches_contract(self):
        raw = ENV_FILE.read_text()
        assert json.loads(raw) == CONTRACT
        assert raw.count("\n") == 1  # one line
        assert raw == json.dumps(CONTRACT, separators=(",", ":")) + "\n"
        assert settings.DEFAULTS == CONTRACT
        loaded = load_settings(CONTRACT)
        assert loaded == load_settings({})
        assert loaded == Settings(
            notify_from="DeveloperCards Automation <automation@developercards.app>",
            notify_recipient_ssm_name=RECIPIENT_NAME,
            internal_secret_ssm_name=SECRET_NAME,
            core_api_base="https://api.developercards.app",
            ses_region="ap-southeast-2",
            ses_configuration_set="developercards-automation",
            metrics_namespace="DeveloperCards",
            log_level="info",
        )
        assert load_settings({"SES_REGION": " us-east-1 ", "LOG_LEVEL": "DEBUG"}).ses_region == "us-east-1"
        assert load_settings({"LOG_LEVEL": "DEBUG"}).log_level == "debug"

    def test_placeholder_or_missing_recipient_counts_as_unset(self, capsys):
        assert PLACEHOLDER_VALUE == "PLACEHOLDER-set-by-supervisor"
        for value in (PLACEHOLDER_VALUE, "", "   ", "not-an-address", "a@b@example.com", "owner @example.com",
                      "@example.com", "owner@", "x" * 250 + "@example.com"):
            settings.clear_secret_cache()
            ssm = FakeSSM({RECIPIENT_NAME: value})
            settings.set_clients(ssm=ssm)
            assert get_recipient() is None, value
            assert get_recipient(RECIPIENT_NAME) is None
            # Unset values are not cached: SSM is asked again.
            assert ssm.reads == [RECIPIENT_NAME, RECIPIENT_NAME]
        settings.clear_secret_cache()
        settings.set_clients(ssm=FakeSSM({}))
        assert get_recipient() is None  # ParameterNotFound

        settings.clear_secret_cache()
        ssm = FakeSSM({RECIPIENT_NAME: f" {OWNER}\n"})
        settings.set_clients(ssm=ssm)
        assert get_recipient() == OWNER
        assert get_recipient() == OWNER
        assert ssm.reads == [RECIPIENT_NAME]  # cached
        assert OWNER not in capsys.readouterr().out
        # The placeholder also counts as unset for the internal secret.
        settings.clear_secret_cache()
        settings.set_clients(ssm=FakeSSM({SECRET_NAME: PLACEHOLDER_VALUE}))
        assert get_secret(SECRET_NAME) is None

    def test_secret_ttl_is_300_seconds(self, monkeypatch):
        assert SECRET_TTL_SECONDS == 300
        now = [1000.0]
        monkeypatch.setattr(settings, "clock", lambda: now[0])
        ssm = FakeSSM({SECRET_NAME: SECRET})
        settings.set_clients(ssm=ssm)
        assert get_secret(SECRET_NAME) == SECRET
        now[0] += 299
        assert get_secret(SECRET_NAME) == SECRET
        assert ssm.reads == [SECRET_NAME]
        now[0] += 1
        ssm.values[SECRET_NAME] = "rotated"
        assert get_secret(SECRET_NAME) == "rotated"
        assert ssm.reads == [SECRET_NAME, SECRET_NAME]

    def test_previous_secret_absence_is_cached_only_for_parameter_not_found(self, monkeypatch):
        now = [0.0]
        monkeypatch.setattr(settings, "clock", lambda: now[0])
        previous = previous_secret_name(SECRET_NAME)
        assert previous == "/developercards/prod/notifier-secret-previous"
        ssm = FakeSSM({})
        settings.set_clients(ssm=ssm)
        assert get_secret(previous, optional=True) is None
        assert get_secret(previous, optional=True) is None
        assert ssm.reads == [previous]
        now[0] += 300
        assert get_secret(previous, optional=True) is None
        assert ssm.reads == [previous, previous]

        class Throttled:
            reads = 0

            def get_parameter(self, Name, WithDecryption):
                Throttled.reads += 1
                raise RuntimeError("throttled")

        settings.clear_secret_cache()
        settings.set_clients(ssm=Throttled())
        assert get_secret(previous, optional=True) is None
        assert get_secret(previous, optional=True) is None
        assert Throttled.reads == 2

    def test_ses_client_uses_the_configured_region(self, monkeypatch):
        monkeypatch.setenv("SES_REGION", "ap-southeast-2")
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
        client = settings.ses_client()
        assert client.meta.service_model.service_name == "sesv2"
        assert client.meta.region_name == "ap-southeast-2"
        assert settings.ses_client() is client
        sentinel = object()
        settings.set_clients(sesv2=sentinel)
        assert settings.ses_client() is sentinel

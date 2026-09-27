import json
from pathlib import Path

from botocore.exceptions import ClientError

from source_watcher import settings
from source_watcher.settings import (
    PLACEHOLDER_VALUE,
    SECRET_TTL_SECONDS,
    Settings,
    get_secret,
    load_settings,
    previous_secret_name,
)

ENV_FILE = Path(__file__).resolve().parent.parent / "env" / "prod.env.json"
NAME = "/developercards/prod/source-watch-secret"
CONTRACT = {
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/source-watch-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "WATCH_MAX_TARGETS": "60",
    "WATCH_TIME_BUDGET_SECONDS": "240",
    "WATCH_HTTP_TIMEOUT_SECONDS": "10",
    "WATCH_MAX_BYTES": "5242880",
    "WATCH_HOST_INTERVAL_SECONDS": "1",
    "WATCH_USER_AGENT": "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


class FakeSSM:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values
        self.reads: list[str] = []

    def get_parameter(self, Name: str, WithDecryption: bool) -> dict:
        assert WithDecryption is True
        self.reads.append(Name)
        if Name not in self.values:
            raise ClientError({"Error": {"Code": "ParameterNotFound", "Message": "x"}}, "GetParameter")
        return {"Parameter": {"Name": Name, "Value": self.values[Name]}}


class TestSettings:
    def test_prod_env_file_matches_contract(self):
        raw = ENV_FILE.read_text()
        assert json.loads(raw) == CONTRACT
        assert raw.count("\n") == 1  # one line
        assert settings.DEFAULTS == CONTRACT
        loaded = load_settings(CONTRACT)
        assert loaded == load_settings({})
        assert loaded == Settings(
            internal_secret_ssm_name=NAME,
            core_api_base="https://api.developercards.app",
            watch_max_targets=60,
            watch_time_budget_seconds=240.0,
            watch_http_timeout_seconds=10.0,
            watch_max_bytes=5242880,
            watch_host_interval_seconds=1.0,
            watch_user_agent="DeveloperCards-SourceWatch/1.0 (+https://developercards.app)",
            metrics_namespace="DeveloperCards",
            log_level="info",
        )
        assert isinstance(loaded.watch_max_targets, int) and isinstance(loaded.watch_time_budget_seconds, float)

    def test_invalid_numbers_fall_back_with_one_warning(self, capsys):
        loaded = load_settings({"WATCH_MAX_TARGETS": "500", "WATCH_MAX_BYTES": "lots", "WATCH_HOST_INTERVAL_SECONDS": "2.5"})
        assert loaded.watch_max_targets == 60 and loaded.watch_max_bytes == 5242880
        assert loaded.watch_host_interval_seconds == 2.5
        warnings = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        assert [(w["level"], w["event"], w["key"]) for w in warnings] == [
            ("warn", "setting_invalid", "WATCH_MAX_TARGETS"),
            ("warn", "setting_invalid", "WATCH_MAX_BYTES"),
        ]
        assert load_settings({"WATCH_MAX_TARGETS": "0"}).watch_max_targets == 60
        assert load_settings({"WATCH_MAX_TARGETS": "100"}).watch_max_targets == 100

    def test_placeholder_secret_counts_as_missing(self):
        assert PLACEHOLDER_VALUE == "PLACEHOLDER-set-by-supervisor"
        ssm = FakeSSM({NAME: PLACEHOLDER_VALUE})
        settings.set_clients(ssm=ssm)
        assert get_secret(NAME) is None
        assert get_secret(NAME) is None
        assert ssm.reads == [NAME, NAME]  # never cached
        ssm.values[NAME] = "   "
        assert get_secret(NAME) is None
        ssm.values[NAME] = "test-secret"
        assert get_secret(NAME) == "test-secret"
        assert previous_secret_name(NAME) == NAME + "-previous"
        assert get_secret(previous_secret_name(NAME), optional=True) is None

    def test_secret_ttl_is_300_seconds(self, monkeypatch):
        assert SECRET_TTL_SECONDS == 300
        now = [1000.0]
        monkeypatch.setattr(settings, "clock", lambda: now[0])
        ssm = FakeSSM({NAME: "test-secret"})
        settings.set_clients(ssm=ssm)
        assert get_secret(NAME) == "test-secret"
        now[0] += 299
        ssm.values[NAME] = "rotated"
        assert get_secret(NAME) == "test-secret"
        now[0] += 1
        assert get_secret(NAME) == "rotated"
        assert ssm.reads == [NAME, NAME]
        # The optional -previous: ParameterNotFound is remembered for the TTL, then read again.
        previous = previous_secret_name(NAME)
        assert get_secret(previous, optional=True) is None
        assert get_secret(previous, optional=True) is None
        assert ssm.reads.count(previous) == 1
        now[0] += 300
        assert get_secret(previous, optional=True) is None
        assert ssm.reads.count(previous) == 2

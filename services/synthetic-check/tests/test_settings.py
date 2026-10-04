"""Settings (H00 §5.2): the prod env file, base validation, CONFIG failures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import FakeSite

from synthetic_check.checks import CHECK_NAMES, CheckResult, run_checks
from synthetic_check.settings import DEFAULTS, Settings, load_settings

ENV_FILE = Path(__file__).resolve().parents[1] / "env" / "prod.env.json"
CONTRACT = {
    "API_BASE": "https://api.developercards.app",
    "CDN_BASE": "https://cdn.developercards.app",
    "CONSOLE_BASE": "https://console.developercards.app",
    "REMOTE_CONFIG_URL": "https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json",
    "COGNITO_CONSOLE_ISSUER": "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt",
    "COGNITO_MOBILE_ISSUER": "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb",
    "CHECK_TIMEOUT_SECONDS": "10",
    "CHECK_USER_AGENT": "DeveloperCards-Synthetic/1.0 (+https://developercards.app)",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


def test_prod_env_file_matches_contract() -> None:
    text = ENV_FILE.read_text()
    assert text.count("\n") == 1 and text.endswith("\n")
    doc = json.loads(text)
    assert list(doc.items()) == list(CONTRACT.items())
    assert DEFAULTS == CONTRACT
    assert load_settings({}) == load_settings(doc) == Settings(
        api_base="https://api.developercards.app",
        cdn_base="https://cdn.developercards.app",
        console_base="https://console.developercards.app",
        timeout_s=10.0,
        user_agent="DeveloperCards-Synthetic/1.0 (+https://developercards.app)",
        metrics_namespace="DeveloperCards",
        config_error=None,
        remote_config_url=CONTRACT["REMOTE_CONFIG_URL"],
        cognito_console_issuer=CONTRACT["COGNITO_CONSOLE_ISSUER"],
        cognito_mobile_issuer=CONTRACT["COGNITO_MOBILE_ISSUER"],
    )


def test_remote_config_url_is_the_one_the_app_reads() -> None:
    app = (Path(__file__).resolve().parents[3] / "mobile" / "App.tsx").read_text()
    assert f"const REMOTE_CONFIG_URL = '{CONTRACT['REMOTE_CONFIG_URL']}';" in app


def test_cognito_issuers_are_the_api_issuers() -> None:
    # core-vpc's AUTH_ISSUERS default (JwtVerifier.DefaultIssuers) names the same two pools, console first.
    verifier = (Path(__file__).resolve().parents[3] / "src_C" / "Shared" / "RecallSmith.Lambda.Common" / "JwtVerifier.cs").read_text()
    console_pool = CONTRACT["COGNITO_CONSOLE_ISSUER"].rsplit("/", 1)[1]
    mobile_pool = CONTRACT["COGNITO_MOBILE_ISSUER"].rsplit("/", 1)[1]
    assert f'DefaultIssuers = "{console_pool},{mobile_pool}"' in verifier
    auth = (Path(__file__).resolve().parents[3] / "src_C" / "Shared" / "RecallSmith.Lambda.Common" / "Auth.cs").read_text()
    assert f'DefaultConsolePool = "{console_pool}"' in auth


def test_document_and_issuer_urls_are_validated() -> None:
    good_urls = {
        "https://raw.githubusercontent.com/o/r/refs/heads/main/config.json": "https://raw.githubusercontent.com/o/r/refs/heads/main/config.json",
        "http://127.0.0.1:8080/mobile-config/c.json": "http://127.0.0.1:8080/mobile-config/c.json",
    }
    for value, want in good_urls.items():
        settings = load_settings({"REMOTE_CONFIG_URL": value})
        assert settings.config_error is None, value
        assert settings.remote_config_url == want
    bad_urls = [
        "",
        "https://raw.githubusercontent.com",
        "https://raw.githubusercontent.com/",
        "https://raw.githubusercontent.com/a//b.json",
        "https://raw.githubusercontent.com/a/../b.json",
        "https://raw.githubusercontent.com/a/b.json/",
        "https://raw.githubusercontent.com/a/b.json?token=x",
        "https://raw.githubusercontent.com/a/b%20c.json",
        "https://user@raw.githubusercontent.com/a.json",
        "http://raw.githubusercontent.com/a.json",
        "ftp://raw.githubusercontent.com/a.json",
    ]
    for value in bad_urls:
        settings = load_settings({"REMOTE_CONFIG_URL": value})
        assert settings.config_error == "invalid_remote_config_url", value
        if value:
            assert value not in (settings.config_error or "")
    good_issuers = [
        "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt",
        "http://127.0.0.1:9000/ap-southeast-2_test1",
    ]
    for key in ("COGNITO_CONSOLE_ISSUER", "COGNITO_MOBILE_ISSUER"):
        for value in good_issuers:
            settings = load_settings({key: value})
            assert settings.config_error is None, (key, value)
        for value in (
            "https://cognito-idp.ap-southeast-2.amazonaws.com",
            "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt/",
            "https://cognito-idp.ap-southeast-2.amazonaws.com/a/ap-southeast-2_4Vf8uCXKt",
            "https://cognito-idp.ap-southeast-2.amazonaws.com/nopoolid",
            "http://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt",
        ):
            assert load_settings({key: value}).config_error == f"invalid_{key.lower()}", (key, value)


def test_only_https_or_loopback_bases_are_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    good = {
        "https://api.developercards.app": "https://api.developercards.app",
        "https://api.developercards.app/": "https://api.developercards.app",
        "https://x:8443": "https://x:8443",
        "http://127.0.0.1:8080": "http://127.0.0.1:8080",
        "http://127.0.0.1:8080/": "http://127.0.0.1:8080",
    }
    for value, want in good.items():
        settings = load_settings({"API_BASE": value})
        assert settings.config_error is None, value
        assert settings.api_base == want
    bad = [
        "http://example.com",
        "https://user@x",
        "https://x/path",
        "ftp://x",
        "http://localhost:1",
        "http://127.0.0.1",
        "https://x?q=1",
        "https://x#f",
        "https://x:0",
        "https://x:99999",
        "https:///path",
        "https://",
        "https://bad host",
        "",
    ]
    for key in ("API_BASE", "CDN_BASE", "CONSOLE_BASE"):
        for value in bad:
            settings = load_settings({key: value})
            assert settings.config_error is not None, (key, value)
            assert key.lower() in settings.config_error
            if value:
                assert value not in settings.config_error
    for timeout in ("0", "0.05", "10.5", "abc", "nan", "inf", ""):
        assert load_settings({"CHECK_TIMEOUT_SECONDS": timeout}).config_error == "invalid_check_timeout_seconds"
    assert load_settings({"CHECK_TIMEOUT_SECONDS": "0.1"}).timeout_s == 0.1
    assert load_settings({"CHECK_USER_AGENT": "  "}).config_error == "invalid_check_user_agent"
    assert load_settings({"METRICS_NAMESPACE": ""}).config_error == "invalid_metrics_namespace"
    # load_settings() reads os.environ at call time.
    monkeypatch.setenv("CDN_BASE", "http://example.com")
    assert load_settings().config_error == "invalid_cdn_base"
    monkeypatch.setenv("CDN_BASE", "https://cdn.developercards.app")
    assert load_settings().config_error is None


def test_config_failure_fails_every_check(fake_site: FakeSite) -> None:
    results = run_checks(fake_site.settings(CONSOLE_BASE="http://example.com"))
    assert results == [CheckResult(name, False, None, 0, "CONFIG") for name in CHECK_NAMES]
    assert fake_site.requests == []

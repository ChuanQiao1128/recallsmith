"""R28 MONITOR: the four checks that need no account and no new IAM, against the loopback fake site.

api-sync-guard (the token-less sync route answers exactly 401), remote-config (fetch and schema sanity of the
document the app reads), cognito-console / cognito-mobile (OIDC discovery and JWKS of each pool).
"""

from __future__ import annotations

import json

from conftest import (
    CONSOLE_POOL,
    MOBILE_POOL,
    REMOTE_CONFIG_PATH,
    SYNC_PATH,
    FakeSite,
    discovery_doc,
    discovery_path,
    json_answer,
    jwks_doc,
    jwks_path,
    remote_config,
)

from synthetic_check.checks import CHECK_NAMES, SMALL_DOC_CAP, CheckResult, run_checks


def _by_name(results: list[CheckResult]) -> dict[str, CheckResult]:
    assert [r.name for r in results] == list(CHECK_NAMES)
    return {r.name: r for r in results}


def _failed(results: list[CheckResult]) -> list[str]:
    return [r.name for r in results if not r.ok]


def _outcome(result: CheckResult) -> tuple[int | None, str | None, str | None]:
    return result.status, result.code, result.detail


# ── api-sync-guard ──────────────────────────────────────────────────────────────────────────────────


def test_sync_guard_needs_exactly_401(fake_site: FakeSite) -> None:
    # 200: the route lost its authorizer and core-vpc served it; 403: core-vpc refused an unguarded call;
    # 429: a throttle (the 2026-09-23 incident); 5xx: an outage.
    for status in (200, 403, 404, 429, 500, 503):
        fake_site.routes[SYNC_PATH] = json_answer(status, {})
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["api-sync-guard"], status
        assert _outcome(_by_name(results)["api-sync-guard"]) == (status, "HTTP_STATUS", None)


def test_sync_guard_sends_no_token(fake_site: FakeSite) -> None:
    run_checks(fake_site.settings())
    (sync,) = [r for r in fake_site.requests if r.path == SYNC_PATH]
    assert sync.headers.get("Authorization") is None


# ── remote-config ───────────────────────────────────────────────────────────────────────────────────


def _config_result(fake_site: FakeSite, doc: object) -> CheckResult:
    fake_site.routes[REMOTE_CONFIG_PATH] = (200, {"Content-Type": "text/plain"}, json.dumps(doc).encode())
    return _by_name(run_checks(fake_site.settings()))["remote-config"]


def test_remote_config_passes_on_the_live_shape_and_on_empty_sections(fake_site: FakeSite) -> None:
    for doc in (
        remote_config(),
        {},
        {"ios": {}},
        {"features": {}},
        {"ios": None, "features": None},
        {"ios": {"updateUrl": "", "minSupportedVersion": " 2.0 ", "latestVersion": "2.0.1", "message": ""}},
        {"features": {"mcq": {"enabled": False, "maxPerRun": 3, "recallFirst": True, "answerTelemetry": False}}},
        {"features": {"mcq": {"maxPerRun": 3.0}, "mistakeBook": {"enabled": True, "relatedCount": 5}}},
        {"features": {"paywall": None, "sentry": {"enabled": None}}},
        # A flag only a newer app reads, and an unknown leaf on a known flag, are allowed.
        {"features": {"brandNewFlag": {"enabled": True}, "fsrs": {"enabled": True, "newLeaf": "x"}}},
        # F3 (R28 review): latestVersion is trimmed and returned by resolveIosUpdate but never gates or shows
        # anything, so a floor above it (1.9.0 over the live 1.3.0 after 2.0.0 ships) or any string is fine.
        {"ios": {**remote_config()["ios"], "minSupportedVersion": "1.9.0", "latestVersion": "1.3.0"}},
        {"ios": {**remote_config()["ios"], "latestVersion": "2.0.0 (24)"}},
    ):
        result = _config_result(fake_site, doc)
        assert result.ok, (doc, result)
        assert _outcome(result) == (200, None, None)


def test_remote_config_rules(fake_site: FakeSite) -> None:
    ios = remote_config()["ios"]
    cases: list[tuple[object, str]] = [
        ([1, 2], "json"),
        ("text", "json"),
        ({"ios": []}, "ios"),
        ({"ios": {**ios, "minSupportedVersion": 2}}, "ios.minSupportedVersion"),
        ({"ios": {**ios, "minSupportedVersion": "two"}}, "ios.minSupportedVersion"),
        ({"ios": {**ios, "minSupportedVersion": "1.3.0-beta"}}, "ios.minSupportedVersion"),
        ({"ios": {**ios, "latestVersion": 130}}, "ios.latestVersion"),
        ({"ios": {**ios, "updateUrl": "https://example.com/phish"}}, "ios.updateUrl"),
        ({"ios": {**ios, "updateUrl": "http://apps.apple.com/app/id1"}}, "ios.updateUrl"),
        ({"ios": {**ios, "updateUrl": "https://apps.apple.com.evil.example/app"}}, "ios.updateUrl"),
        ({"ios": {**ios, "updateUrl": True}}, "ios.updateUrl"),
        ({"ios": {**ios, "appStoreId": "id6756"}}, "ios.appStoreId"),
        ({"ios": {**ios, "appStoreId": 6756044885}}, "ios.appStoreId"),
        ({"ios": {**ios, "message": ["a"]}}, "ios.message"),
        ({"features": []}, "features"),
        ({"features": {"paywall": True}}, "features.paywall"),
        ({"features": {"paywall": {"hidden": "true"}}}, "features.paywall.hidden"),
        ({"features": {"cardReport": {"enabled": 1}}}, "features.cardReport.enabled"),
        ({"features": {"mcq": {"maxPerRun": -1}}}, "features.mcq.maxPerRun"),
        ({"features": {"mcq": {"maxPerRun": 2.5}}}, "features.mcq.maxPerRun"),
        ({"features": {"mcq": {"maxPerRun": True}}}, "features.mcq.maxPerRun"),
        ({"features": {"mistakeBook": {"relatedCount": 6}}}, "features.mistakeBook.relatedCount"),
        ({"features": {"brandNewFlag": "on"}}, "features.unknown"),
    ]
    for doc, rule in cases:
        result = _config_result(fake_site, doc)
        assert _outcome(result) == (200, "BAD_BODY", rule), doc


def test_remote_config_needs_a_200_json_document_under_the_cap(fake_site: FakeSite) -> None:
    fake_site.routes[REMOTE_CONFIG_PATH] = json_answer(404, {})
    assert _outcome(_by_name(run_checks(fake_site.settings()))["remote-config"]) == (404, "HTTP_STATUS", None)
    fake_site.routes[REMOTE_CONFIG_PATH] = (200, {"Content-Type": "text/plain"}, b"{ not json")
    assert _outcome(_by_name(run_checks(fake_site.settings()))["remote-config"]) == (200, "BAD_BODY", "json")
    fake_site.routes[REMOTE_CONFIG_PATH] = (200, {"Content-Type": "text/plain"}, b" " * (SMALL_DOC_CAP + 1))
    assert _outcome(_by_name(run_checks(fake_site.settings()))["remote-config"]) == (200, "TOO_LARGE", None)
    fake_site.routes[REMOTE_CONFIG_PATH] = (302, {"Location": fake_site.base_url + "/elsewhere.json"}, b"")
    assert _outcome(_by_name(run_checks(fake_site.settings()))["remote-config"]) == (302, "HTTP_STATUS", None)
    assert "/elsewhere.json" not in fake_site.paths


# ── cognito-console / cognito-mobile ────────────────────────────────────────────────────────────────


def test_cognito_checks_fetch_discovery_then_the_configured_jwks(fake_site: FakeSite) -> None:
    results = run_checks(fake_site.settings())
    by = _by_name(results)
    assert by["cognito-console"].ok and by["cognito-mobile"].ok
    assert _outcome(by["cognito-console"]) == (200, None, None)
    paths = fake_site.paths
    for pool in (CONSOLE_POOL, MOBILE_POOL):
        assert paths.index(discovery_path(pool)) + 1 == paths.index(jwks_path(pool))


def test_cognito_discovery_must_name_this_issuer_and_its_jwks(fake_site: FakeSite) -> None:
    base = fake_site.base_url
    cases: list[tuple[object, str]] = [
        (discovery_doc(base, CONSOLE_POOL, issuer=f"{base}/{MOBILE_POOL}"), "discovery.issuer"),
        (discovery_doc(base, CONSOLE_POOL, issuer=None), "discovery.issuer"),
        ([1], "discovery.issuer"),
        (discovery_doc(base, CONSOLE_POOL, jwks_uri=f"{base}/{CONSOLE_POOL}/keys.json"), "discovery.jwks_uri"),
        (discovery_doc(base, CONSOLE_POOL, jwks_uri="https://elsewhere.invalid/jwks.json"), "discovery.jwks_uri"),
    ]
    for doc, rule in cases:
        fake_site.routes[discovery_path(CONSOLE_POOL)] = json_answer(200, doc)
        fake_site.requests.clear()
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["cognito-console"], doc
        assert _outcome(_by_name(results)["cognito-console"]) == (200, "BAD_BODY", rule), doc
        assert jwks_path(CONSOLE_POOL) not in fake_site.paths


def test_cognito_jwks_must_hold_an_rs256_signing_key(fake_site: FakeSite) -> None:
    rsa = {"alg": "RS256", "e": "AQAB", "kid": "k1", "kty": "RSA", "n": "abc", "use": "sig"}
    cases: list[tuple[object, str]] = [
        ({}, "jwks.keys"),
        ({"keys": []}, "jwks.keys"),
        ({"keys": "k"}, "jwks.keys"),
        ([rsa], "jwks.keys"),
        (jwks_doc([{**rsa, "kid": ""}]), "jwks.keys"),
        (jwks_doc([{**rsa, "kid": 7}]), "jwks.keys"),
        (jwks_doc(["k1"]), "jwks.keys"),
        (jwks_doc([{**rsa, "alg": "RS512"}]), "jwks.rs256"),
        (jwks_doc([{**rsa, "use": "enc"}]), "jwks.rs256"),
        (jwks_doc([{**rsa, "kty": "EC", "alg": "ES256"}]), "jwks.rs256"),
    ]
    for doc, rule in cases:
        fake_site.routes[jwks_path(MOBILE_POOL)] = json_answer(200, doc)
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["cognito-mobile"], doc
        assert _outcome(_by_name(results)["cognito-mobile"]) == (200, "BAD_BODY", rule), doc
    # One RS256 signing key among others is enough (Cognito rotates by publishing two).
    fake_site.routes[jwks_path(MOBILE_POOL)] = json_answer(200, jwks_doc([{**rsa, "kid": "k0", "alg": "RS512"}, {k: v for k, v in rsa.items() if k != "use"}]))
    assert _failed(run_checks(fake_site.settings())) == []


def test_cognito_transport_failures_name_the_step(fake_site: FakeSite) -> None:
    fake_site.routes[discovery_path(CONSOLE_POOL)] = json_answer(503, {})
    by = _by_name(run_checks(fake_site.settings()))
    assert _outcome(by["cognito-console"]) == (503, "HTTP_STATUS", "discovery")
    fake_site.routes[discovery_path(CONSOLE_POOL)] = json_answer(200, discovery_doc(fake_site.base_url, CONSOLE_POOL))
    fake_site.routes[jwks_path(CONSOLE_POOL)] = (200, {"Content-Type": "application/json"}, b"<html>")
    assert _outcome(_by_name(run_checks(fake_site.settings()))["cognito-console"]) == (200, "BAD_BODY", "jwks")
    fake_site.routes[jwks_path(CONSOLE_POOL)] = (200, {"Content-Type": "application/json"}, b" " * (SMALL_DOC_CAP + 1))
    assert _outcome(_by_name(run_checks(fake_site.settings()))["cognito-console"]) == (200, "TOO_LARGE", "jwks")
    del fake_site.routes[jwks_path(CONSOLE_POOL)]
    assert _outcome(_by_name(run_checks(fake_site.settings()))["cognito-console"]) == (404, "HTTP_STATUS", "jwks")

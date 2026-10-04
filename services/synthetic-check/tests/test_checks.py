"""The checks against the loopback fake site: pass, each failure code, no redirect, no credential.
The four R28 checks' own cases are in test_r28_checks.py."""

from __future__ import annotations

import hashlib
import http.server
import socket
import time

from conftest import DECK_BODY, DECK_PATH, DECK_SHA, USER_AGENT, FakeSite, json_answer, manifest, r28_paths

from synthetic_check.checks import CHECK_NAMES, BODY_CAP, DECK_CAP, CheckResult, run_checks

DECK_ROUTE = "/content/" + DECK_PATH


def _by_name(results: list[CheckResult]) -> dict[str, CheckResult]:
    assert [r.name for r in results] == list(CHECK_NAMES)
    return {r.name: r for r in results}


def _failed(results: list[CheckResult]) -> list[str]:
    return [r.name for r in results if not r.ok]


def test_all_checks_pass(fake_site: FakeSite) -> None:
    results = run_checks(fake_site.settings())
    by = _by_name(results)
    assert _failed(results) == []
    assert all(r.code is None and r.detail is None and isinstance(r.ms, int) and r.ms >= 0 for r in results)
    assert [by[n].status for n in CHECK_NAMES] == [200, 200, 200, 200, 401, 401, 200, 200, 200]
    assert fake_site.paths == ["/health", "/content/manifest.json", DECK_ROUTE, "/", "/api/v1/me", *r28_paths()]


def test_api_health_fails_on_status(fake_site: FakeSite) -> None:
    fake_site.routes["/health"] = json_answer(503, {"success": False})
    results = run_checks(fake_site.settings())
    assert _failed(results) == ["api-health"]
    assert _by_name(results)["api-health"] == CheckResult("api-health", False, 503, results[0].ms, "HTTP_STATUS")


def test_api_health_fails_on_bad_body(fake_site: FakeSite) -> None:
    for doc in ({"success": True, "data": {"ok": False}}, {"success": "true", "data": {"ok": True}}, {"success": True}, [1]):
        fake_site.routes["/health"] = json_answer(200, doc)
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["api-health"], doc
        assert (results[0].status, results[0].code) == (200, "BAD_BODY")
    fake_site.routes["/health"] = (200, {"Content-Type": "application/json"}, b"<html>oops</html>")
    assert run_checks(fake_site.settings())[0].code == "BAD_BODY"


def test_cdn_manifest_fails_on_bad_json(fake_site: FakeSite) -> None:
    bad = [
        (200, {"Content-Type": "application/json"}, b"not json"),
        json_answer(200, ["decks"]),
        json_answer(200, manifest(schemaVersion="2")),
        json_answer(200, manifest(schemaVersion=True)),
        json_answer(200, manifest(decks=[])),
        json_answer(200, manifest(decks={"a": 1})),
    ]
    for route in bad:
        fake_site.routes["/content/manifest.json"] = route
        fake_site.requests.clear()
        by = _by_name(run_checks(fake_site.settings()))
        assert (by["cdn-manifest"].status, by["cdn-manifest"].code) == (200, "BAD_BODY")
        assert (by["cdn-deck"].status, by["cdn-deck"].code) == (None, "NO_PUBLIC_DECK")
        assert DECK_ROUTE not in fake_site.paths


def test_cdn_manifest_too_large(fake_site: FakeSite) -> None:
    fake_site.routes["/content/manifest.json"] = (200, {"Content-Type": "application/json"}, b" " * (BODY_CAP + 1))
    by = _by_name(run_checks(fake_site.settings()))
    assert (by["cdn-manifest"].status, by["cdn-manifest"].code) == (200, "TOO_LARGE")
    assert by["cdn-deck"].code == "NO_PUBLIC_DECK"
    fake_site.routes["/content/manifest.json"] = (
        200,
        {"Content-Type": "application/json"},
        json_answer(200, manifest())[2].ljust(BODY_CAP, b" "),
    )
    assert _failed(run_checks(fake_site.settings())) == []


def test_cdn_deck_hash_mismatch(fake_site: FakeSite) -> None:
    fake_site.routes[DECK_ROUTE] = (200, {"Content-Type": "application/json"}, DECK_BODY + b" ")
    results = run_checks(fake_site.settings())
    assert _failed(results) == ["cdn-deck"]
    assert (_by_name(results)["cdn-deck"].status, _by_name(results)["cdn-deck"].code) == (200, "HASH_MISMATCH")
    fake_site.routes[DECK_ROUTE] = json_answer(404, {})
    assert (_by_name(run_checks(fake_site.settings()))["cdn-deck"].code) == "HTTP_STATUS"


def test_cdn_deck_too_large(fake_site: FakeSite) -> None:
    big = b"x" * (DECK_CAP + 1)
    decks = [{"downloadMode": "public", "availability": "live", "path": DECK_PATH, "sha256": hashlib.sha256(big).hexdigest()}]
    fake_site.routes["/content/manifest.json"] = json_answer(200, manifest(decks))
    fake_site.routes[DECK_ROUTE] = (200, {"Content-Type": "application/json"}, big)
    by = _by_name(run_checks(fake_site.settings()))
    assert (by["cdn-deck"].status, by["cdn-deck"].code) == (200, "TOO_LARGE")


def test_cdn_deck_no_public_deck_when_manifest_fails(fake_site: FakeSite) -> None:
    fake_site.routes["/content/manifest.json"] = json_answer(500, {})
    results = run_checks(fake_site.settings())
    assert _failed(results) == ["cdn-manifest", "cdn-deck"]
    by = _by_name(results)
    assert (by["cdn-manifest"].status, by["cdn-manifest"].code) == (500, "HTTP_STATUS")
    assert (by["cdn-deck"].status, by["cdn-deck"].code) == (None, "NO_PUBLIC_DECK")
    assert DECK_ROUTE not in fake_site.paths
    for bad_prefix in (None, 3, "", "/", "../content", "a?b"):
        doc = manifest()
        doc["prefix"] = bad_prefix
        fake_site.routes["/content/manifest.json"] = json_answer(200, doc)
        assert _failed(run_checks(fake_site.settings())) == ["cdn-deck"], bad_prefix


def test_cdn_deck_skips_non_public_and_non_live_entries(fake_site: FakeSite) -> None:
    # The default manifest lists a premium and a retired deck first: only the demo deck is fetched.
    results = run_checks(fake_site.settings())
    assert _failed(results) == []
    assert "/content/decks/premium/deck.json" not in fake_site.paths
    assert "/content/decks/retired/deck.json" not in fake_site.paths
    live = {"downloadMode": "public", "availability": "live", "sha256": DECK_SHA}
    unsafe = [
        "not a deck",
        {**live, "path": "/decks/demo/builds/b1/deck.json"},
        {**live, "path": "https://elsewhere.invalid/deck.json"},
        {**live, "path": "decks/../../deck.json"},
        {**live, "path": "decks/demo/deck.json?x=1"},
        {**live, "path": DECK_PATH, "sha256": DECK_SHA.upper()},
        {**live, "path": DECK_PATH, "sha256": DECK_SHA[:-1]},
    ]
    fake_site.routes["/content/manifest.json"] = json_answer(200, manifest(unsafe))
    fake_site.requests.clear()
    by = _by_name(run_checks(fake_site.settings()))
    assert by["cdn-manifest"].ok
    assert (by["cdn-deck"].status, by["cdn-deck"].code) == (None, "NO_PUBLIC_DECK")
    assert fake_site.paths == ["/health", "/content/manifest.json", "/", "/api/v1/me", *r28_paths()]
    fake_site.routes["/content/manifest.json"] = json_answer(200, manifest([*unsafe, {**live, "path": DECK_PATH}]))
    assert _failed(run_checks(fake_site.settings())) == []


def test_console_index_needs_html(fake_site: FakeSite) -> None:
    for route in (
        (200, {"Content-Type": "application/json"}, b"<html></html>"),
        (200, {"Content-Type": "text/html"}, b"console without markup"),
        (200, {}, b"<html></html>"),
    ):
        fake_site.routes["/"] = route
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["console-index"]
        assert (_by_name(results)["console-index"].status, _by_name(results)["console-index"].code) == (200, "BAD_BODY")
    fake_site.routes["/"] = (200, {"Content-Type": "TEXT/HTML; charset=UTF-8"}, b"<!DOCTYPE html><HTML lang=en></HTML>")
    assert _failed(run_checks(fake_site.settings())) == []
    fake_site.routes["/"] = (404, {"Content-Type": "text/html"}, b"<html></html>")
    assert _by_name(run_checks(fake_site.settings()))["console-index"].code == "HTTP_STATUS"


def test_api_auth_guard_fails_on_200(fake_site: FakeSite) -> None:
    for status in (200, 403):
        fake_site.routes["/api/v1/me"] = json_answer(status, {"success": True})
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["api-auth-guard"]
        guard = _by_name(results)["api-auth-guard"]
        assert (guard.status, guard.code) == (status, "HTTP_STATUS")


def test_api_auth_guard_fails_on_5xx(fake_site: FakeSite) -> None:
    for status in (500, 502, 503):
        fake_site.routes["/api/v1/me"] = json_answer(status, {})
        results = run_checks(fake_site.settings())
        assert _failed(results) == ["api-auth-guard"]
        guard = _by_name(results)["api-auth-guard"]
        assert (guard.status, guard.code) == (status, "HTTP_STATUS")


def _sleepy(handler: http.server.BaseHTTPRequestHandler) -> None:
    time.sleep(2.0)
    try:
        handler.send_response(200)
        handler.send_header("Content-Length", "2")
        handler.end_headers()
        handler.wfile.write(b"{}")
    except OSError:
        return


def test_timeout_is_timeout(fake_site: FakeSite) -> None:
    fake_site.routes["/api/v1/me"] = _sleepy
    started = time.monotonic()
    results = run_checks(fake_site.settings())
    assert _failed(results) == ["api-auth-guard"]
    guard = _by_name(results)["api-auth-guard"]
    assert (guard.status, guard.code) == (None, "TIMEOUT")
    assert 900 <= guard.ms < 1900
    assert time.monotonic() - started < 1.9


def test_redirect_is_not_followed(fake_site: FakeSite) -> None:
    fake_site.routes["/health"] = (302, {"Location": fake_site.base_url + "/moved"}, b"")
    fake_site.routes["/moved"] = json_answer(200, {"success": True, "data": {"ok": True}})
    results = run_checks(fake_site.settings())
    assert _failed(results) == ["api-health"]
    assert (results[0].status, results[0].code) == (302, "HTTP_STATUS")
    assert "/moved" not in fake_site.paths
    fake_site.routes["/api/v1/me"] = (301, {"Location": fake_site.base_url + "/moved"}, b"")
    assert _by_name(run_checks(fake_site.settings()))["api-auth-guard"].code == "HTTP_STATUS"
    assert "/moved" not in fake_site.paths


def test_connection_refused_is_network(fake_site: FakeSite) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        closed_port = sock.getsockname()[1]
    dead = f"http://127.0.0.1:{closed_port}"
    results = run_checks(fake_site.settings(API_BASE=dead))
    by = _by_name(results)
    assert _failed(results) == ["api-health", "api-auth-guard", "api-sync-guard"]
    assert (by["api-health"].status, by["api-health"].code) == (None, "NETWORK")
    assert (by["api-auth-guard"].status, by["api-auth-guard"].code) == (None, "NETWORK")
    assert (by["api-sync-guard"].status, by["api-sync-guard"].code) == (None, "NETWORK")


def test_requests_carry_user_agent_and_no_authorization(fake_site: FakeSite) -> None:
    run_checks(fake_site.settings())
    assert len(fake_site.requests) == 5 + len(r28_paths())
    for captured in fake_site.requests:
        assert captured.headers.get_all("User-Agent") == [USER_AGENT]
        assert captured.headers.get("Accept")
        assert captured.headers.get("Authorization") is None
        assert captured.headers.get("Cookie") is None
        assert captured.headers.get("Proxy-Authorization") is None

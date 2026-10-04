"""Shared fixtures: one loopback HTTP server on 127.0.0.1 faking every probed path, per-test overridable."""

from __future__ import annotations

import hashlib
import http.server
import json
import sys
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.message import Message
from typing import Any

import pytest

from synthetic_check import tracectx
from synthetic_check.settings import Settings, load_settings

# No bytecode cache under tests/: the verify greps this directory for the real hostnames, which only
# test_settings.py may name, and a cached test_settings .pyc would carry them too.
sys.dont_write_bytecode = True

USER_AGENT = "DeveloperCards-Synthetic/1.0 (+https://developercards.app)"
DECK_PATH = "decks/demo/builds/b1/deck.json"
DECK_BODY = json.dumps({"deck": "demo", "cards": [{"q": f"question {i}", "a": "answer"} for i in range(40)]}).encode()
DECK_SHA = hashlib.sha256(DECK_BODY).hexdigest()

# R28 MONITOR: the remote-config document and the two Cognito issuers, served by the same loopback site.
REMOTE_CONFIG_PATH = "/mobile-config/recallsmith-config.json"
CONSOLE_POOL = "ap-southeast-2_consoletest1"
MOBILE_POOL = "ap-southeast-2_mobiletest1"
SYNC_PATH = "/api/v1/sync/progress"


def remote_config(**extra: Any) -> dict[str, Any]:
    """The shape of the live document on 2026-10-04 (values are test values)."""
    doc: dict[str, Any] = {
        "ios": {
            "minSupportedVersion": "1.3.0",
            "latestVersion": "1.3.0",
            "appStoreId": "1234567890",
            "updateUrl": "https://apps.apple.com/app/id1234567890",
            "message": "A new version is required to continue.",
        },
        "features": {"cardReport": {"enabled": True}, "anonFunnel": {"enabled": True}, "paywall": {"hidden": True}},
    }
    doc.update(extra)
    return doc


def discovery_path(pool: str) -> str:
    return f"/{pool}/.well-known/openid-configuration"


def jwks_path(pool: str) -> str:
    return f"/{pool}/.well-known/jwks.json"


def discovery_doc(base_url: str, pool: str, **extra: Any) -> dict[str, Any]:
    issuer = f"{base_url}/{pool}"
    doc: dict[str, Any] = {
        "issuer": issuer,
        "jwks_uri": issuer + "/.well-known/jwks.json",
        "authorization_endpoint": issuer + "/oauth2/authorize",
        "id_token_signing_alg_values_supported": ["RS256"],
    }
    doc.update(extra)
    return doc


def jwks_doc(keys: list[Any] | None = None) -> dict[str, Any]:
    return {
        "keys": keys
        if keys is not None
        else [
            {"alg": "RS256", "e": "AQAB", "kid": "kid-one", "kty": "RSA", "n": "abc", "use": "sig"},
            {"alg": "RS256", "e": "AQAB", "kid": "kid-two", "kty": "RSA", "n": "def", "use": "sig"},
        ]
    }


def cognito_routes(base_url: str) -> dict[str, Any]:
    routes: dict[str, Any] = {}
    for pool in (CONSOLE_POOL, MOBILE_POOL):
        routes[discovery_path(pool)] = json_answer(200, discovery_doc(base_url, pool))
        routes[jwks_path(pool)] = json_answer(200, jwks_doc())
    return routes


def r28_paths() -> list[str]:
    """The paths the four R28 checks request, in order, when they all pass."""
    return [
        SYNC_PATH,
        REMOTE_CONFIG_PATH,
        discovery_path(CONSOLE_POOL),
        jwks_path(CONSOLE_POOL),
        discovery_path(MOBILE_POOL),
        jwks_path(MOBILE_POOL),
    ]


def manifest(decks: list[Any] | None = None, **extra: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "schemaVersion": 2,
        "prefix": "content",
        "decks": decks
        if decks is not None
        else [
            {"id": "premium", "downloadMode": "premium", "availability": "live", "path": "decks/premium/deck.json", "sha256": "0" * 64},
            {"id": "retired", "downloadMode": "public", "availability": "retired", "path": "decks/retired/deck.json", "sha256": "1" * 64},
            {"id": "demo", "downloadMode": "public", "availability": "live", "path": DECK_PATH, "sha256": DECK_SHA},
        ],
    }
    doc.update(extra)
    return doc


def json_answer(status: int, doc: Any) -> tuple[int, dict[str, str], bytes]:
    return status, {"Content-Type": "application/json"}, json.dumps(doc).encode()


def default_routes() -> dict[str, Any]:
    return {
        "/health": json_answer(200, {"success": True, "data": {"ok": True}, "error": None, "traceId": "t"}),
        "/content/manifest.json": json_answer(200, manifest()),
        "/content/" + DECK_PATH: (200, {"Content-Type": "application/json"}, DECK_BODY),
        "/": (200, {"Content-Type": "text/html; charset=utf-8"}, b"<!doctype html><html><body>console</body></html>"),
        "/api/v1/me": json_answer(401, {"message": "Unauthorized"}),
        SYNC_PATH: json_answer(401, {"message": "Unauthorized"}),
        # GitHub's raw host answers text/plain; the check must not care.
        REMOTE_CONFIG_PATH: (200, {"Content-Type": "text/plain; charset=utf-8"}, json.dumps(remote_config()).encode()),
    }


@dataclass
class Captured:
    path: str
    headers: Message  # case-insensitive


# A route is (status, headers, body), or a callable(handler) that writes the answer itself.
Route = tuple[int, dict[str, str], bytes] | Callable[[http.server.BaseHTTPRequestHandler], None]


@dataclass
class FakeSite:
    port: int
    routes: dict[str, Route] = field(default_factory=default_routes)
    requests: list[Captured] = field(default_factory=list)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def paths(self) -> list[str]:
        return [r.path for r in self.requests]

    def settings(self, **overrides: str) -> Settings:
        env = {
            "API_BASE": self.base_url,
            "CDN_BASE": self.base_url,
            "CONSOLE_BASE": self.base_url,
            "REMOTE_CONFIG_URL": self.base_url + REMOTE_CONFIG_PATH,
            "COGNITO_CONSOLE_ISSUER": f"{self.base_url}/{CONSOLE_POOL}",
            "COGNITO_MOBILE_ISSUER": f"{self.base_url}/{MOBILE_POOL}",
            "CHECK_TIMEOUT_SECONDS": "1",
            "CHECK_USER_AGENT": USER_AGENT,
            "METRICS_NAMESPACE": "DeveloperCards",
            "LOG_LEVEL": "info",
        }
        env.update(overrides)
        return load_settings(env)


def _fake_site(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeSite]:
    state: dict[str, FakeSite] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            site = state["site"]
            site.requests.append(Captured(self.path, self.headers))
            route = site.routes.get(self.path.split("?", 1)[0], (404, {"Content-Type": "text/plain"}, b"not found"))
            self.close_connection = True
            if callable(route):
                route(self)
                return
            status, headers, body = route
            try:
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                return

        def log_message(self, format: str, *args: Any) -> None:
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    site = FakeSite(port=httpd.server_address[1])
    site.routes.update(cognito_routes(site.base_url))
    state["site"] = site
    threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    monkeypatch.setenv("API_BASE", site.base_url)
    monkeypatch.setenv("CDN_BASE", site.base_url)
    monkeypatch.setenv("CONSOLE_BASE", site.base_url)
    monkeypatch.setenv("REMOTE_CONFIG_URL", site.base_url + REMOTE_CONFIG_PATH)
    monkeypatch.setenv("COGNITO_CONSOLE_ISSUER", f"{site.base_url}/{CONSOLE_POOL}")
    monkeypatch.setenv("COGNITO_MOBILE_ISSUER", f"{site.base_url}/{MOBILE_POOL}")
    monkeypatch.setenv("CHECK_TIMEOUT_SECONDS", "1")
    monkeypatch.setenv("CHECK_USER_AGENT", USER_AGENT)
    monkeypatch.setenv("METRICS_NAMESPACE", "DeveloperCards")
    yield site
    httpd.shutdown()
    httpd.server_close()


def _clean_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("LOG_LEVEL", "info")
    monkeypatch.delenv(tracectx.ENV_VAR, raising=False)
    tracectx.clear_upstream()
    for name in (
        "API_BASE",
        "CDN_BASE",
        "CONSOLE_BASE",
        "REMOTE_CONFIG_URL",
        "COGNITO_CONSOLE_ISSUER",
        "COGNITO_MOBILE_ISSUER",
        "CHECK_TIMEOUT_SECONDS",
        "CHECK_USER_AGENT",
        "METRICS_NAMESPACE",
    ):
        monkeypatch.delenv(name, raising=False)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    yield
    tracectx.clear_upstream()


# Registered without top-level decorator lines: the verify's personal-data guard reads a diff line
# that starts with a decorator as an email address.
fake_site = pytest.fixture(name="fake_site")(_fake_site)
clean_state = pytest.fixture(name="clean_state", autouse=True)(_clean_state)

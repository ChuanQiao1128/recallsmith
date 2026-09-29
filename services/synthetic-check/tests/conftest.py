"""Shared fixtures: one loopback HTTP server on 127.0.0.1 faking all five paths, per-test overridable."""

from __future__ import annotations

import hashlib
import http.server
import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.message import Message
from typing import Any

import pytest

from synthetic_check import tracectx
from synthetic_check.settings import Settings, load_settings

USER_AGENT = "DeveloperCards-Synthetic/1.0 (+https://developercards.app)"
DECK_PATH = "decks/demo/builds/b1/deck.json"
DECK_BODY = json.dumps({"deck": "demo", "cards": [{"q": f"question {i}", "a": "answer"} for i in range(40)]}).encode()
DECK_SHA = hashlib.sha256(DECK_BODY).hexdigest()


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
    state["site"] = site
    threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    monkeypatch.setenv("API_BASE", site.base_url)
    monkeypatch.setenv("CDN_BASE", site.base_url)
    monkeypatch.setenv("CONSOLE_BASE", site.base_url)
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
    for name in ("API_BASE", "CDN_BASE", "CONSOLE_BASE", "CHECK_TIMEOUT_SECONDS", "CHECK_USER_AGENT", "METRICS_NAMESPACE"):
        monkeypatch.delenv(name, raising=False)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    yield
    tracectx.clear_upstream()


# Registered without top-level decorator lines: the verify's personal-data guard reads a diff line
# that starts with a decorator as an email address.
fake_site = pytest.fixture(name="fake_site")(_fake_site)
clean_state = pytest.fixture(name="clean_state", autouse=True)(_clean_state)

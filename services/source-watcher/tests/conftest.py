"""Shared fixtures: loopback HTTP servers on 127.0.0.1 and a clean per-test container state."""

from __future__ import annotations

import http.server
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.message import Message
from pathlib import Path
from typing import Any

import pytest

from source_watcher import settings

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@dataclass
class Captured:
    method: str
    path: str
    headers: Message  # case-insensitive
    body: bytes


@dataclass
class LocalServer:
    port: int
    requests: list[Captured] = field(default_factory=list)
    release: threading.Event = field(default_factory=threading.Event)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


# respond(server, captured, handler) -> (status, headers, body), or None when the responder wrote
# the response itself through `handler` (slow or broken answers).
Responder = Callable[[LocalServer, Captured, http.server.BaseHTTPRequestHandler], Any]


@pytest.fixture
def local_server() -> Iterator[Callable[[Responder], LocalServer]]:
    servers: list[tuple[http.server.ThreadingHTTPServer, LocalServer]] = []

    def start(respond: Responder) -> LocalServer:
        state: dict[str, LocalServer] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _handle(self, method: str) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(length) if length else b""
                captured = Captured(method, self.path, self.headers, raw)
                srv = state["srv"]
                srv.requests.append(captured)
                answer = respond(srv, captured, self)
                if answer is None:
                    self.close_connection = True
                    return
                status, headers, body = answer
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                self.close_connection = True

            def do_GET(self) -> None:
                self._handle("GET")

            def do_POST(self) -> None:
                self._handle("POST")

            def log_message(self, format: str, *args: Any) -> None:
                return

        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        httpd.daemon_threads = True
        srv = LocalServer(port=httpd.server_address[1])
        state["srv"] = srv
        threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        servers.append((httpd, srv))
        return srv

    yield start
    for httpd, srv in servers:
        srv.release.set()
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture(autouse=True)
def clean_container_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    settings.clear_secret_cache()
    settings.reset_clients()
    monkeypatch.setenv("LOG_LEVEL", "info")
    # urllib must never route the loopback fake core through a proxy.
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("no_proxy", "*")
    yield
    settings.clear_secret_cache()
    settings.reset_clients()

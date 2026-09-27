"""Shared fixtures: localhost HTTP servers and a clean per-test container state."""

from __future__ import annotations

import http.server
import threading
from collections.abc import Callable, Iterator
from email.message import Message
from dataclasses import dataclass, field
from typing import Any

import pytest

from webhook_dispatcher import settings


@dataclass
class Captured:
    method: str
    path: str
    headers: Message  # case-insensitive, like the API Gateway event headers
    body: bytes


@dataclass
class LocalServer:
    port: int
    requests: list[Captured] = field(default_factory=list)
    release: threading.Event = field(default_factory=threading.Event)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


# respond(server, captured) -> (status, headers, body)
Responder = Callable[[LocalServer, Captured], tuple[int, dict[str, str], bytes]]


@pytest.fixture
def local_server() -> Iterator[Callable[[Responder], LocalServer]]:
    servers: list[tuple[http.server.ThreadingHTTPServer, LocalServer]] = []

    def start(respond: Responder) -> LocalServer:
        state: dict[str, LocalServer] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length)
                captured = Captured("POST", self.path, self.headers, raw)
                srv = state["srv"]
                srv.requests.append(captured)
                status, headers, body = respond(srv, captured)
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

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
    yield
    settings.clear_secret_cache()
    settings.reset_clients()

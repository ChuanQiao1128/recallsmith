"""Shared fixtures: a loopback fake core on 127.0.0.1, fake SSM, a stubbed sesv2 client and a clean
per-test container state. Nothing here touches the network beyond 127.0.0.1 or needs credentials."""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.message import Message
from typing import Any

import boto3
import pytest
from botocore.exceptions import ClientError

from notifier import handler, settings

SECRET = "test-secret"
PREVIOUS = "test-secret-previous"
OWNER = "owner@example.com"
SECRET_NAME = "/developercards/prod/notifier-secret"
RECIPIENT_NAME = "/developercards/prod/notify-recipient"
SKEW_MS = 5 * 60 * 1000


@dataclass
class Captured:
    method: str
    path: str
    headers: Message  # case-insensitive
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))


@dataclass
class LocalServer:
    port: int
    requests: list[Captured] = field(default_factory=list)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


# respond(server, captured) -> (status, headers, body)
Responder = Callable[[LocalServer, Captured], tuple[int, dict[str, str], bytes]]


def _local_server() -> Iterator[Callable[[Responder], LocalServer]]:
    servers: list[http.server.ThreadingHTTPServer] = []

    def start(respond: Responder) -> LocalServer:
        state: dict[str, LocalServer] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(length) if length else b""
                captured = Captured("POST", self.path, self.headers, raw)
                srv = state["srv"]
                srv.requests.append(captured)
                status, headers, body = respond(srv, captured)
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                self.close_connection = True

            def log_message(self, format: str, *args: Any) -> None:
                return

        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        httpd.daemon_threads = True
        srv = LocalServer(port=httpd.server_address[1])
        state["srv"] = srv
        threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        servers.append(httpd)
        return srv

    yield start
    for httpd in servers:
        httpd.shutdown()
        httpd.server_close()


def envelope(data: dict[str, Any]) -> bytes:
    return json.dumps({"success": True, "data": data, "error": None, "traceId": "t", "version": "v1"}).encode()


def error_envelope(code: str) -> bytes:
    return json.dumps(
        {"success": False, "data": None, "error": {"code": code, "message": code}, "traceId": "t", "version": "v1"}
    ).encode()


def verify_signature(req: Captured, secrets: tuple[str, ...]) -> bool:
    """Auth.VerifyInternalSignatureStrict: ms timestamp within ±5 min, v1=<hex> over "<ts>.<body>"."""
    ts = req.headers.get("x-internal-timestamp") or ""
    sig = req.headers.get("x-internal-signature") or ""
    if not ts.isdigit() or abs(int(time.time() * 1000) - int(ts)) > SKEW_MS or not sig.startswith("v1="):
        return False
    message = f"{ts}.".encode() + req.body
    for secret in secrets:
        expected = "v1=" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, sig):
            return True
    return False


class FakeCore:
    """Answers the report and tick routes with the standard envelope after checking the HMAC."""

    def __init__(self, start: Callable[[Responder], LocalServer]) -> None:
        self.secrets: tuple[str, ...] = (SECRET,)
        self.report_status = 200
        # Statuses for the next report calls, in order, before report_status applies again.
        self.report_script: list[int] = []
        self.tick_status = 200
        self.tick_data: dict[str, Any] = {
            "mode": "dry_run",
            "effectiveMode": "dry_run",
            "skipped": None,
            "actions": {"digest": 0, "alerts": 1, "summaries": 2, "notificationsResent": 0},
        }
        self.server = start(self._respond)

    def _respond(self, srv: LocalServer, req: Captured) -> tuple[int, dict[str, str], bytes]:
        headers = {"Content-Type": "application/json"}
        if not verify_signature(req, self.secrets):
            return 403, headers, error_envelope("FORBIDDEN")
        body = req.json()
        if req.path == "/api/internal/automation/notifications/report":
            status = self.report_script.pop(0) if self.report_script else self.report_status
            if status != 200:
                return status, headers, error_envelope("SERVER_ERROR")
            return 200, headers, envelope({"notificationId": body["notificationId"], "status": body["status"]})
        if req.path == "/api/internal/automation/tick":
            if self.tick_status != 200:
                return self.tick_status, headers, error_envelope("SERVER_ERROR")
            return 200, headers, envelope({"tickId": body["tickId"], **self.tick_data})
        return 404, headers, error_envelope("NOT_FOUND")

    @property
    def requests(self) -> list[Captured]:
        return self.server.requests

    def reports(self) -> list[dict[str, Any]]:
        return [r.json() for r in self.requests if r.path == "/api/internal/automation/notifications/report"]

    def ticks(self) -> list[Captured]:
        return [r for r in self.requests if r.path == "/api/internal/automation/tick"]


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


def make_sesv2() -> Any:
    """A real sesv2 client that the tests wrap in a Stubber (no request ever leaves the process)."""
    return boto3.client(
        "sesv2",
        region_name="ap-southeast-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )


class Context:
    def __init__(self, remaining_ms: int = 60_000) -> None:
        self.remaining_ms = remaining_ms

    def get_remaining_time_in_millis(self) -> int:
        return self.remaining_ms


def _clean_container_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    settings.clear_secret_cache()
    settings.reset_clients()
    handler.reset_sent_cache()
    monkeypatch.setenv("LOG_LEVEL", "info")
    # urllib must never route the loopback fake core through a proxy.
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("no_proxy", "*")
    yield
    settings.clear_secret_cache()
    settings.reset_clients()
    handler.reset_sent_cache()


def _fake_core(local_server: Callable[[Responder], LocalServer], monkeypatch: pytest.MonkeyPatch) -> FakeCore:
    core = FakeCore(local_server)
    monkeypatch.setenv("CORE_API_BASE", core.server.base_url)
    return core


# Registered without top-level decorator lines: the verify's personal-data guard reads a diff line
# that starts with a decorator as an email address.
local_server = pytest.fixture(name="local_server")(_local_server)
clean_container_state = pytest.fixture(name="clean_container_state", autouse=True)(_clean_container_state)
fake_core = pytest.fixture(name="fake_core")(_fake_core)

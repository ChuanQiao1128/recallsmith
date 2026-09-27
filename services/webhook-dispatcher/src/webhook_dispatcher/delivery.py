"""One HTTP delivery attempt and its classification (contract §6.5.2 steps 3-4)."""

from __future__ import annotations

import http.client
import socket
import ssl
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

RETRY_DELAYS_SECONDS = (30, 120, 480, 900)
MAX_ATTEMPTS = 5

MAX_RESPONSE_BYTES = 64 * 1024


@dataclass(frozen=True)
class HttpResult:
    status: int | None
    error: str | None
    timed_out: bool
    duration_ms: int


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connects to the vetted address; Host, SNI and certificate checks use the URL's host."""

    def __init__(self, host: str, port: int, *, connect_address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._connect_address = connect_address

    def connect(self) -> None:
        sock = socket.create_connection((self._connect_address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Plain-HTTP twin for localhost tests; production never gets here (the guard requires https)."""

    def __init__(self, host: str, port: int, *, connect_address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout)
        self._connect_address = connect_address

    def connect(self) -> None:
        self.sock = socket.create_connection((self._connect_address, self.port), self.timeout)


def _abort(conn: http.client.HTTPConnection, fired: threading.Event) -> None:
    """Deadline watchdog: shut the socket down so a blocked send or recv returns at once."""
    fired.set()
    sock = conn.sock
    if sock is None:
        return
    try:
        # The plain socket method: SSLSocket.shutdown would also drop the TLS object under the reader.
        socket.socket.shutdown(sock, socket.SHUT_RDWR)
    except OSError:
        pass


def post_json(
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout: float,
    *,
    connect_address: str,
) -> HttpResult:
    """POST body once. Redirects are never followed; the response body is read (≤64 KiB) and dropped.

    `timeout` bounds the whole attempt (connect, send, status line, headers and body), not only each
    socket operation: a receiver that trickles bytes is cut off at the deadline and the attempt is a
    retryable timeout.
    """
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = parts.hostname or ""
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query
    conn: http.client.HTTPConnection
    try:
        if scheme == "https":
            conn = _PinnedHTTPSConnection(
                host, parts.port or 443, connect_address=connect_address, timeout=timeout
            )
        elif scheme == "http":
            conn = _PinnedHTTPConnection(
                host, parts.port or 80, connect_address=connect_address, timeout=timeout
            )
        else:
            return HttpResult(None, "unsupported scheme", False, 0)
    except ValueError as exc:
        return HttpResult(None, f"connection error: {type(exc).__name__}", False, 0)

    fired = threading.Event()
    watchdog = threading.Timer(timeout, _abort, args=(conn, fired))
    watchdog.daemon = True
    watchdog.start()
    try:
        conn.connect()
        if fired.is_set():  # the deadline passed while connecting, before there was a socket to shut
            return HttpResult(None, "timeout", True, elapsed())
        conn.request("POST", target, body=body, headers=headers)
        response = conn.getresponse()
        status = response.status
        if fired.is_set():
            return HttpResult(None, "timeout", True, elapsed())
        try:
            response.read(MAX_RESPONSE_BYTES)
        except (TimeoutError, OSError, http.client.HTTPException):
            pass  # the status is what counts; an unread or broken body does not change it
        return HttpResult(status, None, False, elapsed())
    except TimeoutError:
        return HttpResult(None, "timeout", True, elapsed())
    except (OSError, http.client.HTTPException) as exc:
        if fired.is_set():
            return HttpResult(None, "timeout", True, elapsed())
        return HttpResult(None, f"connection error: {type(exc).__name__}", False, elapsed())
    finally:
        watchdog.cancel()
        conn.close()


def classify(result: HttpResult) -> str:
    """"delivered" | "retryable" | "permanent"."""
    status = result.status
    if status is None:
        return "retryable"  # timeout or connection error
    if 200 <= status < 300:
        return "delivered"
    if status in (408, 429) or 500 <= status < 600:
        return "retryable"
    return "permanent"

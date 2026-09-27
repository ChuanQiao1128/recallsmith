"""One guarded, polite GET per hop, with redirects re-guarded (contract A00 §10.3 steps 4-6).

Every hop is vetted by the SSRF guard and the connection goes to the vetted address (Host, SNI and
the certificate check use the URL's host), so DNS rebinding between the check and the connect cannot
point the request somewhere else. Each hop has one whole-hop deadline, so a server that trickles
bytes is cut off.
"""

from __future__ import annotations

import http.client
import socket
import ssl
import threading
import time
import zlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

from .urlguard import URL_REJECTED, GuardResult, check_url

# The closed error list of the report (A00 §10.5).
TIMEOUT = "TIMEOUT"
DNS = "DNS"
TLS = "TLS"
TOO_LARGE = "TOO_LARGE"
HTTP_4XX = "HTTP_4XX"
HTTP_5XX = "HTTP_5XX"
REDIRECT_LIMIT = "REDIRECT_LIMIT"
PARSE = "PARSE"
ERROR_CODES = (TIMEOUT, DNS, TLS, URL_REJECTED, TOO_LARGE, HTTP_4XX, HTTP_5XX, REDIRECT_LIMIT, PARSE)

OK = "ok"
NOT_MODIFIED = "not_modified"
GONE = "gone"
UNSUPPORTED = "unsupported"
FAILED = "failed"

MAX_REDIRECTS = 3
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
GONE_STATUSES = frozenset({404, 410})
SUPPORTED_MEDIA_TYPES = frozenset(
    {
        "text/html",
        "application/xhtml+xml",
        "text/plain",
        "application/rss+xml",
        "application/atom+xml",
        "application/xml",
        "text/xml",
    }
)
READ_CHUNK = 64 * 1024

# Characters left as they are when a path or query is percent-encoded for the request line.
_SAFE_PATH = "/%:@!$&'()*+,;=-._~"
_SAFE_QUERY = _SAFE_PATH + "?"

Guard = Callable[[str], GuardResult]


@dataclass(frozen=True)
class FetchResult:
    outcome: str  # ok | not_modified | gone | unsupported | failed
    http_status: int | None = None
    body: bytes | None = None  # decoded content, ok only
    media_type: str | None = None
    charset: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    error_code: str | None = None
    latency_ms: int = 0
    bytes: int = 0
    # True once a connection was attempted (the latency metric is emitted only then).
    requested: bool = False


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connects to the vetted address; Host, SNI and certificate checks use the URL's host."""

    def __init__(self, host: str, port: int, *, connect_address: str, timeout: float) -> None:
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._connect_address = connect_address

    def connect(self) -> None:
        sock = socket.create_connection((self._connect_address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Plain-HTTP twin for loopback tests; production never gets here (the guard requires https)."""

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


def parse_content_type(value: str | None) -> tuple[str | None, str | None]:
    """(media type lowercased without parameters, charset parameter) of a Content-Type header."""
    if not value or not value.strip():
        return None, None
    pieces = value.split(";")
    media_type = pieces[0].strip().lower() or None
    charset = None
    for piece in pieces[1:]:
        name, sep, raw = piece.partition("=")
        if sep and name.strip().lower() == "charset":
            charset = raw.strip().strip("\"'").strip() or None
    return media_type, charset


def _request_target(url: str) -> str:
    parts = urlsplit(url)
    target = quote(parts.path or "/", safe=_SAFE_PATH)
    if parts.query:
        target += "?" + quote(parts.query, safe=_SAFE_QUERY)
    return target


@dataclass(frozen=True)
class _Hop:
    status: int | None
    headers: Mapping[str, str]
    body: bytes | None
    error_code: str | None


class _BodyError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _read_body(response: http.client.HTTPResponse, max_bytes: int, gzip: bool) -> bytes:
    """At most max_bytes raw and decoded; gzip decoded incrementally (zip-bomb safe)."""
    raw_total = 0
    out = bytearray()
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS) if gzip else None
    try:
        while True:
            chunk = response.read(min(READ_CHUNK, max_bytes + 1 - raw_total))
            if not chunk:
                break
            raw_total += len(chunk)
            if raw_total > max_bytes:
                raise _BodyError(TOO_LARGE)
            if decoder is None:
                out += chunk
                continue
            # max_length keeps one decompress call from inflating past the cap (never 0: unlimited).
            out += decoder.decompress(chunk, max_bytes + 1 - len(out))
            if len(out) > max_bytes:
                raise _BodyError(TOO_LARGE)
        if decoder is not None:
            if decoder.unconsumed_tail:
                raise _BodyError(TOO_LARGE)
            out += decoder.flush()
            if len(out) > max_bytes:
                raise _BodyError(TOO_LARGE)
            if not decoder.eof:
                raise _BodyError(PARSE)  # truncated gzip stream
    except zlib.error:
        raise _BodyError(PARSE) from None
    return bytes(out)


def _wants_body(status: int, headers: Mapping[str, str], any_media_type: bool) -> bool:
    if not 200 <= status < 300:
        return False
    if any_media_type:
        return True
    media_type, _ = parse_content_type(headers.get("content-type"))
    return media_type in SUPPORTED_MEDIA_TYPES


def _hop(
    url: str,
    address: str,
    headers: dict[str, str],
    timeout: float,
    max_bytes: int,
    any_media_type: bool,
) -> _Hop:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = parts.hostname or ""
    conn: http.client.HTTPConnection
    try:
        if scheme == "https":
            conn = _PinnedHTTPSConnection(host, parts.port or 443, connect_address=address, timeout=timeout)
        elif scheme == "http":
            conn = _PinnedHTTPConnection(host, parts.port or 80, connect_address=address, timeout=timeout)
        else:
            return _Hop(None, {}, None, URL_REJECTED)
    except ValueError:
        return _Hop(None, {}, None, URL_REJECTED)

    fired = threading.Event()
    watchdog = threading.Timer(timeout, _abort, args=(conn, fired))
    watchdog.daemon = True
    watchdog.start()
    status: int | None = None
    try:
        conn.connect()
        if fired.is_set():  # the deadline passed while connecting, before there was a socket to shut
            return _Hop(None, {}, None, TIMEOUT)
        conn.request("GET", _request_target(url), headers=headers)
        response = conn.getresponse()
        status = response.status
        response_headers = {key.lower(): value for key, value in reversed(response.getheaders())}
        if fired.is_set():
            return _Hop(None, {}, None, TIMEOUT)
        body = None
        if _wants_body(status, response_headers, any_media_type):
            encoding = response_headers.get("content-encoding", "").strip().lower()
            if encoding not in ("", "identity", "gzip", "x-gzip"):
                return _Hop(status, response_headers, None, PARSE)
            body = _read_body(response, max_bytes, gzip=encoding in ("gzip", "x-gzip"))
            if fired.is_set():
                return _Hop(None, {}, None, TIMEOUT)
        return _Hop(status, response_headers, body, None)
    except _BodyError as exc:
        return _Hop(status, {}, None, TIMEOUT if fired.is_set() else exc.code)
    except http.client.InvalidURL:
        return _Hop(None, {}, None, URL_REJECTED)
    except TimeoutError:
        return _Hop(None, {}, None, TIMEOUT)
    except ssl.SSLError:
        return _Hop(None, {}, None, TIMEOUT if fired.is_set() else TLS)
    except (OSError, http.client.HTTPException, ValueError):
        # Refused, reset, closed early, a broken status line or body: no usable HTTP answer.
        return _Hop(None, {}, None, TIMEOUT)
    finally:
        watchdog.cancel()
        conn.close()


def fetch(
    url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    timeout: float,
    max_bytes: int,
    user_agent: str,
    guard: Guard = check_url,
    extra_headers: Mapping[str, str] | None = None,
    any_media_type: bool = False,
) -> FetchResult:
    """GET url, following at most 3 redirects, each re-guarded. Never raises.

    The conditional headers go on the first hop only. `any_media_type` (robots.txt only) reads a
    2xx body whatever its media type.
    """
    started = time.monotonic()
    requested = False

    def done(outcome: str, **fields: Any) -> FetchResult:
        return FetchResult(
            outcome,
            latency_ms=int((time.monotonic() - started) * 1000),
            requested=requested,
            **fields,
        )

    current = url
    redirects = 0
    last_status: int | None = None
    while True:
        try:
            verdict = guard(current)
        except Exception:
            verdict = GuardResult("rejected", "guard error")
        if verdict.status == "rejected" or (verdict.status == "ok" and not verdict.addresses):
            return done(FAILED, http_status=last_status, error_code=URL_REJECTED)
        if verdict.status != "ok":
            return done(FAILED, http_status=last_status, error_code=DNS)

        headers = {"User-Agent": user_agent, "Accept-Encoding": "gzip"}
        if redirects == 0:
            if etag:
                headers["If-None-Match"] = etag
            if last_modified:
                headers["If-Modified-Since"] = last_modified
        for key, value in (extra_headers or {}).items():
            headers[key] = value

        requested = True
        hop = _hop(current, verdict.addresses[0], headers, timeout, max_bytes, any_media_type)
        if hop.error_code is not None:
            return done(FAILED, http_status=hop.status, error_code=hop.error_code)
        status = hop.status
        assert status is not None
        last_status = status

        if status in REDIRECT_STATUSES:
            location = (hop.headers.get("location") or "").strip()
            if not location or redirects >= MAX_REDIRECTS:
                return done(FAILED, http_status=status, error_code=REDIRECT_LIMIT)
            try:
                current = urljoin(current, location)
            except ValueError:
                return done(FAILED, http_status=status, error_code=REDIRECT_LIMIT)
            redirects += 1
            continue

        validators = {"etag": hop.headers.get("etag"), "last_modified": hop.headers.get("last-modified")}
        if status == 304:
            return done(NOT_MODIFIED, http_status=status, **validators)
        if status in GONE_STATUSES:
            return done(GONE, http_status=status, **validators)
        if 400 <= status < 500:
            return done(FAILED, http_status=status, error_code=HTTP_4XX, **validators)
        if 500 <= status < 600:
            return done(FAILED, http_status=status, error_code=HTTP_5XX, **validators)
        if 300 <= status < 400:
            # 300, 305, 306 and unknown 3xx: a redirect this watcher does not follow.
            return done(FAILED, http_status=status, error_code=REDIRECT_LIMIT, **validators)
        media_type, charset = parse_content_type(hop.headers.get("content-type"))
        if 200 <= status < 300 and hop.body is not None:
            return done(
                OK,
                http_status=status,
                body=hop.body,
                media_type=media_type,
                charset=charset,
                bytes=len(hop.body),
                **validators,
            )
        # A 2xx with any other media type (PDF included) or none; an unexpected 1xx lands here too.
        return done(UNSUPPORTED, http_status=status, media_type=media_type, **validators)

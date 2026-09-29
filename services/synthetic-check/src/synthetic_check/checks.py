"""The five synthetic checks (H00 §5.2), run sequentially, one GET each, never raising.

The whole run is bounded by RUN_DEADLINE_S of wall time, well under the 60 s Lambda timeout, so the
EMF line is always written. Each check runs in a daemon worker thread that the caller joins with the
remaining budget: that bounds what a socket timeout cannot (name resolution, a slow-drip body read
over many recv calls). A check still running at the deadline, and every check not yet started, is
TIMEOUT. An abandoned worker holds only its own sockets (each with the per-request timeout) and is
frozen with the sandbox when the invocation returns.

Every request: GET, no proxy, no redirect followed (a 3xx is HTTP_STATUS), per-request timeout
`settings.timeout_s`, no retry, only `User-Agent` and `Accept` set (never a credential), at most
`cap + 1` bytes read. A result carries a bounded failure code, never a URL, body or header value.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .settings import Settings

CHECK_NAMES = ("api-health", "cdn-manifest", "cdn-deck", "console-index", "api-auth-guard")

HTTP_STATUS = "HTTP_STATUS"
TIMEOUT = "TIMEOUT"
NETWORK = "NETWORK"
BAD_BODY = "BAD_BODY"
HASH_MISMATCH = "HASH_MISMATCH"
TOO_LARGE = "TOO_LARGE"
NO_PUBLIC_DECK = "NO_PUBLIC_DECK"
CONFIG = "CONFIG"
ERROR = "ERROR"
CODES = (HTTP_STATUS, TIMEOUT, NETWORK, BAD_BODY, HASH_MISMATCH, TOO_LARGE, NO_PUBLIC_DECK, CONFIG, ERROR)

# Wall-time budget of one run_checks call; the Lambda timeout is 60 s (infra synthetic.tf).
RUN_DEADLINE_S = 40.0

MIB = 1024 * 1024
BODY_CAP = 1 * MIB
DECK_CAP = 5 * MIB

HEALTH_PATH = "/health"
MANIFEST_PATH = "/content/manifest.json"
ME_PATH = "/api/v1/me"

_SHA256_HEX = re.compile(r"[0-9a-f]{64}")
_PATH_SAFE = "/%-._~!$&'()*+,;=:@"


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    status: int | None
    ms: int
    code: str | None


@dataclass(frozen=True)
class Response:
    status: int
    content_type: str
    body: bytes


class CheckFailed(Exception):
    """One check's failure: a bounded code and the HTTP status when one was received."""

    def __init__(self, code: str, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def _opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    opener.addheaders = []
    return opener


def _is_timeout(err: BaseException) -> bool:
    if isinstance(err, (TimeoutError, socket.timeout)):
        return True
    return isinstance(err, urllib.error.URLError) and isinstance(err.reason, (TimeoutError, socket.timeout))


def _read(resp: Any, cap: int, status: int | None) -> bytes:
    try:
        body = resp.read(cap + 1)
    except (TimeoutError, socket.timeout) as err:
        raise CheckFailed(TIMEOUT, status) from err
    except (OSError, http.client.HTTPException) as err:
        raise CheckFailed(NETWORK, status) from err
    if len(body) > cap:
        raise CheckFailed(TOO_LARGE, status)
    return body


def http_get(settings: Settings, url: str, *, accept: str, cap: int) -> Response:
    """One GET. A non-2xx answer is returned (its body unread); transport failures raise CheckFailed."""
    request = urllib.request.Request(
        url, method="GET", headers={"User-Agent": settings.user_agent, "Accept": accept}
    )
    try:
        resp = _opener().open(request, timeout=settings.timeout_s)
    except urllib.error.HTTPError as err:
        status = int(err.code)
        try:
            err.close()
        except Exception:
            pass
        return Response(status, "", b"")
    except (urllib.error.URLError, OSError, http.client.HTTPException) as err:
        raise CheckFailed(TIMEOUT if _is_timeout(err) else NETWORK) from err
    with resp:
        status = int(resp.status)
        content_type = resp.headers.get("Content-Type", "") or ""
        body = _read(resp, cap, status)
    return Response(status, content_type, body)


def _expect_200(resp: Response) -> None:
    if resp.status != 200:
        raise CheckFailed(HTTP_STATUS, resp.status)


def _json(resp: Response) -> Any:
    try:
        return json.loads(resp.body)
    except (ValueError, RecursionError) as err:
        raise CheckFailed(BAD_BODY, resp.status) from err


def check_api_health(settings: Settings, state: dict[str, Any]) -> int:
    resp = http_get(settings, settings.api_base + HEALTH_PATH, accept="application/json", cap=BODY_CAP)
    _expect_200(resp)
    doc = _json(resp)
    data = doc.get("data") if isinstance(doc, dict) else None
    if not (isinstance(doc, dict) and doc.get("success") is True and isinstance(data, dict) and data.get("ok") is True):
        raise CheckFailed(BAD_BODY, resp.status)
    return resp.status


def check_cdn_manifest(settings: Settings, state: dict[str, Any]) -> int:
    resp = http_get(settings, settings.cdn_base + MANIFEST_PATH, accept="application/json", cap=BODY_CAP)
    _expect_200(resp)
    doc = _json(resp)
    if not isinstance(doc, dict):
        raise CheckFailed(BAD_BODY, resp.status)
    version = doc.get("schemaVersion")
    decks = doc.get("decks")
    if not isinstance(version, int) or isinstance(version, bool) or not isinstance(decks, list) or not decks:
        raise CheckFailed(BAD_BODY, resp.status)
    state["manifest"] = doc
    return resp.status


def _relative_path(value: object) -> str | None:
    if not isinstance(value, str) or not value or value.startswith("/"):
        return None
    if "://" in value or "?" in value or "#" in value or "\\" in value:
        return None
    if any(c.isspace() or ord(c) < 0x20 for c in value):
        return None
    if any(segment == ".." for segment in value.split("/")):
        return None
    return value


def _public_deck(manifest: dict[str, Any]) -> tuple[str, str] | None:
    """(`<prefix>/<path>`, sha256) of the first public live deck, or None."""
    prefix = manifest.get("prefix")
    if not isinstance(prefix, str):
        return None
    prefix = _relative_path(prefix.strip("/"))
    if prefix is None:
        return None
    for deck in manifest.get("decks") or []:
        if not isinstance(deck, dict):
            continue
        if deck.get("downloadMode") != "public" or deck.get("availability") != "live":
            continue
        path = _relative_path(deck.get("path"))
        sha = deck.get("sha256")
        if path is None or not isinstance(sha, str) or not _SHA256_HEX.fullmatch(sha):
            continue
        return f"{prefix}/{path}", sha
    return None


def check_cdn_deck(settings: Settings, state: dict[str, Any]) -> int:
    manifest = state.get("manifest")
    target = _public_deck(manifest) if isinstance(manifest, dict) else None
    if target is None:
        raise CheckFailed(NO_PUBLIC_DECK)
    rel, sha = target
    url = settings.cdn_base + "/" + urllib.parse.quote(rel, safe=_PATH_SAFE)
    resp = http_get(settings, url, accept="application/json", cap=DECK_CAP)
    _expect_200(resp)
    if hashlib.sha256(resp.body).hexdigest() != sha:
        raise CheckFailed(HASH_MISMATCH, resp.status)
    return resp.status


def check_console_index(settings: Settings, state: dict[str, Any]) -> int:
    resp = http_get(settings, settings.console_base + "/", accept="text/html", cap=BODY_CAP)
    _expect_200(resp)
    if not resp.content_type.strip().lower().startswith("text/html") or b"<html" not in resp.body.lower():
        raise CheckFailed(BAD_BODY, resp.status)
    return resp.status


def check_api_auth_guard(settings: Settings, state: dict[str, Any]) -> int:
    """Sent without a token: only a 401 proves the JWT guard is in front of the route."""
    resp = http_get(settings, settings.api_base + ME_PATH, accept="application/json", cap=BODY_CAP)
    if resp.status != 401:
        raise CheckFailed(HTTP_STATUS, resp.status)
    return resp.status


CheckFn = Callable[[Settings, dict[str, Any]], int]


def _check_fns() -> tuple[tuple[str, CheckFn], ...]:
    # Looked up at call time so a test can replace one check function.
    return (
        ("api-health", check_api_health),
        ("cdn-manifest", check_cdn_manifest),
        ("cdn-deck", check_cdn_deck),
        ("console-index", check_console_index),
        ("api-auth-guard", check_api_auth_guard),
    )


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))


def _call_bounded(fn: CheckFn, settings: Settings, state: dict[str, Any], budget_s: float) -> int:
    """fn(settings, state) in a daemon worker joined for at most budget_s; still running -> TIMEOUT."""
    outcome: dict[str, Any] = {}

    def work() -> None:
        try:
            outcome["status"] = fn(settings, state)
        except Exception as err:
            outcome["error"] = err

    worker = threading.Thread(target=work, name="synthetic-check", daemon=True)
    worker.start()
    worker.join(budget_s)
    if worker.is_alive():
        raise CheckFailed(TIMEOUT)
    if "error" in outcome:
        raise outcome["error"]
    return outcome["status"]


def run_checks(settings: Settings, deadline_s: float | None = None) -> list[CheckResult]:
    """The five checks in CHECK_NAMES order, sequentially, within deadline_s (default RUN_DEADLINE_S)
    of wall time; checks past the deadline are TIMEOUT without a request. Never raises."""
    if settings.config_error is not None:
        return [CheckResult(name, False, None, 0, CONFIG) for name in CHECK_NAMES]
    deadline = time.monotonic() + (RUN_DEADLINE_S if deadline_s is None else deadline_s)
    results: list[CheckResult] = []
    state: dict[str, Any] = {}
    for name, fn in _check_fns():
        started = time.monotonic()
        remaining = deadline - started
        if remaining <= 0:
            results.append(CheckResult(name, False, None, 0, TIMEOUT))
            continue
        try:
            status = _call_bounded(fn, settings, state, remaining)
            results.append(CheckResult(name, True, status, _elapsed_ms(started), None))
        except CheckFailed as failed:
            code = failed.code if failed.code in CODES else ERROR
            results.append(CheckResult(name, False, failed.status, _elapsed_ms(started), code))
        except Exception:
            results.append(CheckResult(name, False, None, _elapsed_ms(started), ERROR))
    return results

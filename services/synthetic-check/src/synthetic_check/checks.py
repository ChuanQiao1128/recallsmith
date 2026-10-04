"""The synthetic checks (H00 §5.2, R28 MONITOR), run sequentially, never raising.

The first five are H00's (one GET each). R28 MONITOR adds four that need no account and no new IAM:
`api-sync-guard` (the token-less sync route answers 401), `remote-config` (the app's remote-config
document: fetch and schema sanity) and `cognito-console` / `cognito-mobile` (each pool's OIDC discovery
document and JWKS, two GETs).

The whole run is bounded by RUN_DEADLINE_S of wall time, well under the 60 s Lambda timeout, so the
EMF line is always written. Each check runs in a daemon worker thread that the caller joins with the
remaining budget: that bounds what a socket timeout cannot (name resolution, a slow-drip body read
over many recv calls). A check still running at the deadline, and every check not yet started, is
TIMEOUT. An abandoned worker holds only its own sockets (each with the per-request timeout) and is
frozen with the sandbox when the invocation returns.

Every request: GET, no proxy, no redirect followed (a 3xx is HTTP_STATUS), per-request timeout
`settings.timeout_s`, no retry, only `User-Agent` and `Accept` set (never a credential), at most
`cap + 1` bytes read. A result carries a bounded failure code and, for the R28 checks, a bounded
`detail` (a rule id from this file, never a URL, body, header value or a key read from a response).
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

CHECK_NAMES = (
    "api-health",
    "cdn-manifest",
    "cdn-deck",
    "console-index",
    "api-auth-guard",
    "api-sync-guard",
    "remote-config",
    "cognito-console",
    "cognito-mobile",
)

# Checks whose failure is not an outage of ours, so they stay out of SyntheticCheckSuccess, the handler's `ok` /
# `failed` (the CD smoke) and the paging alarm developercards-<env>-synthetic-check-failing. remote-config is served
# by a third party (raw.githubusercontent.com) and the app keeps its last good copy when it cannot read it; a failure
# there must not hold that alarm in ALARM and hide a real API, CDN, console or Cognito outage behind it. It has its
# own metric (emf.ADVISORY_METRICS) and alarm (infra alarms_r28.tf synthetic_remote_config_failing).
ADVISORY_CHECKS = frozenset({"remote-config"})

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
# The remote-config document (432 bytes on 2026-10-04) and the Cognito documents (about 1 KiB each).
SMALL_DOC_CAP = 64 * 1024

HEALTH_PATH = "/health"
MANIFEST_PATH = "/content/manifest.json"
ME_PATH = "/api/v1/me"
# The app's sync read (mobile progressSync); ANY /api/v1/sync/{proxy+} behind the mobile JWT authorizer.
SYNC_PATH = "/api/v1/sync/progress"
OIDC_DISCOVERY_SUFFIX = "/.well-known/openid-configuration"
JWKS_SUFFIX = "/.well-known/jwks.json"

_SHA256_HEX = re.compile(r"[0-9a-f]{64}")
_PATH_SAFE = "/%-._~!$&'()*+,;=:@"


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    status: int | None
    ms: int
    code: str | None
    detail: str | None = None


@dataclass(frozen=True)
class Response:
    status: int
    content_type: str
    body: bytes


class CheckFailed(Exception):
    """One check's failure: a bounded code, the HTTP status when one was received and an optional rule id."""

    def __init__(self, code: str, status: int | None = None, detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail


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


def check_api_sync_guard(settings: Settings, state: dict[str, Any]) -> int:
    """The app's sync route without a token: a 401 shows the route is served and a JWT guard rejects the
    request (a 403 would be core-vpc answering an unguarded route, a 429 a throttle, a 5xx an outage)."""
    resp = http_get(settings, settings.api_base + SYNC_PATH, accept="application/json", cap=BODY_CAP)
    if resp.status != 401:
        raise CheckFailed(HTTP_STATUS, resp.status)
    return resp.status


# ── remote-config: the document mobile/App.tsx REMOTE_CONFIG_URL serves ─────────────────────────────
# What the app reads (mobile/src/config/remoteConfig.ts, featureFlags.ts applyRemoteFeatures). The app
# never crashes on a bad value: it silently falls back (to the last cached document, or to a flag's built-in
# default), so a broken document changes behaviour without any error. These rules catch exactly that.
# tests/test_remote_config_schema.py keeps REMOTE_FEATURES and REMOTE_IOS_KEYS equal to the app's readers.

REMOTE_IOS_KEYS = ("minSupportedVersion", "latestVersion", "updateUrl", "appStoreId", "message")
# The only place a gated user is sent (report G10): anything else is a mistake or a hijacked config.
APP_STORE_URL_PREFIX = "https://apps.apple.com/"
_VERSION = re.compile(r"[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}")
_DIGITS = re.compile(r"[0-9]{1,20}")


def _is_bool(value: object) -> bool:
    return isinstance(value, bool)


def _is_count(value: object) -> bool:
    """A non-negative integer as JSON has it (3 or 3.0; never a boolean)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return float(value).is_integer() and value >= 0


def _is_related_count(value: object) -> bool:
    return _is_count(value) and value <= 5  # type: ignore[operator]


# feature -> leaf -> rule: the app ignores a value of another type and uses its built-in default instead.
REMOTE_FEATURES: dict[str, dict[str, Callable[[object], bool]]] = {
    "mcq": {"enabled": _is_bool, "recallFirst": _is_bool, "maxPerRun": _is_count, "answerTelemetry": _is_bool},
    "paywall": {"hidden": _is_bool},
    "ceremony": {"seamOfLight": _is_bool, "forceFallback": _is_bool},
    "mistakeBook": {"enabled": _is_bool, "relatedCount": _is_related_count},
    "cardSource": {"enabled": _is_bool},
    "sentry": {"enabled": _is_bool},
    "cardReport": {"enabled": _is_bool, "anonymous": _is_bool},
    "fsrs": {"enabled": _is_bool},
    "anonFunnel": {"enabled": _is_bool},
}


# Every detail a result may carry: rule ids fixed in this file, so a log line can never echo a response.
DETAILS = frozenset(
    [
        "json",
        "ios",
        *(f"ios.{key}" for key in REMOTE_IOS_KEYS),
        "features",
        "features.unknown",
        *(f"features.{name}" for name in REMOTE_FEATURES),
        *(f"features.{name}.{leaf}" for name, leaves in REMOTE_FEATURES.items() for leaf in leaves),
        "discovery",
        "discovery.issuer",
        "discovery.jwks_uri",
        "jwks",
        "jwks.keys",
        "jwks.rs256",
    ]
)


def remote_config_problem(doc: object) -> str | None:
    """The first rule `doc` breaks, as a fixed rule id (never a value or a key from the document), else None."""
    if not isinstance(doc, dict):
        return "json"
    ios = doc.get("ios")
    if ios is not None:
        if not isinstance(ios, dict):
            return "ios"
        # The app calls .trim() on each of these: a value that is not a string throws inside the version gate.
        for key in REMOTE_IOS_KEYS:
            value = ios.get(key)
            if value is not None and not isinstance(value, str):
                return f"ios.{key}"
        # The version gate compares minSupportedVersion (remoteConfig.ts resolveIosUpdate, compareSemver).
        # latestVersion is only trimmed and returned, never used to gate or shown, so it needs only to be a string.
        floor = (ios.get("minSupportedVersion") or "").strip()
        if floor and not _VERSION.fullmatch(floor):
            return "ios.minSupportedVersion"
        update_url = (ios.get("updateUrl") or "").strip()
        if update_url and not update_url.startswith(APP_STORE_URL_PREFIX):
            return "ios.updateUrl"
        store_id = (ios.get("appStoreId") or "").strip()
        if store_id and not _DIGITS.fullmatch(store_id):
            return "ios.appStoreId"
    features = doc.get("features")
    if features is not None:
        if not isinstance(features, dict):
            return "features"
        for name, value in features.items():
            if value is None:
                continue
            rules = REMOTE_FEATURES.get(name)
            if rules is None:
                # A flag only a newer app reads: its value must still be an object, like every feature.
                if not isinstance(value, dict):
                    return "features.unknown"
                continue
            if not isinstance(value, dict):
                return f"features.{name}"
            for leaf, rule in rules.items():
                leaf_value = value.get(leaf)
                if leaf_value is not None and not rule(leaf_value):
                    return f"features.{name}.{leaf}"
    return None


def check_remote_config(settings: Settings, state: dict[str, Any]) -> int:
    resp = http_get(settings, settings.remote_config_url, accept="application/json", cap=SMALL_DOC_CAP)
    _expect_200(resp)
    try:
        doc = _json(resp)
    except CheckFailed as failed:
        raise CheckFailed(BAD_BODY, resp.status, "json") from failed
    problem = remote_config_problem(doc)
    if problem is not None:
        raise CheckFailed(BAD_BODY, resp.status, problem)
    return resp.status


# ── cognito-console / cognito-mobile: OIDC discovery and JWKS of each pool ──────────────────────────
# The API Gateway JWT authorizers and core-vpc's verifier read these keys; a pool that cannot serve them
# signs nobody in and verifies no token.


def _cognito_step(detail: str, fn: Callable[[], Response]) -> tuple[Response, Any]:
    """One GET of a Cognito document that must answer 200 with JSON; any failure carries `detail`."""
    try:
        resp = fn()
        _expect_200(resp)
        return resp, _json(resp)
    except CheckFailed as failed:
        raise CheckFailed(failed.code, failed.status, failed.detail or detail) from failed


def _check_cognito(settings: Settings, issuer: str) -> int:
    jwks_url = issuer + JWKS_SUFFIX
    discovery, doc = _cognito_step(
        "discovery", lambda: http_get(settings, issuer + OIDC_DISCOVERY_SUFFIX, accept="application/json", cap=SMALL_DOC_CAP)
    )
    if not isinstance(doc, dict) or doc.get("issuer") != issuer:
        raise CheckFailed(BAD_BODY, discovery.status, "discovery.issuer")
    if doc.get("jwks_uri") != jwks_url:
        raise CheckFailed(BAD_BODY, discovery.status, "discovery.jwks_uri")
    # The configured URL, never one read from the response.
    jwks, keys_doc = _cognito_step("jwks", lambda: http_get(settings, jwks_url, accept="application/json", cap=SMALL_DOC_CAP))
    keys = keys_doc.get("keys") if isinstance(keys_doc, dict) else None
    if not isinstance(keys, list) or not keys:
        raise CheckFailed(BAD_BODY, jwks.status, "jwks.keys")
    if not all(isinstance(k, dict) and isinstance(k.get("kid"), str) and k.get("kid") and isinstance(k.get("kty"), str) for k in keys):
        raise CheckFailed(BAD_BODY, jwks.status, "jwks.keys")
    # core-vpc accepts RS256 only (JwtVerifier RequiredAlgorithm); the authorizers verify the same keys.
    if not any(k.get("kty") == "RSA" and k.get("alg") == "RS256" and k.get("use") in (None, "sig") for k in keys):
        raise CheckFailed(BAD_BODY, jwks.status, "jwks.rs256")
    return jwks.status


def check_cognito_console(settings: Settings, state: dict[str, Any]) -> int:
    return _check_cognito(settings, settings.cognito_console_issuer)


def check_cognito_mobile(settings: Settings, state: dict[str, Any]) -> int:
    return _check_cognito(settings, settings.cognito_mobile_issuer)


CheckFn = Callable[[Settings, dict[str, Any]], int]


def _check_fns() -> tuple[tuple[str, CheckFn], ...]:
    # Looked up at call time so a test can replace one check function.
    return (
        ("api-health", check_api_health),
        ("cdn-manifest", check_cdn_manifest),
        ("cdn-deck", check_cdn_deck),
        ("console-index", check_console_index),
        ("api-auth-guard", check_api_auth_guard),
        ("api-sync-guard", check_api_sync_guard),
        ("remote-config", check_remote_config),
        ("cognito-console", check_cognito_console),
        ("cognito-mobile", check_cognito_mobile),
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
    """The checks in CHECK_NAMES order, sequentially, within deadline_s (default RUN_DEADLINE_S)
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
            detail = failed.detail if failed.detail in DETAILS else None
            results.append(CheckResult(name, False, failed.status, _elapsed_ms(started), code, detail))
        except Exception:
            results.append(CheckResult(name, False, None, _elapsed_ms(started), ERROR))
    return results

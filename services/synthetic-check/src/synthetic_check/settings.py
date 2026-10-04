"""Environment settings (H00 §5.2). Read at call time, never at import; never raises.

A bad value never aborts the run: it sets `config_error` to a short code-like reason (the value is
never echoed) and every check then fails with CONFIG.

R28 MONITOR: three more URLs, all public and unauthenticated: the remote-config document the app reads
at every cold start (mobile/App.tsx REMOTE_CONFIG_URL) and the two Cognito issuers (console pool, mobile
pool; the API's JWT authorizers and core-vpc's AUTH_ISSUERS default).
"""

from __future__ import annotations

import math
import os
import re
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULTS: dict[str, str] = {
    "API_BASE": "https://api.developercards.app",
    "CDN_BASE": "https://cdn.developercards.app",
    "CONSOLE_BASE": "https://console.developercards.app",
    "REMOTE_CONFIG_URL": "https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json",
    "COGNITO_CONSOLE_ISSUER": "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt",
    "COGNITO_MOBILE_ISSUER": "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb",
    "CHECK_TIMEOUT_SECONDS": "10",
    "CHECK_USER_AGENT": "DeveloperCards-Synthetic/1.0 (+https://developercards.app)",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}

MIN_TIMEOUT_S = 0.1
MAX_TIMEOUT_S = 10.0

_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*")
# One path segment of a document URL: unreserved characters only (no percent-escape, no `..`).
_SEGMENT = re.compile(r"[A-Za-z0-9._~-]{1,200}")
# A Cognito issuer's single path segment, the pool id (`<region>_<id>`).
_POOL_ID = re.compile(r"[A-Za-z0-9-]{1,40}_[A-Za-z0-9]{1,60}")


@dataclass(frozen=True)
class Settings:
    api_base: str
    cdn_base: str
    console_base: str
    timeout_s: float
    user_agent: str
    metrics_namespace: str
    config_error: str | None = None
    remote_config_url: str = ""
    cognito_console_issuer: str = ""
    cognito_mobile_issuer: str = ""


def _origin(parts: urllib.parse.SplitResult) -> str | None:
    """`https://<host>[:port]` or `http://127.0.0.1:<port>` of an already split URL, else None."""
    netloc = parts.netloc
    if not netloc or "@" in netloc:
        return None
    host, sep, port = netloc.rpartition(":") if ":" in netloc else (netloc, "", "")
    if sep and not (port.isdigit() and 0 < int(port) < 65536):
        return None
    if parts.scheme == "https":
        if not _HOST.fullmatch(host):
            return None
    elif parts.scheme == "http":
        if host != "127.0.0.1" or not sep:
            return None
    else:
        return None
    return f"{parts.scheme}://{netloc}"


def _split(value: str) -> urllib.parse.SplitResult | None:
    """Printable ASCII, no space, no query and no fragment, else None."""
    if not value or any(c.isspace() or ord(c) < 0x21 or ord(c) > 0x7E for c in value):
        return None
    parts = urllib.parse.urlsplit(value)
    if parts.query or parts.fragment or "?" in value or "#" in value:
        return None
    return parts


def valid_base(value: str) -> str | None:
    """`https://<host>[:port][/]` or `http://127.0.0.1:<port>[/]` -> the base without a trailing `/`."""
    try:
        parts = _split(value)
        if parts is None or parts.path not in ("", "/"):
            return None
        return _origin(parts)
    except Exception:
        return None


def valid_document_url(value: str) -> str | None:
    """A base (as valid_base) plus a non-empty path of unreserved segments (no `..`, no trailing `/`)."""
    try:
        parts = _split(value)
        if parts is None or not parts.path.startswith("/"):
            return None
        segments = parts.path[1:].split("/")
        if any(seg in ("", ".", "..") or not _SEGMENT.fullmatch(seg) for seg in segments):
            return None
        origin = _origin(parts)
        return None if origin is None else origin + parts.path
    except Exception:
        return None


def valid_issuer(value: str) -> str | None:
    """A base (as valid_base) plus exactly one path segment, the pool id; no trailing `/`."""
    try:
        parts = _split(value)
        if parts is None or not parts.path.startswith("/") or not _POOL_ID.fullmatch(parts.path[1:]):
            return None
        origin = _origin(parts)
        return None if origin is None else origin + parts.path
    except Exception:
        return None


def _timeout(value: str) -> float | None:
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(timeout) or not MIN_TIMEOUT_S <= timeout <= MAX_TIMEOUT_S:
        return None
    return timeout


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Never raises: any invalid value becomes `config_error`."""
    source: Mapping[str, str] = os.environ if env is None else env
    errors: list[str] = []

    def get(key: str) -> str:
        try:
            value = source.get(key)
        except Exception:
            value = None
        return DEFAULTS[key] if value is None else str(value)

    bases: dict[str, str] = {}
    for key in ("API_BASE", "CDN_BASE", "CONSOLE_BASE"):
        base = valid_base(get(key))
        if base is None:
            errors.append(f"invalid_{key.lower()}")
            base = ""
        bases[key] = base
    urls: dict[str, str] = {}
    for key, validator in (
        ("REMOTE_CONFIG_URL", valid_document_url),
        ("COGNITO_CONSOLE_ISSUER", valid_issuer),
        ("COGNITO_MOBILE_ISSUER", valid_issuer),
    ):
        url = validator(get(key))
        if url is None:
            errors.append(f"invalid_{key.lower()}")
            url = ""
        urls[key] = url
    timeout = _timeout(get("CHECK_TIMEOUT_SECONDS"))
    if timeout is None:
        errors.append("invalid_check_timeout_seconds")
        timeout = MAX_TIMEOUT_S
    user_agent = get("CHECK_USER_AGENT").strip()
    if not user_agent or any(c in user_agent for c in "\r\n"):
        errors.append("invalid_check_user_agent")
    namespace = get("METRICS_NAMESPACE").strip()
    if not namespace:
        errors.append("invalid_metrics_namespace")
        namespace = DEFAULTS["METRICS_NAMESPACE"]
    return Settings(
        api_base=bases["API_BASE"],
        cdn_base=bases["CDN_BASE"],
        console_base=bases["CONSOLE_BASE"],
        timeout_s=timeout,
        user_agent=user_agent,
        metrics_namespace=namespace,
        config_error=",".join(errors) or None,
        remote_config_url=urls["REMOTE_CONFIG_URL"],
        cognito_console_issuer=urls["COGNITO_CONSOLE_ISSUER"],
        cognito_mobile_issuer=urls["COGNITO_MOBILE_ISSUER"],
    )

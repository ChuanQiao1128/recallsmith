"""Environment settings (H00 §5.2). Read at call time, never at import; never raises.

A bad value never aborts the run: it sets `config_error` to a short code-like reason (the value is
never echoed) and every check then fails with CONFIG.
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
    "CHECK_TIMEOUT_SECONDS": "10",
    "CHECK_USER_AGENT": "DeveloperCards-Synthetic/1.0 (+https://developercards.app)",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}

MIN_TIMEOUT_S = 0.1
MAX_TIMEOUT_S = 10.0

_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*")


@dataclass(frozen=True)
class Settings:
    api_base: str
    cdn_base: str
    console_base: str
    timeout_s: float
    user_agent: str
    metrics_namespace: str
    config_error: str | None = None


def valid_base(value: str) -> str | None:
    """`https://<host>[:port][/]` or `http://127.0.0.1:<port>[/]` -> the base without a trailing `/`."""
    try:
        if not value or any(c.isspace() or ord(c) < 0x21 or ord(c) > 0x7E for c in value):
            return None
        parts = urllib.parse.urlsplit(value)
        if parts.query or parts.fragment or "?" in value or "#" in value:
            return None
        if parts.path not in ("", "/"):
            return None
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
    )

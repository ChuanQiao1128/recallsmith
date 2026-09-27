"""Runtime configuration (contract A00 §10.1), the SSM secret and the lazily created SSM client."""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .logs import log

TAG = "source-watcher"

# Value of an SSM parameter that exists but has not been set yet (created by Terraform, set by the supervisor).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

# How long a loaded secret is trusted before SSM is read again, so a rotation reaches every warm
# container within this window instead of only when the container recycles.
SECRET_TTL_SECONDS = 300.0

# The optional previous internal secret lives next to the current one: "<name>-previous".
PREVIOUS_SECRET_SUFFIX = "-previous"

# Exactly the values of env/prod.env.json.
DEFAULTS: dict[str, str] = {
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/source-watch-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "WATCH_MAX_TARGETS": "60",
    "WATCH_TIME_BUDGET_SECONDS": "240",
    "WATCH_HTTP_TIMEOUT_SECONDS": "10",
    "WATCH_MAX_BYTES": "5242880",
    "WATCH_HOST_INTERVAL_SECONDS": "1",
    "WATCH_USER_AGENT": "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}

MAX_TARGETS_RANGE = (1, 100)


@dataclass(frozen=True)
class Settings:
    internal_secret_ssm_name: str
    core_api_base: str
    watch_max_targets: int
    watch_time_budget_seconds: float
    watch_http_timeout_seconds: float
    watch_max_bytes: int
    watch_host_interval_seconds: float
    watch_user_agent: str
    metrics_namespace: str
    log_level: str


def _number(env: Mapping[str, str], key: str, kind: type, valid: Any) -> Any:
    """Parse one numeric key; an unparsable or out-of-range value falls back with one warn log."""
    default = kind(DEFAULTS[key])
    raw = env.get(key)
    if raw is None or not raw.strip():
        return default
    try:
        value = kind(raw.strip())
    except ValueError:
        value = None
    if value is None or value != value or not valid(value):  # value != value: NaN
        # The key name only; the value may be anything.
        log("warn", TAG, event="setting_invalid", key=key)
        return default
    return value


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    def get(key: str) -> str:
        value = env.get(key)
        return value.strip() if value and value.strip() else DEFAULTS[key]

    low, high = MAX_TARGETS_RANGE
    return Settings(
        internal_secret_ssm_name=get("INTERNAL_SECRET_SSM_NAME"),
        core_api_base=get("CORE_API_BASE"),
        watch_max_targets=_number(env, "WATCH_MAX_TARGETS", int, lambda v: low <= v <= high),
        watch_time_budget_seconds=_number(env, "WATCH_TIME_BUDGET_SECONDS", float, lambda v: 0 < v < 900),
        watch_http_timeout_seconds=_number(env, "WATCH_HTTP_TIMEOUT_SECONDS", float, lambda v: 0 < v <= 60),
        watch_max_bytes=_number(env, "WATCH_MAX_BYTES", int, lambda v: 0 < v <= 50 * 1024 * 1024),
        watch_host_interval_seconds=_number(env, "WATCH_HOST_INTERVAL_SECONDS", float, lambda v: 0 <= v <= 60),
        watch_user_agent=get("WATCH_USER_AGENT"),
        metrics_namespace=get("METRICS_NAMESPACE"),
        log_level=get("LOG_LEVEL").lower(),
    )


def is_unset_secret(value: Any) -> bool:
    """True for None, non-strings, blank values and the SSM placeholder."""
    return not isinstance(value, str) or not value.strip() or value.strip() == PLACEHOLDER_VALUE


# Per-container caches. A loaded secret is kept for SECRET_TTL_SECONDS. A missing or placeholder
# value is not cached, so it is looked up again on the next invocation.
_secret_cache: dict[str, tuple[str, float]] = {}
# Names of optional secrets found absent, with the time the absence expires (read again after that).
_absent_cache: dict[str, float] = {}
_clients: dict[str, Any] = {}

# Seam for tests; production uses the monotonic clock.
clock = time.monotonic


def _cached(name: str) -> str | None:
    entry = _secret_cache.get(name)
    if entry is None:
        return None
    value, expires = entry
    if clock() >= expires:
        del _secret_cache[name]
        return None
    return value


# The only read error that means "this parameter does not exist".
PARAMETER_NOT_FOUND = "ParameterNotFound"


def is_parameter_not_found(exc: BaseException) -> bool:
    """botocore's ClientError with that code, or the modeled ssm.exceptions.ParameterNotFound."""
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict) and error.get("Code") == PARAMETER_NOT_FOUND:
            return True
    return type(exc).__name__ == PARAMETER_NOT_FOUND


def load_secret(name: str, ssm_client: Any, *, optional: bool = False) -> str | None:
    """The decrypted value of one SSM parameter, or None when unset or unreadable.

    optional=True is for a parameter that normally does not exist (the previous internal secret):
    only ParameterNotFound (or an unset value) counts as absent; that is logged at debug level and
    remembered for the TTL. Any other read error (throttling, network, AccessDenied) is logged at
    warn level and never cached, so the next read tries SSM again.
    """
    cached = _cached(name)
    if cached is not None:
        return cached
    if optional and _absent_cache.get(name, 0.0) > clock():
        return None
    try:
        response = ssm_client.get_parameter(Name=name, WithDecryption=True)
        value = response["Parameter"]["Value"]
    except Exception as exc:
        absent = optional and is_parameter_not_found(exc)
        # The error class only: messages may echo request details.
        log(
            "debug" if absent else "warn",
            TAG,
            event="ssm_secret_unavailable",
            parameter=name,
            errorClass=type(exc).__name__,
        )
        if absent:
            _absent_cache[name] = clock() + SECRET_TTL_SECONDS
        return None
    if is_unset_secret(value):
        if optional:
            _absent_cache[name] = clock() + SECRET_TTL_SECONDS
        return None
    _secret_cache[name] = (value, clock() + SECRET_TTL_SECONDS)
    _absent_cache.pop(name, None)
    return value


def get_secret(name: str, *, optional: bool = False) -> str | None:
    """load_secret with the container's lazily created SSM client."""
    cached = _cached(name)
    if cached is not None:
        return cached
    try:
        client = ssm_client()
    except Exception as exc:
        log("warn", TAG, event="ssm_client_unavailable", errorClass=type(exc).__name__)
        return None
    return load_secret(name, client, optional=optional)


def previous_secret_name(name: str) -> str:
    return name + PREVIOUS_SECRET_SUFFIX


def clear_secret_cache() -> None:
    _secret_cache.clear()
    _absent_cache.clear()


def ssm_client() -> Any:
    if "ssm" not in _clients:
        import boto3  # from the Lambda runtime; never bundled (dev dependency only)

        _clients["ssm"] = boto3.client("ssm")
    return _clients["ssm"]


def set_clients(*, ssm: Any = None) -> None:
    """Inject clients (tests). A None argument leaves that client untouched."""
    if ssm is not None:
        _clients["ssm"] = ssm


def reset_clients() -> None:
    _clients.clear()

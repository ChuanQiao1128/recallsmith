"""Runtime configuration (contract A00 §12.3), the SSM parameters and the lazily created clients."""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .logs import log

TAG = "notifier"

# Value of an SSM parameter that exists but has not been set yet (created by Terraform, set by the supervisor).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

# How long a loaded value is trusted before SSM is read again, so a rotation reaches every warm
# container within this window instead of only when the container recycles.
SECRET_TTL_SECONDS = 300.0

# The optional previous internal secret lives next to the current one: "<name>-previous".
PREVIOUS_SECRET_SUFFIX = "-previous"

# The recipient must look like exactly one address (RFC 5321 path limit).
MAX_ADDRESS_LENGTH = 254

# Exactly the values of env/prod.env.json.
DEFAULTS: dict[str, str] = {
    "NOTIFY_FROM": "DeveloperCards Automation <automation@developercards.app>",
    "NOTIFY_RECIPIENT_SSM_NAME": "/developercards/prod/notify-recipient",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/notifier-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "SES_REGION": "ap-southeast-2",
    "SES_CONFIGURATION_SET": "developercards-automation",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


@dataclass(frozen=True)
class Settings:
    notify_from: str
    notify_recipient_ssm_name: str
    internal_secret_ssm_name: str
    core_api_base: str
    ses_region: str
    ses_configuration_set: str
    metrics_namespace: str
    log_level: str


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    def get(key: str) -> str:
        value = env.get(key)
        return value.strip() if value and value.strip() else DEFAULTS[key]

    return Settings(
        notify_from=get("NOTIFY_FROM"),
        notify_recipient_ssm_name=get("NOTIFY_RECIPIENT_SSM_NAME"),
        internal_secret_ssm_name=get("INTERNAL_SECRET_SSM_NAME"),
        core_api_base=get("CORE_API_BASE"),
        ses_region=get("SES_REGION"),
        ses_configuration_set=get("SES_CONFIGURATION_SET"),
        metrics_namespace=get("METRICS_NAMESPACE"),
        log_level=get("LOG_LEVEL").lower(),
    )


def is_unset_secret(value: Any) -> bool:
    """True for None, non-strings, blank values and the SSM placeholder."""
    return not isinstance(value, str) or not value.strip() or value.strip() == PLACEHOLDER_VALUE


# Per-container caches. A loaded value is kept for SECRET_TTL_SECONDS. A missing or placeholder
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
    warn level and never cached, so the next read tries SSM again. The value is never logged.
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


def looks_like_one_address(value: str) -> bool:
    """Exactly one "@" with text on both sides, no whitespace, at most 254 characters."""
    if len(value) > MAX_ADDRESS_LENGTH or value.count("@") != 1:
        return False
    if any(ch.isspace() for ch in value):
        return False
    local, domain = value.split("@")
    return bool(local) and bool(domain)


def get_recipient(name: str | None = None) -> str | None:
    """The owner alert address from SSM NOTIFY_RECIPIENT_SSM_NAME, or None.

    Missing, blank, the placeholder and anything that is not one address count as unset. The value
    is never logged (A00 §0.5).
    """
    parameter = name if name is not None else load_settings().notify_recipient_ssm_name
    value = get_secret(parameter)
    if value is None:
        return None
    value = value.strip()
    if not looks_like_one_address(value):
        # Not cached either, so a corrected value is picked up on the next message.
        _secret_cache.pop(parameter, None)
        log("warn", TAG, event="recipient_invalid", parameter=parameter)
        return None
    return value


def clear_secret_cache() -> None:
    _secret_cache.clear()
    _absent_cache.clear()


def ssm_client() -> Any:
    if "ssm" not in _clients:
        import boto3  # from the Lambda runtime; never bundled (dev dependency only)

        _clients["ssm"] = boto3.client("ssm")
    return _clients["ssm"]


def ses_client() -> Any:
    if "sesv2" not in _clients:
        import boto3  # from the Lambda runtime; never bundled (dev dependency only)

        _clients["sesv2"] = boto3.client("sesv2", region_name=load_settings().ses_region)
    return _clients["sesv2"]


def set_clients(*, ssm: Any = None, sesv2: Any = None) -> None:
    """Inject clients (tests). A None argument leaves that client untouched."""
    if ssm is not None:
        _clients["ssm"] = ssm
    if sesv2 is not None:
        _clients["sesv2"] = sesv2


def reset_clients() -> None:
    _clients.clear()

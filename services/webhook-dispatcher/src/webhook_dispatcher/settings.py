"""Runtime configuration, SSM secrets and lazily created AWS clients."""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .logs import log

# Value of an SSM parameter that exists but has not been set yet (infra/modules/identity/ssm.tf).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

# How long a loaded secret is trusted before SSM is read again, so a rotation reaches every warm
# container within this window instead of only when the container recycles.
SECRET_TTL_SECONDS = 300.0

# The optional previous signing secret lives next to the current one: "<name>-previous".
PREVIOUS_SECRET_SUFFIX = "-previous"

# Optional per-subscription signing secret: "<signing name>-sub-<subscriptionId>". When it exists it
# replaces the environment-wide secret for that subscription only (README, "Per-subscription secrets").
SUBSCRIPTION_SECRET_INFIX = "-sub-"

DEFAULTS: dict[str, str] = {
    "SIGNING_SECRET_SSM_NAME": "/developercards/prod/webhook-signing-secret",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/internal-shared-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "METRICS_NAMESPACE": "DeveloperCards",
    "WEBHOOK_HTTP_TIMEOUT_SECONDS": "10",
    "LOG_LEVEL": "info",
}

# Optional, off unless set (not part of the contract's env file): see Settings.presend_claim.
PRESEND_CLAIM_ENV = "WEBHOOK_PRESEND_CLAIM"
# Optional, off unless set: see Settings.subscription_secrets.
SUBSCRIPTION_SECRETS_ENV = "WEBHOOK_SUBSCRIPTION_SECRETS"
TRUTHY = ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    signing_secret_ssm_name: str
    internal_secret_ssm_name: str
    core_api_base: str
    metrics_namespace: str
    http_timeout_seconds: float
    log_level: str
    # Ask core-vpc before each POST whether (and where) to send. Off until core serves the route.
    presend_claim: bool = False
    # Look up "<signing name>-sub-<id>" first. Off until the role may read "-sub-*": with the
    # flag on, a denied read fails the attempt closed instead of falling back.
    subscription_secrets: bool = False


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    def get(key: str) -> str:
        value = env.get(key)
        return value if value else DEFAULTS[key]

    try:
        timeout = float(get("WEBHOOK_HTTP_TIMEOUT_SECONDS"))
    except ValueError:
        timeout = float(DEFAULTS["WEBHOOK_HTTP_TIMEOUT_SECONDS"])
    if timeout <= 0:
        timeout = float(DEFAULTS["WEBHOOK_HTTP_TIMEOUT_SECONDS"])
    return Settings(
        signing_secret_ssm_name=get("SIGNING_SECRET_SSM_NAME"),
        internal_secret_ssm_name=get("INTERNAL_SECRET_SSM_NAME"),
        core_api_base=get("CORE_API_BASE"),
        metrics_namespace=get("METRICS_NAMESPACE"),
        http_timeout_seconds=timeout,
        log_level=get("LOG_LEVEL").lower(),
        presend_claim=(env.get(PRESEND_CLAIM_ENV) or "").strip().lower() in TRUTHY,
        subscription_secrets=(env.get(SUBSCRIPTION_SECRETS_ENV) or "").strip().lower() in TRUTHY,
    )


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


class SecretUnreadable(Exception):
    """An optional secret could not be read (throttling, a network error, AccessDenied, ...).

    Unlike ParameterNotFound this says nothing about whether the secret exists, so the caller must
    not fall back to another secret as if it were absent.
    """


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

    optional=True is for a parameter that normally does not exist (the previous signing secret):
    only ParameterNotFound (or an unset value) counts as absent; that is logged at debug level and
    remembered for the TTL. Any other read error is logged, never cached, and raises
    SecretUnreadable.
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
        log("debug" if absent else "warn", "ssm_secret_unavailable", parameter=name, errorClass=type(exc).__name__)
        if absent:
            _absent_cache[name] = clock() + SECRET_TTL_SECONDS
        elif optional:
            raise SecretUnreadable(name) from None
        return None
    if not isinstance(value, str) or not value or value == PLACEHOLDER_VALUE:
        if optional:
            _absent_cache[name] = clock() + SECRET_TTL_SECONDS
        return None
    _secret_cache[name] = (value, clock() + SECRET_TTL_SECONDS)
    _absent_cache.pop(name, None)
    return value


def get_secret(name: str, *, optional: bool = False) -> str | None:
    """load_secret with the container's lazily created SSM client (optional: may raise SecretUnreadable)."""
    cached = _cached(name)
    if cached is not None:
        return cached
    try:
        client = ssm_client()
    except Exception as exc:
        log("warn", "ssm_client_unavailable", errorClass=type(exc).__name__)
        if optional:
            raise SecretUnreadable(name) from None
        return None
    return load_secret(name, client, optional=optional)


def previous_secret_name(signing_secret_ssm_name: str) -> str:
    return signing_secret_ssm_name + PREVIOUS_SECRET_SUFFIX


def subscription_secret_name(signing_secret_ssm_name: str, subscription_id: int) -> str:
    return f"{signing_secret_ssm_name}{SUBSCRIPTION_SECRET_INFIX}{subscription_id}"


def clear_secret_cache() -> None:
    _secret_cache.clear()
    _absent_cache.clear()


def _boto3_client(service: str) -> Any:
    import boto3  # provided by the Lambda runtime; dev-only dependency locally

    return boto3.client(service)


def ssm_client() -> Any:
    if "ssm" not in _clients:
        _clients["ssm"] = _boto3_client("ssm")
    return _clients["ssm"]


def sqs_client() -> Any:
    if "sqs" not in _clients:
        _clients["sqs"] = _boto3_client("sqs")
    return _clients["sqs"]


def set_clients(*, ssm: Any = None, sqs: Any = None) -> None:
    """Inject clients (tests). A None argument leaves that client untouched."""
    if ssm is not None:
        _clients["ssm"] = ssm
    if sqs is not None:
        _clients["sqs"] = sqs


def reset_clients() -> None:
    _clients.clear()

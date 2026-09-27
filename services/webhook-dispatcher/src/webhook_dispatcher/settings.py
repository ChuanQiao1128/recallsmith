"""Runtime configuration, SSM secrets and lazily created AWS clients."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .logs import log

# Value of an SSM parameter that exists but has not been set yet (infra/modules/identity/ssm.tf).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

DEFAULTS: dict[str, str] = {
    "SIGNING_SECRET_SSM_NAME": "/developercards/prod/webhook-signing-secret",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/internal-shared-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "METRICS_NAMESPACE": "DeveloperCards",
    "WEBHOOK_HTTP_TIMEOUT_SECONDS": "10",
    "LOG_LEVEL": "info",
}


@dataclass(frozen=True)
class Settings:
    signing_secret_ssm_name: str
    internal_secret_ssm_name: str
    core_api_base: str
    metrics_namespace: str
    http_timeout_seconds: float
    log_level: str


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
    )


# Per-container caches. Only successfully loaded secrets are cached, so a missing or
# placeholder value is looked up again on the next invocation.
_secret_cache: dict[str, str] = {}
_clients: dict[str, Any] = {}


def load_secret(name: str, ssm_client: Any) -> str | None:
    """The decrypted value of one SSM parameter, or None when unset or unreadable."""
    cached = _secret_cache.get(name)
    if cached is not None:
        return cached
    try:
        response = ssm_client.get_parameter(Name=name, WithDecryption=True)
        value = response["Parameter"]["Value"]
    except Exception as exc:
        # The error class only: messages may echo request details.
        log("warn", "ssm_secret_unavailable", parameter=name, errorClass=type(exc).__name__)
        return None
    if not isinstance(value, str) or not value or value == PLACEHOLDER_VALUE:
        return None
    _secret_cache[name] = value
    return value


def get_secret(name: str) -> str | None:
    """load_secret with the container's lazily created SSM client."""
    cached = _secret_cache.get(name)
    if cached is not None:
        return cached
    try:
        client = ssm_client()
    except Exception as exc:
        log("warn", "ssm_client_unavailable", errorClass=type(exc).__name__)
        return None
    return load_secret(name, client)


def clear_secret_cache() -> None:
    _secret_cache.clear()


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

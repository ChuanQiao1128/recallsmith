"""Runtime configuration (contract §7.5), SSM secrets and the lazily created SSM client."""

from __future__ import annotations

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .logs import log

# Value of an SSM parameter that exists but has not been set yet (infra/modules/identity/ssm.tf).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

PROVIDERS = ("bedrock", "anthropic")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
STRUCTURED_OUTPUT_MODES = ("auto", "on", "off")
BEDROCK_MODEL_PREFIX = "anthropic."

DEFAULT_MODELS = {"bedrock": "anthropic.claude-opus-5", "anthropic": "claude-opus-5"}

DEFAULTS: dict[str, str] = {
    "AI_PROVIDER": "bedrock",
    "AI_BEDROCK_REGION": "ap-southeast-2",
    "AI_EFFORT": "high",
    "AI_STRUCTURED_OUTPUTS": "auto",
    "AI_QA_ENABLED": "0",
    "AI_PRICE_INPUT_PER_MTOK": "5",
    "AI_PRICE_OUTPUT_PER_MTOK": "25",
    "ANTHROPIC_API_KEY_SSM_NAME": "/developercards/prod/anthropic-api-key",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/internal-shared-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


class ConfigError(ValueError):
    """The configuration cannot produce a valid model call (error code CONFIG)."""


@dataclass(frozen=True)
class Settings:
    provider: Literal["bedrock", "anthropic"]
    model: str
    bedrock_region: str
    effort: str
    structured_outputs: Literal["auto", "on", "off"]
    enabled: bool
    price_input_per_mtok: float
    price_output_per_mtok: float
    anthropic_api_key_ssm_name: str = DEFAULTS["ANTHROPIC_API_KEY_SSM_NAME"]
    internal_secret_ssm_name: str = DEFAULTS["INTERNAL_SECRET_SSM_NAME"]
    core_api_base: str = DEFAULTS["CORE_API_BASE"]
    metrics_namespace: str = DEFAULTS["METRICS_NAMESPACE"]
    log_level: str = DEFAULTS["LOG_LEVEL"]


def is_truthy(value: str | None) -> bool:
    """The RouteMetrics.IsDisabled rule: trimmed "1", or "true"/"yes" in any case."""
    if value is None:
        return False
    text = value.strip()
    return text == "1" or text.lower() in ("true", "yes")


def _price(name: str, raw: str) -> float:
    try:
        value = float(raw.strip())
    except ValueError:
        raise ConfigError(f"{name} is not a number") from None
    if not math.isfinite(value) or value < 0:
        raise ConfigError(f"{name} must be a non-negative number")
    return value


def load_settings(env: Mapping[str, str] = os.environ) -> Settings:
    """Settings from the environment with the §7.5 defaults; raises ConfigError when invalid."""

    def get(key: str) -> str:
        value = env.get(key)
        if value is None or not value.strip():
            return DEFAULTS[key]
        return value.strip()

    provider = get("AI_PROVIDER").lower()
    if provider not in PROVIDERS:
        raise ConfigError(f"AI_PROVIDER must be one of {', '.join(PROVIDERS)}")

    raw_model = env.get("AI_MODEL")
    model = raw_model.strip() if raw_model and raw_model.strip() else DEFAULT_MODELS[provider]
    if provider == "bedrock" and not model.startswith(BEDROCK_MODEL_PREFIX):
        raise ConfigError("AI_MODEL for bedrock must be a Bedrock model id starting with 'anthropic.'")
    if provider == "anthropic" and model.startswith(BEDROCK_MODEL_PREFIX):
        raise ConfigError("AI_MODEL for anthropic must be a first-party model id, not a Bedrock id")

    effort = get("AI_EFFORT").lower()
    if effort not in EFFORTS:
        raise ConfigError(f"AI_EFFORT must be one of {', '.join(EFFORTS)}")

    structured = get("AI_STRUCTURED_OUTPUTS").lower()
    if structured not in STRUCTURED_OUTPUT_MODES:
        raise ConfigError(f"AI_STRUCTURED_OUTPUTS must be one of {', '.join(STRUCTURED_OUTPUT_MODES)}")

    return Settings(
        provider=provider,
        model=model,
        bedrock_region=get("AI_BEDROCK_REGION"),
        effort=effort,
        structured_outputs=structured,
        enabled=is_truthy(env.get("AI_QA_ENABLED", DEFAULTS["AI_QA_ENABLED"])),
        price_input_per_mtok=_price("AI_PRICE_INPUT_PER_MTOK", get("AI_PRICE_INPUT_PER_MTOK")),
        price_output_per_mtok=_price("AI_PRICE_OUTPUT_PER_MTOK", get("AI_PRICE_OUTPUT_PER_MTOK")),
        anthropic_api_key_ssm_name=get("ANTHROPIC_API_KEY_SSM_NAME"),
        internal_secret_ssm_name=get("INTERNAL_SECRET_SSM_NAME"),
        core_api_base=get("CORE_API_BASE"),
        metrics_namespace=get("METRICS_NAMESPACE"),
        log_level=get("LOG_LEVEL").lower(),
    )


def is_unset_secret(value: Any) -> bool:
    """True for None, non-strings, blank values and the SSM placeholder."""
    return not isinstance(value, str) or not value.strip() or value.strip() == PLACEHOLDER_VALUE


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
        log("warn", "ai-qa", event="ssm_secret_unavailable", parameter=name, errorClass=type(exc).__name__)
        return None
    if is_unset_secret(value):
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
        log("warn", "ai-qa", event="ssm_client_unavailable", errorClass=type(exc).__name__)
        return None
    return load_secret(name, client)


def clear_secret_cache() -> None:
    _secret_cache.clear()


def ssm_client() -> Any:
    if "ssm" not in _clients:
        import boto3  # shipped with anthropic[bedrock]; also in the Lambda runtime

        _clients["ssm"] = boto3.client("ssm")
    return _clients["ssm"]


def set_clients(*, ssm: Any = None) -> None:
    """Inject clients (tests). A None argument leaves that client untouched."""
    if ssm is not None:
        _clients["ssm"] = ssm


def reset_clients() -> None:
    _clients.clear()

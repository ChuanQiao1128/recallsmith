"""Runtime configuration (contract §7.5), SSM secrets and the lazily created SSM client."""

from __future__ import annotations

import math
import re
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .logs import log
from .schema import CATEGORIES

# Value of an SSM parameter that exists but has not been set yet (infra/modules/identity/ssm.tf).
PLACEHOLDER_VALUE = "PLACEHOLDER-set-by-supervisor"

# How long a loaded secret is trusted before SSM is read again (the dispatcher's value), so a
# rotation reaches every warm container within this window instead of only when it recycles.
SECRET_TTL_SECONDS = 300.0

# The optional previous internal secret lives next to the current one: "<name>-previous".
PREVIOUS_SECRET_SUFFIX = "-previous"

PROVIDERS = ("bedrock", "anthropic", "bedrock-converse", "openai-mantle")
CONVERSE_PROVIDER = "bedrock-converse"
# OpenAI Chat Completions on bedrock-mantle (openai_mantle_client.py, R18C contract L1).
OPENAI_MANTLE_PROVIDER = "openai-mantle"
EFFORTS = ("low", "medium", "high", "xhigh", "max")
STRUCTURED_OUTPUT_MODES = ("auto", "on", "off")
BEDROCK_MODEL_PREFIX = "anthropic."

# bedrock-converse and openai-mantle have no default: AI_MODEL (or AI_QA_SECOND_MODEL) must name the model.
DEFAULT_MODELS = {"bedrock": "anthropic.claude-opus-5", "anthropic": "claude-opus-5"}

# The optional second reviewer (README, "Other models (Bedrock Converse) and the second opinion").
# Off unless AI_QA_SECOND_PROVIDER is set. Its prices have no defaults: unset means an estimate of 0.
SECOND_PROVIDER_ENV = "AI_QA_SECOND_PROVIDER"
SECOND_MODEL_ENV = "AI_QA_SECOND_MODEL"
SECOND_SCOPE_ENV = "AI_QA_SECOND_SCOPE"
SECOND_PRICE_INPUT_ENV = "AI_QA_SECOND_PRICE_INPUT_PER_MTOK"
SECOND_PRICE_OUTPUT_ENV = "AI_QA_SECOND_PRICE_OUTPUT_PER_MTOK"
# AI_QA_SECOND_SCOPE: "facts" (default), "all", or a comma-separated list of categories.
SECOND_SCOPES: dict[str, frozenset[str]] = {
    "facts": frozenset({"incorrect_answer", "multiple_correct", "outdated_fact", "source_unsupported"}),
    "all": frozenset(CATEGORIES),
}

# The automation reviewer (README, "Automation profile (R18A)"): used for messages with
# "profile": "automation". Off unless AI_QA_AUTOMATION_PROVIDER is set. Its prices have no defaults;
# an unset price is a CONFIG error for the profile (profiles.settings_for), never at load time. An
# invalid automation key is recorded in Settings.automation_config_error instead of raised, so it
# fails only automation-profile messages and never the default (human) card QA.
AUTOMATION_PROVIDER_ENV = "AI_QA_AUTOMATION_PROVIDER"
AUTOMATION_MODEL_ENV = "AI_QA_AUTOMATION_MODEL"
AUTOMATION_PRICE_INPUT_ENV = "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK"
AUTOMATION_PRICE_OUTPUT_ENV = "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK"
# The bedrock-mantle region of provider openai-mantle (for any profile): GPT-5.5 is In-Region only in
# us-east-1 and us-east-2. The other providers keep AI_BEDROCK_REGION.
AUTOMATION_REGION_ENV = "AI_QA_AUTOMATION_REGION"
DEFAULT_AUTOMATION_REGION = "us-east-1"
_REGION_SHAPE = re.compile(r"^[a-z]{2}(-[a-z]+)+-[0-9]+$")

DEFAULTS: dict[str, str] = {
    "AI_PROVIDER": "bedrock",
    "AI_BEDROCK_REGION": "ap-southeast-2",
    "AI_EFFORT": "high",
    "AI_STRUCTURED_OUTPUTS": "auto",
    "AI_QA_ENABLED": "0",
    "AI_PRICE_INPUT_PER_MTOK": "5",
    "AI_PRICE_OUTPUT_PER_MTOK": "25",
    "ANTHROPIC_API_KEY_SSM_NAME": "/developercards/prod/anthropic-api-key",
    "INTERNAL_SECRET_SSM_NAME": "/developercards/prod/ai-qa-results-secret",
    "CORE_API_BASE": "https://api.developercards.app",
    "METRICS_NAMESPACE": "DeveloperCards",
    "LOG_LEVEL": "info",
}


# Receives of one message before SQS moves it to the DLQ: the ai-qa queue's redrive maxReceiveCount
# (infra/modules/worker/ai_qa.tf). Optional env key, not in the contract's env file; when the queue
# changes, set AI_QA_MAX_RECEIVES to the same value in the same release.
MAX_RECEIVES_ENV = "AI_QA_MAX_RECEIVES"
DEFAULT_MAX_RECEIVES = 2


class ConfigError(ValueError):
    """The configuration cannot produce a valid model call (error code CONFIG)."""


@dataclass(frozen=True)
class Settings:
    provider: Literal["bedrock", "anthropic", "bedrock-converse", "openai-mantle"]
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
    max_receives: int = DEFAULT_MAX_RECEIVES
    second_provider: str | None = None
    second_model: str | None = None
    second_scope: frozenset[str] = SECOND_SCOPES["facts"]
    second_price_input_per_mtok: float | None = None
    second_price_output_per_mtok: float | None = None
    automation_provider: str | None = None
    automation_model: str | None = None
    automation_price_input_per_mtok: float | None = None
    automation_price_output_per_mtok: float | None = None
    automation_config_error: str | None = None
    automation_region: str = DEFAULT_AUTOMATION_REGION


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

    model = _model("AI_MODEL", provider, env.get("AI_MODEL"))

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
        max_receives=_max_receives(env.get(MAX_RECEIVES_ENV)),
        **_second_opinion(env),
        **_automation(env),
    )


def _model(key: str, provider: str, raw: str | None) -> str:
    """The model id for `provider` from env key `key`, or that provider's default."""
    model = raw.strip() if raw and raw.strip() else DEFAULT_MODELS.get(provider)
    if model is None:
        raise ConfigError(f"{key} is required for {provider}")
    if provider == "bedrock" and not model.startswith(BEDROCK_MODEL_PREFIX):
        raise ConfigError(f"{key} for bedrock must be a Bedrock model id starting with 'anthropic.'")
    if provider == "anthropic" and model.startswith(BEDROCK_MODEL_PREFIX):
        raise ConfigError(f"{key} for anthropic must be a first-party model id, not a Bedrock id")
    if provider in (CONVERSE_PROVIDER, OPENAI_MANTLE_PROVIDER) and model.startswith(BEDROCK_MODEL_PREFIX):
        raise ConfigError(f"{key} for {provider} must not be an 'anthropic.' model (Claude uses bedrock)")
    return model


def _automation_region(raw: str | None) -> str:
    """AI_QA_AUTOMATION_REGION, else us-east-1; raises ConfigError for a value that is not a region."""
    region = (raw or "").strip().lower()
    if not region:
        return DEFAULT_AUTOMATION_REGION
    if not _REGION_SHAPE.match(region):
        raise ConfigError(f"{AUTOMATION_REGION_ENV} must be an AWS region such as {DEFAULT_AUTOMATION_REGION}")
    return region


def _optional_price(env: Mapping[str, str], key: str) -> float | None:
    raw = env.get(key)
    return _price(key, raw) if raw is not None and raw.strip() else None


def _second_opinion(env: Mapping[str, str]) -> dict[str, Any]:
    """The second-reviewer fields; empty (off) unless AI_QA_SECOND_PROVIDER is set."""
    provider = (env.get(SECOND_PROVIDER_ENV) or "").strip().lower()
    if not provider:
        return {}
    if provider not in PROVIDERS:
        raise ConfigError(f"{SECOND_PROVIDER_ENV} must be empty or one of {', '.join(PROVIDERS)}")
    raw_scope = (env.get(SECOND_SCOPE_ENV) or "").strip().lower() or "facts"
    scope = SECOND_SCOPES.get(raw_scope)
    if scope is None:
        names = frozenset(part.strip() for part in raw_scope.split(",") if part.strip())
        if not names or not names <= set(CATEGORIES):
            raise ConfigError(f"{SECOND_SCOPE_ENV} must be facts, all or a comma-separated list of categories")
        scope = names
    return {
        "second_provider": provider,
        "second_model": _model(SECOND_MODEL_ENV, provider, env.get(SECOND_MODEL_ENV)),
        "second_scope": scope,
        "second_price_input_per_mtok": _optional_price(env, SECOND_PRICE_INPUT_ENV),
        "second_price_output_per_mtok": _optional_price(env, SECOND_PRICE_OUTPUT_ENV),
    }


def _automation(env: Mapping[str, str]) -> dict[str, Any]:
    """The automation-reviewer fields; empty (unset) unless AI_QA_AUTOMATION_PROVIDER is set, plus
    the openai-mantle region (AI_QA_AUTOMATION_REGION).

    Never raises: an invalid key yields {"automation_config_error": <reason>} (with the provider when
    it is valid, so the report can name it), which profiles.settings_for raises for that profile only.
    """
    try:
        region = {"automation_region": _automation_region(env.get(AUTOMATION_REGION_ENV))}
    except ConfigError as exc:
        # The default region stays in place; only the automation profile is refused.
        return {"automation_config_error": str(exc)}
    provider = (env.get(AUTOMATION_PROVIDER_ENV) or "").strip().lower()
    if not provider:
        return region
    if provider not in PROVIDERS:
        return {
            **region,
            "automation_config_error": f"{AUTOMATION_PROVIDER_ENV} must be empty or one of {', '.join(PROVIDERS)}",
        }
    try:
        return {
            **region,
            "automation_provider": provider,
            "automation_model": _model(AUTOMATION_MODEL_ENV, provider, env.get(AUTOMATION_MODEL_ENV)),
            "automation_price_input_per_mtok": _optional_price(env, AUTOMATION_PRICE_INPUT_ENV),
            "automation_price_output_per_mtok": _optional_price(env, AUTOMATION_PRICE_OUTPUT_ENV),
        }
    except ConfigError as exc:
        return {**region, "automation_provider": provider, "automation_config_error": str(exc)}


def _max_receives(raw: str | None) -> int:
    """A positive integer, else the default (a bad value must not stop QA runs)."""
    try:
        value = int((raw or "").strip())
    except ValueError:
        return DEFAULT_MAX_RECEIVES
    return value if value >= 1 else DEFAULT_MAX_RECEIVES


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
            "ai-qa",
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
        log("warn", "ai-qa", event="ssm_client_unavailable", errorClass=type(exc).__name__)
        return None
    return load_secret(name, client, optional=optional)


def previous_secret_name(name: str) -> str:
    return name + PREVIOUS_SECRET_SUFFIX


def clear_secret_cache() -> None:
    _secret_cache.clear()
    _absent_cache.clear()


def ssm_client() -> Any:
    if "ssm" not in _clients:
        import boto3  # shipped with anthropic[bedrock]; also in the Lambda runtime

        _clients["ssm"] = boto3.client("ssm")
    return _clients["ssm"]


def sqs_client() -> Any:
    if "sqs" not in _clients:
        import boto3  # shipped with anthropic[bedrock]; also in the Lambda runtime

        _clients["sqs"] = boto3.client("sqs")
    return _clients["sqs"]


def set_clients(*, ssm: Any = None, sqs: Any = None) -> None:
    """Inject clients (tests). A None argument leaves that client untouched."""
    if ssm is not None:
        _clients["ssm"] = ssm
    if sqs is not None:
        _clients["sqs"] = sqs


def reset_clients() -> None:
    _clients.clear()

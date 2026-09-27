"""Model clients through the official anthropic SDK (contract §0.10, §7.5). No hand-rolled HTTP."""

from __future__ import annotations

import anthropic

from .converse_client import PROVIDER_DEFAULT_EFFORT, ConverseClient
from .openai_mantle_client import REASONING_EFFORTS, OpenAiMantleClient
from .settings import CONVERSE_PROVIDER, OPENAI_MANTLE_PROVIDER, ConfigError, Settings, is_unset_secret

CLIENT_TIMEOUT_SECONDS = 120.0
CLIENT_MAX_RETRIES = 2

# Set once a BadRequestError named the output format (review.py): structured outputs stay off
# for the rest of this container.
_structured_outputs_disabled = False


def make_client(
    settings: Settings, *, api_key: str | None = None
) -> anthropic.Anthropic | anthropic.AnthropicBedrockMantle | ConverseClient | OpenAiMantleClient:
    """Bedrock Mantle (IAM/SigV4 per request), the Anthropic API with an SSM-held key, the
    Bedrock Converse API for non-Anthropic models (bedrock-converse), or OpenAI Chat Completions on
    Bedrock Mantle (openai-mantle, region AI_QA_AUTOMATION_REGION)."""
    if settings.provider == "bedrock":
        return anthropic.AnthropicBedrockMantle(
            aws_region=settings.bedrock_region,
            timeout=CLIENT_TIMEOUT_SECONDS,
            max_retries=CLIENT_MAX_RETRIES,
        )
    if settings.provider == "anthropic":
        if is_unset_secret(api_key):
            raise ConfigError("the Anthropic API key is missing or still the placeholder")
        return anthropic.Anthropic(
            api_key=api_key,
            timeout=CLIENT_TIMEOUT_SECONDS,
            max_retries=CLIENT_MAX_RETRIES,
        )
    if settings.provider == CONVERSE_PROVIDER:
        return ConverseClient(
            region=settings.bedrock_region,
            timeout=CLIENT_TIMEOUT_SECONDS,
            max_retries=CLIENT_MAX_RETRIES,
        )
    if settings.provider == OPENAI_MANTLE_PROVIDER:
        return OpenAiMantleClient(
            region=settings.automation_region,
            timeout=CLIENT_TIMEOUT_SECONDS,
            max_retries=CLIENT_MAX_RETRIES,
        )
    raise ConfigError("unknown provider")


def effective_effort(settings: Settings) -> str:
    """The reasoning effort the reviewer really runs at: AI_EFFORT where the client sends it
    (output_config.effort), its reasoning_effort value for openai-mantle (max → xhigh), else
    "provider-default" (bedrock-converse; converse_client.py)."""
    if settings.provider == CONVERSE_PROVIDER:
        return PROVIDER_DEFAULT_EFFORT
    if settings.provider == OPENAI_MANTLE_PROVIDER:
        return REASONING_EFFORTS[settings.effort]
    return settings.effort


def structured_outputs_on(settings: Settings) -> bool:
    """on/off as configured; auto = on for the Anthropic API, off for Bedrock (contract §14 #5).
    Always off for bedrock-converse and openai-mantle (prompt-forced JSON plus the validation/repair
    turn).

    Re-checked 2026-09-27: the "Claude in Amazon Bedrock" page (the Mantle Messages endpoint this
    client uses) lists structured outputs under "Features not supported". The Bedrock "Yes" in
    the claude-api platform table matches the legacy InvokeModel page, not Mantle. See README.
    """
    if settings.provider in (CONVERSE_PROVIDER, OPENAI_MANTLE_PROVIDER):
        return False
    if settings.structured_outputs == "off" or _structured_outputs_disabled:
        return False
    if settings.structured_outputs == "on":
        return True
    return settings.provider == "anthropic"


def disable_structured_outputs() -> None:
    global _structured_outputs_disabled
    _structured_outputs_disabled = True


def reset_structured_outputs() -> None:
    """Tests: forget the per-container fallback."""
    global _structured_outputs_disabled
    _structured_outputs_disabled = False

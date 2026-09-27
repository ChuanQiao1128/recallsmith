"""The Bedrock Converse API behind the slice of the anthropic client that review.py and handler.py use.

For non-Anthropic Bedrock models (provider bedrock-converse). Claude stays on the Mantle path
(providers.make_client). One messages.create call is one bedrock-runtime `converse` call; the
response is Anthropic-shaped (content text block, stop_reason, usage, _request_id), like the evals
harness's claude-cli adapter. Structured outputs are off for this provider: the review is
prompt-forced JSON with the usual validation and repair turn.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .settings import ConfigError

DEFAULT_REGION = "ap-southeast-2"

# Converse stopReason → the Anthropic stop_reason review._check_stop understands. Anything else
# (tool_use and future values) passes through and reads as a finished reply.
STOP_REASONS = {
    "end_turn": "end_turn",
    "stop_sequence": "end_turn",
    "max_tokens": "max_tokens",
    "model_context_window_exceeded": "max_tokens",
    "content_filtered": "refusal",
    "guardrail_intervened": "refusal",
}

# Converse rejects a blank text block; an assistant turn with no text (the repair path after a
# reply without text) is sent as this instead.
EMPTY_TURN_TEXT = "(empty reply)"

# (region, botocore Config) → bedrock-runtime client. Seam for tests; production uses boto3.
RuntimeFactory = Callable[[str, Any], Any]

# with_options variants kept per client (the handler asks for one per card).
MAX_VARIANTS = 8


def _boto3_runtime(region: str, config: Any) -> Any:
    import boto3  # shipped with anthropic[bedrock]; also in the Lambda runtime

    return boto3.client("bedrock-runtime", region_name=region, config=config)


@dataclass
class TextBlock:
    text: str
    type: str = "text"


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class ConverseResponse:
    content: list[TextBlock]
    stop_reason: str | None
    usage: Usage
    _request_id: str | None
    stop_details: Any = None
    raw_stop_reason: str | None = field(default=None, repr=False)


def _field(block: Any, name: str) -> Any:
    return block.get(name) if isinstance(block, dict) else getattr(block, name, None)


def _text_of(content: Any) -> str:
    """A string as-is; content blocks flattened to their text blocks (thinking is dropped)."""
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if _field(block, "type") == "text":
            text = _field(block, "text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts)


def system_blocks(system: Any) -> list[dict[str, str]]:
    text = _text_of(system)
    return [{"text": text}] if text else []


def converse_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for message in messages:
        role = message["role"]
        if role not in ("user", "assistant"):
            raise ConfigError(f"Converse message role {role!r} is not supported")
        text = _text_of(message.get("content"))
        out.append({"role": role, "content": [{"text": text if text.strip() else EMPTY_TURN_TEXT}]})
    return out


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def to_response(raw: dict[str, Any]) -> ConverseResponse:
    message = (raw.get("output") or {}).get("message") or {}
    text = ""
    for block in message.get("content") or []:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            text = block["text"]
            break
    stop = raw.get("stopReason")
    usage = raw.get("usage") or {}
    return ConverseResponse(
        content=[TextBlock(text=text)],
        stop_reason=STOP_REASONS.get(stop, stop),
        usage=Usage(input_tokens=_int(usage.get("inputTokens")), output_tokens=_int(usage.get("outputTokens"))),
        _request_id=(raw.get("ResponseMetadata") or {}).get("RequestId"),
        raw_stop_reason=stop,
    )


class _Messages:
    def __init__(self, owner: ConverseClient) -> None:
        self._owner = owner

    def create(
        self,
        *,
        model: str,
        system: Any,
        messages: list[dict[str, Any]],
        max_tokens: int,
        thinking: Any = None,
        output_config: dict[str, Any] | None = None,
        **_: Any,
    ) -> ConverseResponse:
        # thinking and output_config.effort have no Converse equivalent here and are ignored.
        if output_config and output_config.get("format") is not None:
            raise ConfigError("structured outputs are off for bedrock-converse")
        request: dict[str, Any] = {
            "modelId": model,
            "messages": converse_messages(messages),
            "inferenceConfig": {"maxTokens": max_tokens},
        }
        blocks = system_blocks(system)
        if blocks:
            request["system"] = blocks
        return to_response(self._owner.runtime().converse(**request))


class ConverseClient:
    """Duck-types messages.create and with_options of anthropic.AnthropicBedrockMantle."""

    def __init__(
        self,
        *,
        region: str = DEFAULT_REGION,
        timeout: float | None = None,
        max_retries: int | None = None,
        runtime_factory: RuntimeFactory = _boto3_runtime,
    ) -> None:
        self.region = region or DEFAULT_REGION
        self.timeout = timeout
        self.max_retries = max_retries
        self._runtime_factory = runtime_factory
        self._runtime: Any = None
        self._variants: dict[tuple[float | None, int | None], ConverseClient] = {}
        self.messages = _Messages(self)

    def botocore_config(self) -> Any:
        from botocore.config import Config

        kwargs: dict[str, Any] = {}
        if self.timeout is not None:
            kwargs["read_timeout"] = self.timeout
        if self.max_retries is not None:
            kwargs["retries"] = {"max_attempts": self.max_retries + 1, "mode": "standard"}
        return Config(**kwargs)

    def runtime(self) -> Any:
        """The bedrock-runtime client, created on first use."""
        if self._runtime is None:
            self._runtime = self._runtime_factory(self.region, self.botocore_config())
        return self._runtime

    def with_options(self, *, timeout: float | None = None, max_retries: int | None = None, **_: Any) -> ConverseClient:
        """A client with this read timeout and retry count (None keeps this client's value)."""
        key = (self.timeout if timeout is None else timeout, self.max_retries if max_retries is None else max_retries)
        if key == (self.timeout, self.max_retries):
            return self
        variant = self._variants.get(key)
        if variant is None:
            if len(self._variants) >= MAX_VARIANTS:
                self._variants.clear()
            variant = ConverseClient(
                region=self.region, timeout=key[0], max_retries=key[1], runtime_factory=self._runtime_factory
            )
            self._variants[key] = variant
        return variant

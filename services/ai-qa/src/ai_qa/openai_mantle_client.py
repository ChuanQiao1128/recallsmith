"""OpenAI Chat Completions on Bedrock Mantle behind the slice of the anthropic client that review.py
and handler.py use (provider openai-mantle, R18C contract L1).

The AWS GPT-5.5 model card (docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html,
read 2026-09-28) lists bedrock-runtime (Converse included) as not supported and only the bedrock-mantle
OpenAI-compatible endpoint https://bedrock-mantle.{region}.api.aws/openai/v1 (Responses and Chat
Completions), model id `openai.gpt-5.5`, In-Region in us-east-1 and us-east-2 only. One
messages.create call is one POST to <base>/chat/completions, SigV4-signed for service
`bedrock-mantle` with botocore (as the anthropic SDK signs its Claude Mantle client); the response
is Anthropic-shaped like ConverseClient's. Structured outputs are off for this provider: the review
is prompt-forced JSON with the usual validation and repair turn.

AI_EFFORT is sent as `reasoning_effort` (max → xhigh, the highest Chat Completions value), so the
effort the reviewer runs at is the one recorded (providers.effective_effort), never a provider default.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

from .converse_client import EMPTY_TURN_TEXT, ConverseResponse, TextBlock, Usage, _text_of
from .settings import DEFAULT_AUTOMATION_REGION, ConfigError

SERVICE_NAME = "bedrock-mantle"
ENDPOINT_TEMPLATE = "https://bedrock-mantle.{region}.api.aws/openai/v1/chat/completions"

# Chat Completions finish_reason → the Anthropic stop_reason review._check_stop understands.
# Anything else (tool_calls and future values) passes through and reads as a finished reply.
FINISH_REASONS = {"stop": "end_turn", "length": "max_tokens", "content_filter": "refusal"}

# AI_EFFORT → reasoning_effort. Chat Completions has no "max"; its highest level is "xhigh".
REASONING_EFFORTS = {"low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "xhigh"}

# Statuses retried (up to max_retries) before the error reaches review.error_code_for.
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
RETRY_BACKOFF_SECONDS = 0.5
RETRY_BACKOFF_CAP_SECONDS = 4.0

# with_options variants kept per client (the handler asks for one per card).
MAX_VARIANTS = 8

# Longest provider error message kept on the exception (it is never logged in full).
MAX_ERROR_MESSAGE_CHARS = 500

# (url, headers, body, timeout seconds or None) → (status, headers, body). Seam for tests; production
# uses urllib. Raises MantleConnectionError when no HTTP response arrived.
Transport = Callable[[str, dict[str, str], bytes, float | None], tuple[int, dict[str, str], bytes]]
# () → botocore credentials or None. Seam for tests; production uses the default botocore chain.
CredentialsProvider = Callable[[], Any]


class MantleError(Exception):
    """A non-2xx answer from bedrock-mantle (mapped by review.mantle_error_code)."""

    def __init__(self, status_code: int, code: str | None, message: str, request_id: str | None) -> None:
        super().__init__(f"bedrock-mantle HTTP {status_code}: {code or 'error'}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.request_id = request_id


class MantleConnectionError(Exception):
    """No HTTP response: connect or read timeout, DNS or TLS failure (PROVIDER_TIMEOUT)."""


def endpoint_for(region: str) -> str:
    return ENDPOINT_TEMPLATE.format(region=region)


def _urllib_transport(
    url: str, headers: dict[str, str], body: bytes, timeout: float | None
) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()) if exc.headers else {}, exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise MantleConnectionError(type(exc).__name__) from None


def _default_credentials() -> Any:
    import botocore.session  # shipped with anthropic[bedrock]; also in the Lambda runtime

    return botocore.session.get_session().get_credentials()


def sign(credentials: Any, region: str, url: str, headers: dict[str, str], body: bytes) -> dict[str, str]:
    """headers plus the SigV4 headers for service bedrock-mantle."""
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest

    request = AWSRequest(method="POST", url=url, headers=dict(headers), data=body)
    SigV4Auth(credentials, SERVICE_NAME, region).add_auth(request)
    return {key: value for key, value in request.prepare().headers.items() if value is not None}


def chat_messages(system: Any, messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    system_text = _text_of(system)
    if system_text:
        out.append({"role": "system", "content": system_text})
    for message in messages:
        role = message["role"]
        if role not in ("user", "assistant"):
            raise ConfigError(f"Chat Completions message role {role!r} is not supported")
        text = _text_of(message.get("content"))
        out.append({"role": role, "content": text if text.strip() else EMPTY_TURN_TEXT})
    return out


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _header(headers: dict[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def to_response(raw: dict[str, Any], request_id: str | None) -> ConverseResponse:
    choices = raw.get("choices") or []
    choice = choices[0] if choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    text = message.get("content") if isinstance(message.get("content"), str) else ""
    finish = choice.get("finish_reason")
    stop = FINISH_REASONS.get(finish, finish)
    if not text and isinstance(message.get("refusal"), str) and message["refusal"]:
        stop = "refusal"
    usage = raw.get("usage") or {}
    prompt_tokens = _int(usage.get("prompt_tokens"))
    cached = min(_int((usage.get("prompt_tokens_details") or {}).get("cached_tokens")), prompt_tokens)
    return ConverseResponse(
        content=[TextBlock(text=text)],
        stop_reason=stop,
        # prompt_tokens includes the cached ones; the Anthropic shape counts them apart.
        usage=Usage(
            input_tokens=prompt_tokens - cached,
            output_tokens=_int(usage.get("completion_tokens")),
            cache_read_input_tokens=cached,
        ),
        _request_id=request_id or (raw.get("id") if isinstance(raw.get("id"), str) else None),
        raw_stop_reason=finish if isinstance(finish, str) else None,
    )


def to_error(status: int, headers: dict[str, str], body: bytes) -> MantleError:
    """The OpenAI error shape {"error": {"message", "type", "code"}} or the AWS one {"message"}."""
    try:
        parsed = json.loads(body.decode("utf-8", "replace")) if body else {}
    except ValueError:
        parsed = {}
    parsed = parsed if isinstance(parsed, dict) else {}
    error = parsed.get("error") if isinstance(parsed.get("error"), dict) else parsed
    message = error.get("message") or error.get("Message") or ""
    code = error.get("code") or error.get("type") or _header(headers, "x-amzn-ErrorType")
    code = str(code).split(":", 1)[0] if code else None
    return MantleError(
        status,
        code,
        str(message)[:MAX_ERROR_MESSAGE_CHARS],
        _header(headers, "x-amzn-RequestId"),
    )


class _Messages:
    def __init__(self, owner: OpenAiMantleClient) -> None:
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
        # thinking has no Chat Completions field (reasoning is always on); the effort is sent.
        output_config = output_config or {}
        if output_config.get("format") is not None:
            raise ConfigError("structured outputs are off for openai-mantle")
        request: dict[str, Any] = {
            "model": model,
            "messages": chat_messages(system, messages),
            "max_completion_tokens": max_tokens,
        }
        effort = output_config.get("effort")
        if effort is not None:
            mapped = REASONING_EFFORTS.get(effort)
            if mapped is None:
                raise ConfigError(f"effort {effort!r} has no reasoning_effort value")
            request["reasoning_effort"] = mapped
        return self._owner.post(request)


class OpenAiMantleClient:
    """Duck-types messages.create and with_options of anthropic.AnthropicBedrockMantle."""

    def __init__(
        self,
        *,
        region: str = DEFAULT_AUTOMATION_REGION,
        timeout: float | None = None,
        max_retries: int | None = None,
        transport: Transport = _urllib_transport,
        credentials_provider: CredentialsProvider = _default_credentials,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.region = region or DEFAULT_AUTOMATION_REGION
        self.timeout = timeout
        self.max_retries = max_retries
        self._transport = transport
        self._credentials_provider = credentials_provider
        self._sleep = sleep
        self._variants: dict[tuple[float | None, int | None], OpenAiMantleClient] = {}
        self.messages = _Messages(self)

    @property
    def url(self) -> str:
        return endpoint_for(self.region)

    def post(self, request: dict[str, Any]) -> ConverseResponse:
        body = json.dumps(request, separators=(",", ":")).encode("utf-8")
        attempts = 1 + max(self.max_retries or 0, 0)
        for attempt in range(attempts):
            last = attempt == attempts - 1
            credentials = self._credentials_provider()
            if credentials is None:
                raise ConfigError("no AWS credentials for bedrock-mantle")
            headers = sign(credentials, self.region, self.url, {"Content-Type": "application/json"}, body)
            try:
                status, response_headers, response_body = self._transport(self.url, headers, body, self.timeout)
            except MantleConnectionError:
                if last:
                    raise
                self._backoff(attempt)
                continue
            if 200 <= status < 300:
                try:
                    raw = json.loads(response_body.decode("utf-8"))
                except ValueError:
                    raise MantleError(status, "InvalidResponse", "the reply is not JSON", None) from None
                if not isinstance(raw, dict):
                    raise MantleError(status, "InvalidResponse", "the reply is not a JSON object", None)
                return to_response(raw, _header(response_headers, "x-amzn-RequestId"))
            if status in RETRY_STATUSES and not last:
                self._backoff(attempt)
                continue
            raise to_error(status, response_headers, response_body)
        raise AssertionError("unreachable")

    def _backoff(self, attempt: int) -> None:
        self._sleep(min(RETRY_BACKOFF_SECONDS * (2**attempt), RETRY_BACKOFF_CAP_SECONDS))

    def with_options(
        self, *, timeout: float | None = None, max_retries: int | None = None, **_: Any
    ) -> OpenAiMantleClient:
        """A client with this read timeout and retry count (None keeps this client's value)."""
        key = (self.timeout if timeout is None else timeout, self.max_retries if max_retries is None else max_retries)
        if key == (self.timeout, self.max_retries):
            return self
        variant = self._variants.get(key)
        if variant is None:
            if len(self._variants) >= MAX_VARIANTS:
                self._variants.clear()
            variant = OpenAiMantleClient(
                region=self.region,
                timeout=key[0],
                max_retries=key[1],
                transport=self._transport,
                credentials_provider=self._credentials_provider,
                sleep=self._sleep,
            )
            self._variants[key] = variant
        return variant

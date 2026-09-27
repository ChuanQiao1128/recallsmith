"""One card → one §7.7 result item, through client.messages.create (contract §7.5).

The public entry point review_card is imported unchanged by the evals harness, so the gate's
measured recall and precision describe exactly this code path.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

import anthropic
import pydantic

from . import providers
from .logs import log
from .prompts import SYSTEM_PROMPT
from .schema import CATEGORY_SEVERITY, ModelReview
from .settings import Settings

try:
    from botocore.exceptions import BotoCoreError
except ImportError:  # botocore ships with anthropic[bedrock]; tolerate its absence anyway
    BotoCoreError = None

MAX_TOKENS = 16000
MAX_FINDINGS = 10
MAX_MESSAGE_CHARS = 1000
MAX_SUGGESTED_FIX_CHARS = 2000
MAX_REPAIR_ERROR_CHARS = 1000
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10

# The DraftCard fields (contract §8.1). cardId and contentSha256 are never sent to the model.
CARD_FIELDS = (
    "stableUid",
    "difficulty",
    "topic",
    "question",
    "explanation",
    "codeSnippet",
    "codeLanguage",
    "realWorldUsage",
    "mcq",
    "source",
)

SEVERITY_ORDER = {"blocker": 0, "major": 1, "minor": 2}

OUTPUT_FORMAT_MARKERS = ("output_config", "output_format", "json_schema", "structured output")

_FENCE = re.compile(r"^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n(.*?)\r?\n?```\s*$", re.DOTALL)

_review_schema: dict[str, Any] | None = None


def review_schema() -> dict[str, Any]:
    global _review_schema
    if _review_schema is None:
        _review_schema = anthropic.transform_schema(ModelReview)
    return _review_schema


def card_json(card: dict[str, Any]) -> str:
    """The card's DraftCard fields as JSON; < and > escaped so card text cannot close <card>."""
    data = {key: card[key] for key in CARD_FIELDS if key in card}
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return text.replace("<", "\\u003c").replace(">", "\\u003e")


def build_user_text(card: dict[str, Any], review_date: str) -> str:
    return (
        f"Review date: {review_date}\n"
        "<card>\n"
        f"{card_json(card)}\n"
        "</card>\n"
        "Review this card and reply with only the review JSON object."
    )


def repair_text(error: Exception) -> str:
    detail = str(error)[:MAX_REPAIR_ERROR_CHARS]
    return (
        "Your previous reply was not a valid review JSON object. Validation error:\n"
        f"{detail}\n"
        'Reply with only the corrected JSON object of the form {"findings":[...]}, '
        "with no prose and no code fence."
    )


def request_kwargs(settings: Settings, messages: list[dict[str, Any]], *, structured: bool) -> dict[str, Any]:
    output_config: dict[str, Any] = {"effort": settings.effort}
    if structured:
        output_config["format"] = {"type": "json_schema", "schema": review_schema()}
    return {
        "model": settings.model,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": output_config,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "messages": messages,
    }


def first_text(response: Any) -> str:
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            return getattr(block, "text", "") or ""
    raise ValueError("the reply has no text block")


def strip_fence(text: str) -> str:
    match = _FENCE.match(text)
    return match.group(1) if match else text


def parse_review(response: Any) -> ModelReview:
    """Raises pydantic.ValidationError or ValueError when the reply is not a valid review."""
    return ModelReview.model_validate_json(strip_fence(first_text(response)))


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit]


def finalize_findings(review: ModelReview, card_id: int) -> list[dict[str, Any]]:
    """The §7.7 findings. Severity is derived from the category; the model's own value is only compared."""
    mismatches = [f for f in review.findings if f.severity != CATEGORY_SEVERITY[f.category]]
    if mismatches:
        log(
            "warn",
            "ai-qa",
            event="severity_mismatch",
            cardId=card_id,
            count=len(mismatches),
            pairs=sorted({f"{f.category}:{f.severity}" for f in mismatches}),
        )
    ordered = sorted(review.findings, key=lambda f: SEVERITY_ORDER[CATEGORY_SEVERITY[f.category]])[:MAX_FINDINGS]
    out: list[dict[str, Any]] = []
    for finding in ordered:
        message = _truncate(finding.message, MAX_MESSAGE_CHARS)
        fix = finding.suggestedFix
        fix = _truncate(fix, MAX_SUGGESTED_FIX_CHARS) if fix is not None and fix.strip() else None
        out.append(
            {
                "cardId": card_id,
                "severity": CATEGORY_SEVERITY[finding.category],
                "category": finding.category,
                "message": message if message.strip() else finding.category,
                "suggestedFix": fix,
            }
        )
    return out


def estimate_cost_usd(
    settings: Settings, *, input_tokens: int, cache_creation: int, cache_read: int, output_tokens: int
) -> float:
    """An estimate at the configured list prices; Bedrock bills separately."""
    p_in = settings.price_input_per_mtok
    p_out = settings.price_output_per_mtok
    total = (
        input_tokens * p_in
        + cache_creation * p_in * CACHE_WRITE_MULTIPLIER
        + cache_read * p_in * CACHE_READ_MULTIPLIER
        + output_tokens * p_out
    )
    return round(total / 1_000_000, 6)


@dataclass
class _Tally:
    input_tokens: int = 0
    cache_creation: int = 0
    cache_read: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    calls: int = 0
    request_id: str | None = None

    def add(self, response: Any) -> None:
        usage = getattr(response, "usage", None)
        self.input_tokens += _int(getattr(usage, "input_tokens", 0))
        self.cache_creation += _int(getattr(usage, "cache_creation_input_tokens", 0))
        self.cache_read += _int(getattr(usage, "cache_read_input_tokens", 0))
        self.output_tokens += _int(getattr(usage, "output_tokens", 0))
        self.request_id = getattr(response, "_request_id", None)


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


class _Outcome(Exception):
    """Internal: ends the card with a status and error code."""

    def __init__(self, status: str, code: str | None, findings: list[dict[str, Any]] | None = None) -> None:
        super().__init__(code or status)
        self.status = status
        self.code = code
        self.findings = findings or []


def _call(client: Any, kwargs: dict[str, Any], tally: _Tally, card_id: Any, phase: str) -> Any:
    started = time.monotonic()
    try:
        response = client.messages.create(**kwargs)
    finally:
        tally.latency_s += time.monotonic() - started
        tally.calls += 1
    tally.add(response)
    usage = getattr(response, "usage", None)
    log(
        "info",
        "ai-qa",
        event="model_call",
        phase=phase,
        cardId=card_id,
        requestId=tally.request_id,
        stopReason=getattr(response, "stop_reason", None),
        inputTokens=_int(getattr(usage, "input_tokens", 0)),
        outputTokens=_int(getattr(usage, "output_tokens", 0)),
        cacheReadInputTokens=_int(getattr(usage, "cache_read_input_tokens", 0)),
        cacheCreationInputTokens=_int(getattr(usage, "cache_creation_input_tokens", 0)),
    )
    return response


def _refusal_category(response: Any) -> Any:
    details = getattr(response, "stop_details", None)
    if isinstance(details, dict):
        return details.get("category")
    return getattr(details, "category", None)


def _check_stop(response: Any, card_id: Any) -> None:
    stop = getattr(response, "stop_reason", None)
    if stop == "max_tokens":
        raise _Outcome("error", "MAX_TOKENS")
    if stop == "refusal":
        log("warn", "ai-qa", event="model_refusal", cardId=card_id, refusalCategory=_refusal_category(response))
        raise _Outcome("refused", "REFUSAL")


def _review_once(
    card: dict[str, Any], client: Any, settings: Settings, user_text: str, structured: bool, tally: _Tally
) -> list[dict[str, Any]]:
    card_id = card.get("cardId")
    user = {"role": "user", "content": user_text}
    response = _call(client, request_kwargs(settings, [user], structured=structured), tally, card_id, "review")
    _check_stop(response, card_id)
    try:
        return finalize_findings(parse_review(response), card_id)
    except (pydantic.ValidationError, ValueError) as exc:
        log("warn", "ai-qa", event="review_invalid", cardId=card_id, errorClass=type(exc).__name__)
        messages = [
            user,
            {"role": "assistant", "content": response.content},
            {"role": "user", "content": repair_text(exc)},
        ]
    repaired = _call(client, request_kwargs(settings, messages, structured=structured), tally, card_id, "repair")
    _check_stop(repaired, card_id)
    try:
        return finalize_findings(parse_review(repaired), card_id)
    except (pydantic.ValidationError, ValueError) as exc:
        log("warn", "ai-qa", event="review_invalid", cardId=card_id, errorClass=type(exc).__name__, repair=True)
        raise _Outcome("error", "SCHEMA_INVALID") from None


def names_output_format(exc: Exception) -> bool:
    text = str(getattr(exc, "message", "") or exc).lower()
    return any(marker in text for marker in OUTPUT_FORMAT_MARKERS)


def error_code_for(exc: Exception) -> str | None:
    """The bounded §7.5 code for a provider/credential exception, or None to let it propagate."""
    if isinstance(exc, anthropic.AuthenticationError):
        return "PROVIDER_AUTH"
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "PROVIDER_ACCESS_DENIED"
    if isinstance(exc, anthropic.NotFoundError):
        return "CONFIG"
    if isinstance(exc, anthropic.BadRequestError):
        return "CONFIG"
    if isinstance(exc, anthropic.RateLimitError):
        return "PROVIDER_RATE_LIMITED"
    if isinstance(exc, anthropic.APIStatusError):
        return "PROVIDER_ERROR" if exc.status_code >= 500 else "CONFIG"
    if isinstance(exc, anthropic.APIConnectionError):  # includes APITimeoutError
        return "PROVIDER_TIMEOUT"
    if isinstance(exc, anthropic.CredentialsError):
        return "CONFIG"
    if BotoCoreError is not None and isinstance(exc, BotoCoreError):
        return "CONFIG"
    if isinstance(exc, RuntimeError) and "credential" in str(exc).lower():
        return "CONFIG"
    return None


def review_card(card: dict, *, client, settings: Settings, review_date: str) -> dict:
    """Review one QaCard and return one §7.7 result item. Unmapped exceptions propagate."""
    item, _calls = review_card_counted(card, client=client, settings=settings, review_date=review_date)
    return item


def review_card_counted(
    card: dict[str, Any], *, client: Any, settings: Settings, review_date: str
) -> tuple[dict[str, Any], int]:
    """review_card plus the number of model calls attempted (the handler's EMF needs it)."""
    card_id = card.get("cardId")
    tally = _Tally()
    user_text = build_user_text(card, review_date)
    structured = providers.structured_outputs_on(settings)
    format_fallback_used = False

    status, code, findings = "done", None, []
    while True:
        try:
            findings = _review_once(card, client, settings, user_text, structured, tally)
            break
        except _Outcome as outcome:
            status, code, findings = outcome.status, outcome.code, outcome.findings
            break
        except Exception as exc:
            if (
                isinstance(exc, anthropic.BadRequestError)
                and structured
                and not format_fallback_used
                and names_output_format(exc)
            ):
                providers.disable_structured_outputs()
                structured = False
                format_fallback_used = True
                log("warn", "ai-qa", event="structured_outputs_disabled", cardId=card_id)
                continue
            mapped = error_code_for(exc)
            if mapped is None:
                raise
            if isinstance(exc, anthropic.APIStatusError) and tally.request_id is None:
                tally.request_id = getattr(exc, "request_id", None)
            log(
                "warn",
                "ai-qa",
                event="model_error",
                cardId=card_id,
                errorClass=type(exc).__name__,
                errorCode=mapped,
                requestId=tally.request_id,
            )
            status, code, findings = "error", mapped, []
            break

    item = {
        "cardId": card_id,
        "contentSha256": card.get("contentSha256"),
        "status": status,
        "errorCode": code,
        "findings": findings,
        "usage": {
            "inputTokens": tally.input_tokens + tally.cache_creation,
            "outputTokens": tally.output_tokens,
            "cacheReadInputTokens": tally.cache_read,
        },
        "latencyMs": int(round(tally.latency_s * 1000)),
        "requestId": tally.request_id,
        "estimatedCostUsd": estimate_cost_usd(
            settings,
            input_tokens=tally.input_tokens,
            cache_creation=tally.cache_creation,
            cache_read=tally.cache_read,
            output_tokens=tally.output_tokens,
        ),
    }
    return item, tally.calls

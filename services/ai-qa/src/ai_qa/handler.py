"""SQS chunk → one model call per card → one signed results report (contract §7.4, §7.5, §7.7).

Response: {"batchItemFailures": [{"itemIdentifier": <messageId>}, ...]} (ReportBatchItemFailures).
Logs carry ids, statuses and token counts only: never card text, model output, keys or signatures.
"""

from __future__ import annotations

import datetime
import json
import os
from collections.abc import Mapping
from typing import Any

from . import emf, settings
from .internal_client import RESULTS_PATH, InternalClient
from .logs import log
from .prompts import PROMPT_VERSION
from .providers import make_client
from .review import review_card_counted
from .settings import DEFAULT_MODELS, DEFAULTS, PROVIDERS, ConfigError, Settings

DEADLINE_MARGIN_SECONDS = 150
CALL_TIMEOUT_SECONDS = 120
# A card started with less than this left runs without SDK retries (3 × 120 s would not fit).
RETRY_WINDOW_SECONDS = 420
# Seconds kept free for the SDK's own bookkeeping after the call timeout.
CALL_TIMEOUT_RESERVE_SECONDS = 30
REPORT_BUDGET_RESERVE_S = 2.0

FAIL_FAST_CODES = frozenset({"PROVIDER_AUTH", "PROVIDER_ACCESS_DENIED", "CONFIG"})
RETRYABLE_CODES = frozenset({"PROVIDER_RATE_LIMITED", "PROVIDER_ERROR", "PROVIDER_TIMEOUT"})

# Seams for tests (monkeypatched); production uses the real client factory and HTTP client.
client_factory = make_client
internal_client_factory = InternalClient

# Model clients are cached per container, keyed by what makes them differ.
_client_cache: dict[tuple[str, str, str | None], Any] = {}


def reset_client_cache() -> None:
    _client_cache.clear()


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_review_date(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return value[4] == "-" and value[7] == "-"


def _is_card(card: Any) -> bool:
    return (
        isinstance(card, dict)
        and _is_int(card.get("cardId"))
        and isinstance(card.get("contentSha256"), str)
        and isinstance(card.get("question"), str)
        and isinstance(card.get("explanation"), str)
        and _is_int(card.get("difficulty"))
    )


def parse_message(raw: Any) -> dict[str, Any] | None:
    """The §7.4 message, or None for any other shape."""
    if not isinstance(raw, str):
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    if not (_is_int(data.get("v")) and data["v"] == 1):
        return None
    if not isinstance(data.get("runId"), str) or not data["runId"]:
        return None
    if not (_is_int(data.get("chunk")) and data["chunk"] >= 0):
        return None
    if not (_is_int(data.get("chunkCount")) and data["chunkCount"] >= 1):
        return None
    if not isinstance(data.get("promptVersion"), str):
        return None
    if not isinstance(data.get("deck"), dict):
        return None
    if not _is_review_date(data.get("reviewDate")):
        return None
    cards = data.get("cards")
    if not isinstance(cards, list) or not cards or not all(_is_card(card) for card in cards):
        return None
    return data


def _remaining_s(context: Any) -> float | None:
    remaining = getattr(context, "get_remaining_time_in_millis", None)
    if not callable(remaining):
        return None
    return remaining() / 1000


def _empty_item(card: Mapping[str, Any], status: str, code: str) -> dict[str, Any]:
    return {
        "cardId": card["cardId"],
        "contentSha256": card["contentSha256"],
        "status": status,
        "errorCode": code,
        "findings": [],
        "usage": {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0},
        "latencyMs": 0,
        "requestId": None,
        "estimatedCostUsd": 0.0,
    }


def _report_identity(env: Mapping[str, str], cfg: Settings | None) -> tuple[str, str]:
    """provider/model for the report; best effort when the settings are invalid."""
    if cfg is not None:
        return cfg.provider, cfg.model
    provider = (env.get("AI_PROVIDER") or "").strip().lower()
    if provider not in PROVIDERS:
        provider = DEFAULTS["AI_PROVIDER"]
    model = (env.get("AI_MODEL") or "").strip() or DEFAULT_MODELS[provider]
    return provider, model


def _env_or_default(env: Mapping[str, str], cfg: Settings | None, key: str, attr: str) -> str:
    if cfg is not None:
        return getattr(cfg, attr)
    value = (env.get(key) or "").strip()
    return value or DEFAULTS[key]


def _model_client(cfg: Settings) -> Any:
    """The cached client; reads the Anthropic key only for provider anthropic. Raises ConfigError."""
    api_key: str | None = None
    if cfg.provider == "anthropic":
        api_key = settings.get_secret(cfg.anthropic_api_key_ssm_name)
    key = (cfg.provider, cfg.bedrock_region, api_key)
    client = _client_cache.get(key)
    if client is None:
        client = client_factory(cfg, api_key=api_key)
        _client_cache[key] = client
    return client


def _log_item(msg: Mapping[str, Any], item: Mapping[str, Any]) -> None:
    usage = item.get("usage") or {}
    log(
        "info",
        "ai-qa",
        event="card_result",
        runId=msg["runId"],
        chunk=msg["chunk"],
        cardId=item.get("cardId"),
        status=item.get("status"),
        errorCode=item.get("errorCode"),
        latencyMs=item.get("latencyMs"),
        requestId=item.get("requestId"),
        inputTokens=usage.get("inputTokens"),
        outputTokens=usage.get("outputTokens"),
        cacheReadInputTokens=usage.get("cacheReadInputTokens"),
    )


def _report(
    msg: Mapping[str, Any],
    provider: str,
    model: str,
    items: list[dict[str, Any]],
    secret: str,
    core_api_base: str,
    context: Any,
) -> bool:
    body = {
        "v": 1,
        "runId": msg["runId"],
        "chunk": msg["chunk"],
        "provider": provider,
        "model": model,
        "promptVersion": PROMPT_VERSION,
        "items": items,
    }
    remaining = _remaining_s(context)
    budget = None if remaining is None else max(0.0, remaining - REPORT_BUDGET_RESERVE_S)
    result = internal_client_factory(core_api_base, secret).post(RESULTS_PATH, body, budget_s=budget)
    if not result.ok:
        log(
            "error",
            "ai-qa",
            event="report_failed",
            runId=msg["runId"],
            chunk=msg["chunk"],
            status=result.status,
            error=result.error,
        )
        return False
    log("info", "ai-qa", event="report_ok", runId=msg["runId"], chunk=msg["chunk"], items=len(items))
    return True


def _process(record: Mapping[str, Any], context: Any, env: Mapping[str, str]) -> bool:
    """Handle one record. True = ack (delete), False = batch item failure."""
    message_id = record.get("messageId")
    msg = parse_message(record.get("body"))
    if msg is None:
        log("warn", "ai-qa", event="bad_message", messageId=message_id)
        return True
    cards: list[dict[str, Any]] = msg["cards"]
    if msg["promptVersion"] != PROMPT_VERSION:
        log(
            "warn",
            "ai-qa",
            event="prompt_version_mismatch",
            runId=msg["runId"],
            chunk=msg["chunk"],
            requested=msg["promptVersion"],
            running=PROMPT_VERSION,
        )

    cfg: Settings | None
    try:
        cfg = settings.load_settings(env)
    except ConfigError as exc:
        cfg = None
        log("error", "ai-qa", event="config_invalid", runId=msg["runId"], chunk=msg["chunk"], reason=str(exc))

    provider, model = _report_identity(env, cfg)
    namespace = _env_or_default(env, cfg, "METRICS_NAMESPACE", "metrics_namespace")
    core_api_base = _env_or_default(env, cfg, "CORE_API_BASE", "core_api_base")
    secret_name = _env_or_default(env, cfg, "INTERNAL_SECRET_SSM_NAME", "internal_secret_ssm_name")

    secret = settings.get_secret(secret_name)
    if secret is None:
        log("error", "ai-qa", event="internal_secret_missing", runId=msg["runId"], chunk=msg["chunk"])
        return False

    def finish(items: list[dict[str, Any]]) -> bool:
        return _report(msg, provider, model, items, secret, core_api_base, context)

    def fill(code: str, status: str = "error", start: int = 0) -> list[dict[str, Any]]:
        items = [_empty_item(card, status, code) for card in cards[start:]]
        for item in items:
            emf.emit_item(namespace, provider, item, model_called=False)
            _log_item(msg, item)
        return items

    # Deterministic outcomes are acked once reported; a failed report is retried by SQS.
    if cfg is None:
        return finish(fill("CONFIG"))

    if not cfg.enabled:
        return finish(fill("DISABLED", status="skipped"))

    try:
        client = _model_client(cfg)
    except ConfigError as exc:
        log("error", "ai-qa", event="client_config_invalid", runId=msg["runId"], chunk=msg["chunk"], reason=str(exc))
        return finish(fill("CONFIG"))

    items: list[dict[str, Any]] = []
    for index, card in enumerate(cards):
        remaining = _remaining_s(context)
        if remaining is not None and remaining < DEADLINE_MARGIN_SECONDS:
            item, calls = _empty_item(card, "error", "PROVIDER_TIMEOUT"), 0
            log("warn", "ai-qa", event="deadline_guard", runId=msg["runId"], chunk=msg["chunk"], cardId=card["cardId"])
        else:
            call_client = client
            if remaining is not None:
                call_client = client.with_options(
                    timeout=min(float(CALL_TIMEOUT_SECONDS), remaining - CALL_TIMEOUT_RESERVE_SECONDS),
                    max_retries=2 if remaining >= RETRY_WINDOW_SECONDS else 0,
                )
            item, calls = review_card_counted(
                card, client=call_client, settings=cfg, review_date=msg["reviewDate"]
            )
        emf.emit_item(namespace, cfg.provider, item, model_called=calls > 0)
        _log_item(msg, item)

        code = item.get("errorCode")
        if code in FAIL_FAST_CODES:
            items.append(item)
            items.extend(fill(code, start=index + 1))
            return finish(items)
        if code in RETRYABLE_CODES:
            if items:
                finish(items)
            return False
        items.append(item)

    return finish(items)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, list[dict[str, str]]]:
    failures: list[dict[str, str]] = []
    for record in (event or {}).get("Records") or []:
        message_id = record.get("messageId")
        try:
            ok = _process(record, context, os.environ)
        except Exception as exc:
            log("error", "ai-qa", event="unexpected_error", messageId=message_id, errorClass=type(exc).__name__)
            ok = False
        if not ok:
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}

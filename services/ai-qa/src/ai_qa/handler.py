"""SQS chunk → one model call per card → one signed results report (contract §7.4, §7.5, §7.7).

Response: {"batchItemFailures": [{"itemIdentifier": <messageId>}, ...]} (ReportBatchItemFailures).
Logs carry ids, statuses and token counts only: never card text, model output, keys or signatures.
"""

from __future__ import annotations

import datetime
import json
import os
import random
import time
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

from . import emf, profiles, second_opinion, settings, tracectx
from .internal_client import RESULTS_PATH, InternalClient
from .logs import log
from .providers import effective_effort, make_client
from .review import review_card_counted
from .settings import DEFAULT_MODELS, DEFAULTS, PROVIDERS, ConfigError, Settings

DEADLINE_MARGIN_SECONDS = 150
CALL_TIMEOUT_SECONDS = 120
# A card started with less than this left runs without SDK retries (3 × 120 s would not fit).
RETRY_WINDOW_SECONDS = 420
# Seconds kept free for the SDK's own bookkeeping after the call timeout.
CALL_TIMEOUT_RESERVE_SECONDS = 30
REPORT_BUDGET_RESERVE_S = 2.0

# After a retryable provider error, a failed results report or a missing internal secret the
# message comes back after this many seconds (jittered) instead of the queue's 3600 s visibility,
# so a rate-limit blip does not stall the run for an hour. From the second receive on the wait is
# longer, so a limit that lasts a few minutes does not burn the remaining receives at once (this
# needs maxReceiveCount >= 3). On the last receive (Settings.max_receives) a retryable error is
# reported for the unfinished cards and the message is acked, so the run ends with visible errors
# instead of a chunk in the DLQ.
RETRY_VISIBILITY_MIN_SECONDS = 60
RETRY_VISIBILITY_MAX_SECONDS = 120
RETRY_VISIBILITY_LATER_MIN_SECONDS = 540
RETRY_VISIBILITY_LATER_MAX_SECONDS = 660
# Pauses (low, high: jittered) between tries of the results POST: 4 tries, at most ~45 s of pauses,
# well inside the 600 s function budget (the POST itself is also capped by the time left).
REPORT_RETRY_PAUSES_S = ((1.0, 3.0), (4.0, 8.0), (15.0, 30.0))
# Cards already reported by this container, so a redelivered chunk does not pay for them twice.
REPORTED_CACHE_MAX = 2000
# Items reviewed by this container whose report failed: a redelivery reports them again without
# paying for a second model call.
UNREPORTED_CACHE_MAX = 500

FAIL_FAST_CODES = frozenset({"PROVIDER_AUTH", "PROVIDER_ACCESS_DENIED", "CONFIG"})
RETRYABLE_CODES = frozenset({"PROVIDER_RATE_LIMITED", "PROVIDER_ERROR", "PROVIDER_TIMEOUT"})

# Seams for tests (monkeypatched); production uses the real client factory and HTTP client.
client_factory = make_client
internal_client_factory = InternalClient
jitter = random.uniform
sleep = time.sleep

# Model clients are cached per container, keyed by what makes them differ.
_client_cache: dict[tuple[str, str, str | None], Any] = {}


# (runId, chunk, cardId, contentSha256, promptVersion) of items this container has reported with a
# 200. The results route never downgrades a done item, so re-reviewing one would only cost money.
_reported: OrderedDict[tuple[str, int, int, str, str], None] = OrderedDict()
# Same key → the reviewed item whose report has not succeeded yet.
_unreported: OrderedDict[tuple[str, int, int, str, str], dict[str, Any]] = OrderedDict()


def reset_client_cache() -> None:
    _client_cache.clear()
    _reported.clear()
    _unreported.clear()


def _reported_key(msg: Mapping[str, Any], card: Mapping[str, Any]) -> tuple[str, int, int, str, str]:
    profile = msg.get("profile", profiles.DEFAULT_PROFILE)
    return (msg["runId"], msg["chunk"], card["cardId"], card["contentSha256"], profiles.prompt_version_for(profile))


def _remember_reported(msg: Mapping[str, Any], items: list[dict[str, Any]]) -> None:
    for item in items:
        key = _reported_key(msg, item)
        _reported[key] = None
        _reported.move_to_end(key)
        _unreported.pop(key, None)
    while len(_reported) > REPORTED_CACHE_MAX:
        _reported.popitem(last=False)


def _remember_unreported(msg: Mapping[str, Any], items: list[dict[str, Any]]) -> None:
    for item in items:
        key = _reported_key(msg, item)
        _unreported[key] = item
        _unreported.move_to_end(key)
    while len(_unreported) > UNREPORTED_CACHE_MAX:
        _unreported.popitem(last=False)


def _receive_count(record: Mapping[str, Any]) -> int:
    attributes = record.get("attributes")
    raw = attributes.get("ApproximateReceiveCount") if isinstance(attributes, Mapping) else None
    try:
        return int(raw) if raw is not None else 1
    except (TypeError, ValueError):
        return 1


def queue_url_from_arn(arn: str) -> str:
    """arn:aws:sqs:<region>:<account>:<name> → https://sqs.<region>.amazonaws.com/<account>/<name>."""
    parts = arn.split(":")
    if len(parts) != 6 or parts[2] != "sqs":
        raise ValueError("not an SQS queue ARN")
    _, _, _, region, account, name = parts
    return f"https://sqs.{region}.amazonaws.com/{account}/{name}"


def _retry_soon(record: Mapping[str, Any], msg: Mapping[str, Any]) -> None:
    """Shorten the failed message's visibility so SQS redelivers it in 60-120 s (first receive) or
    9-11 min (later receives) instead of 3600 s. Best effort."""
    arn = record.get("eventSourceARN")
    receipt = record.get("receiptHandle")
    if not isinstance(arn, str) or not isinstance(receipt, str):
        return
    if _receive_count(record) <= 1:
        seconds = int(jitter(RETRY_VISIBILITY_MIN_SECONDS, RETRY_VISIBILITY_MAX_SECONDS))
    else:
        seconds = int(jitter(RETRY_VISIBILITY_LATER_MIN_SECONDS, RETRY_VISIBILITY_LATER_MAX_SECONDS))
    try:
        settings.sqs_client().change_message_visibility(
            QueueUrl=queue_url_from_arn(arn), ReceiptHandle=receipt, VisibilityTimeout=seconds
        )
    except Exception as exc:
        log("warn", "ai-qa", event="visibility_failed", runId=msg["runId"], chunk=msg["chunk"], errorClass=type(exc).__name__)
        return
    log("info", "ai-qa", event="retry_scheduled", runId=msg["runId"], chunk=msg["chunk"], visibilitySeconds=seconds)


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
    # Optional keys (A00 §9.2, §9.6); absent means the human card path with the default reviewer.
    target = data.get("target", profiles.DEFAULT_TARGET)
    if not isinstance(target, str) or target not in profiles.TARGETS:
        return None
    profile = data.get("profile", profiles.DEFAULT_PROFILE)
    if not isinstance(profile, str) or profile not in profiles.PROFILES:
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
    model = (env.get("AI_MODEL") or "").strip() or DEFAULT_MODELS.get(provider, "unset")
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


def _with_deadline(client: Any, remaining: float | None) -> Any:
    """The client with a call timeout and retry count that fit the time left (None: unchanged)."""
    if remaining is None:
        return client
    return client.with_options(
        timeout=min(float(CALL_TIMEOUT_SECONDS), remaining - CALL_TIMEOUT_RESERVE_SECONDS),
        max_retries=2 if remaining >= RETRY_WINDOW_SECONDS else 0,
    )


def _second_opinion(
    msg: Mapping[str, Any], card: dict[str, Any], primary: dict[str, Any], cfg: Settings, namespace: str, context: Any
) -> tuple[dict[str, Any], int]:
    """The primary item merged with the second reviewer's (second_opinion.py) and the second's call
    count. Any failure leaves the primary item unchanged; only the error code is logged."""
    second: dict[str, Any] | None = None
    calls = 0
    code: str | None = None
    remaining = _remaining_s(context)
    if remaining is not None and remaining < DEADLINE_MARGIN_SECONDS:
        code = "PROVIDER_TIMEOUT"
    else:
        try:
            second_cfg = second_opinion.second_settings(cfg)
            client = _with_deadline(_model_client(second_cfg), remaining)
            second, calls = review_card_counted(card, client=client, settings=second_cfg, review_date=msg["reviewDate"])
        except ConfigError:
            code = "CONFIG"
        except Exception:
            code = "PROVIDER_ERROR"
    if code is None:
        item, added, code = second_opinion.apply(primary, second, cfg)
    else:
        item, added = primary, None
    if code is not None:
        log(
            "warn",
            "ai-qa",
            event="second_opinion_failed",
            runId=msg["runId"],
            chunk=msg["chunk"],
            cardId=card["cardId"],
            errorCode=code,
        )
        emf.emit_second_opinion(namespace, error_code=code)
        return primary, calls
    log(
        "info",
        "ai-qa",
        event="second_opinion",
        runId=msg["runId"],
        chunk=msg["chunk"],
        cardId=card["cardId"],
        added=added,
    )
    emf.emit_second_opinion(namespace, added=added)
    return item, calls


def _log_item(msg: Mapping[str, Any], item: Mapping[str, Any], effort: str | None = None) -> None:
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
        effort=effort,
    )


def _report(
    msg: Mapping[str, Any],
    provider: str,
    model: str,
    items: list[dict[str, Any]],
    secret: str,
    secret_name: str,
    core_api_base: str,
    context: Any,
    *,
    target: str,
    profile: str,
    effort: str | None,
) -> bool:
    body: dict[str, Any] = {
        "v": 1,
        "runId": msg["runId"],
        "chunk": msg["chunk"],
        "provider": provider,
        "model": model,
        # The version this profile's reviewer ran (qa-v4, or qa-v4-auto for automation; contract K1).
        "promptVersion": profiles.prompt_version_for(profile),
        "items": items,
    }
    # Only when not the default, so a human run's report stays byte-identical (README).
    if target == profiles.DRAFT_TARGET:
        body["target"] = target
    if profile == profiles.AUTOMATION_PROFILE:
        body["profile"] = profile
        # The effort this reviewer ran at, matched by core against the gate's reviewer effort at a
        # live auto-accept (contract N2/O1). None only when no reviewer settings exist (CONFIG).
        if effort is not None:
            body["effectiveEffort"] = effort
    remaining = _remaining_s(context)
    budget = None if remaining is None else max(0.0, remaining - REPORT_BUDGET_RESERVE_S)
    # Read only if core rejects the signature: present only during a rotation (README, "Route-secret
    # rotation").
    def previous_secret() -> str | None:
        return settings.get_secret(settings.previous_secret_name(secret_name), optional=True)

    client = internal_client_factory(core_api_base, secret, previous_secret=previous_secret, sleep=sleep)
    pauses = [jitter(low, high) for low, high in REPORT_RETRY_PAUSES_S]
    result = client.post(RESULTS_PATH, body, budget_s=budget, retry_pauses=pauses)
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
    profile: str = msg.get("profile", profiles.DEFAULT_PROFILE)
    target: str = msg.get("target", profiles.DEFAULT_TARGET)
    # Each profile has its own prompt version (contract K1); the check is against that one.
    running_version = profiles.prompt_version_for(profile)
    if msg["promptVersion"] != running_version:
        log(
            "warn",
            "ai-qa",
            event="prompt_version_mismatch",
            runId=msg["runId"],
            chunk=msg["chunk"],
            profile=profile,
            requested=msg["promptVersion"],
            running=running_version,
        )

    cfg: Settings | None
    try:
        cfg = settings.load_settings(env)
    except ConfigError as exc:
        cfg = None
        log("error", "ai-qa", event="config_invalid", runId=msg["runId"], chunk=msg["chunk"], reason=str(exc))

    # The reviewer this message asks for; None when its settings cannot produce a model call.
    cfg_used: Settings | None = None
    if cfg is not None:
        try:
            cfg_used = profiles.settings_for(cfg, profile)
        except ConfigError as exc:
            log(
                "error",
                "ai-qa",
                event="profile_config_invalid",
                runId=msg["runId"],
                chunk=msg["chunk"],
                profile=profile,
                reason=str(exc),
            )

    if cfg_used is not None:
        provider, model = cfg_used.provider, cfg_used.model
    elif profile == profiles.AUTOMATION_PROFILE:
        # Never the default reviewer's names: that would mislabel the draft decision.
        provider = (cfg.automation_provider if cfg is not None else None) or "unset"
        model = (cfg.automation_model if cfg is not None else None) or "unset"
    else:
        provider, model = _report_identity(env, cfg)
    namespace = _env_or_default(env, cfg, "METRICS_NAMESPACE", "metrics_namespace")
    core_api_base = _env_or_default(env, cfg, "CORE_API_BASE", "core_api_base")
    secret_name = _env_or_default(env, cfg, "INTERNAL_SECRET_SSM_NAME", "internal_secret_ssm_name")

    secret = settings.get_secret(secret_name)
    if secret is None:
        log("error", "ai-qa", event="internal_secret_missing", runId=msg["runId"], chunk=msg["chunk"])
        _retry_soon(record, msg)
        return False

    # providers.effective_effort, the same value evals records as the gate's reviewer effort.
    report_effort = effective_effort(cfg_used) if cfg_used is not None else None

    def finish(items: list[dict[str, Any]]) -> bool:
        """Report the items. On failure keep them for the redelivery and bring it back soon."""
        if not items:
            return True  # every card was already reported by an earlier delivery of this chunk
        ok = _report(
            msg,
            provider,
            model,
            items,
            secret,
            secret_name,
            core_api_base,
            context,
            target=target,
            profile=profile,
            effort=report_effort,
        )
        if ok:
            _remember_reported(msg, items)
        else:
            _remember_unreported(msg, items)
            _retry_soon(record, msg)
        return ok

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

    if cfg_used is None:
        return finish(fill("CONFIG"))

    try:
        client = _model_client(cfg_used)
    except ConfigError as exc:
        log("error", "ai-qa", event="client_config_invalid", runId=msg["runId"], chunk=msg["chunk"], reason=str(exc))
        return finish(fill("CONFIG"))

    # The effort the reviewer really runs at; never a silent no-op (README, "Other models (Bedrock Converse)").
    effort = effective_effort(cfg_used)
    if effort != cfg_used.effort:
        log(
            "info",
            "ai-qa",
            event="effort_not_sent",
            runId=msg["runId"],
            chunk=msg["chunk"],
            provider=cfg_used.provider,
            model=cfg_used.model,
            configuredEffort=cfg_used.effort,
            effectiveEffort=effort,
        )

    items: list[dict[str, Any]] = []
    for index, card in enumerate(cards):
        if _reported_key(msg, card) in _reported:
            log("info", "ai-qa", event="card_already_reported", runId=msg["runId"], chunk=msg["chunk"], cardId=card["cardId"])
            continue
        pending = _unreported.get(_reported_key(msg, card))
        if pending is not None:
            # Reviewed by an earlier delivery whose report failed: report it again, no second call.
            log("info", "ai-qa", event="card_report_pending", runId=msg["runId"], chunk=msg["chunk"], cardId=card["cardId"])
            items.append(pending)
            continue
        remaining = _remaining_s(context)
        if remaining is not None and remaining < DEADLINE_MARGIN_SECONDS:
            item, calls = _empty_item(card, "error", "PROVIDER_TIMEOUT"), 0
            log("warn", "ai-qa", event="deadline_guard", runId=msg["runId"], chunk=msg["chunk"], cardId=card["cardId"])
        else:
            item, calls = review_card_counted(
                card,
                client=_with_deadline(client, remaining),
                settings=cfg_used,
                review_date=msg["reviewDate"],
                system_prompt=profiles.system_prompt_for(profile),
            )
            if (
                profile == profiles.DEFAULT_PROFILE
                and second_opinion.enabled(cfg_used)
                and item.get("status") == "done"
            ):
                item, second_calls = _second_opinion(msg, card, item, cfg_used, namespace, context)
                calls += second_calls
        emf.emit_item(namespace, cfg_used.provider, item, model_called=calls > 0, effort=effort)
        _log_item(msg, item, effort)

        code = item.get("errorCode")
        if code in RETRYABLE_CODES and _receive_count(record) >= cfg_used.max_receives:
            # Last receive: another failure would send the chunk to the DLQ and leave its cards
            # 'queued' until core's stale reap. Report them with this retryable code instead.
            log("warn", "ai-qa", event="final_receive_giving_up", runId=msg["runId"], chunk=msg["chunk"], errorCode=code)
            items.append(item)
            items.extend(fill(code, start=index + 1))
            return finish(items)
        if code in FAIL_FAST_CODES:
            items.append(item)
            items.extend(fill(code, start=index + 1))
            return finish(items)
        if code in RETRYABLE_CODES:
            # Report what finished (remembered, so the redelivery skips it), then come back soon.
            # A failed report has already scheduled the early redelivery.
            if finish(items):
                _retry_soon(record, msg)
            return False
        items.append(item)

    return finish(items)


def _trace_header(record: object) -> object:
    """The SQS system attribute AWSTraceHeader (H00 §3.3); None when absent or malformed."""
    attributes = record.get("attributes") if isinstance(record, Mapping) else None
    return attributes.get("AWSTraceHeader") if isinstance(attributes, Mapping) else None


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, list[dict[str, str]]]:
    failures: list[dict[str, str]] = []
    for record in (event or {}).get("Records") or []:
        tracectx.bind_upstream(_trace_header(record))
        try:
            message_id = record.get("messageId")
            try:
                ok = _process(record, context, os.environ)
            except Exception as exc:
                log("error", "ai-qa", event="unexpected_error", messageId=message_id, errorClass=type(exc).__name__)
                ok = False
            if not ok:
                failures.append({"itemIdentifier": message_id})
        finally:
            tracectx.clear_upstream()
    return {"batchItemFailures": failures}

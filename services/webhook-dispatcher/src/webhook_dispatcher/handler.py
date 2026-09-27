"""SQS → webhook delivery Lambda entry point (contract §6.5).

Response: {"batchItemFailures": [{"itemIdentifier": <messageId>}, ...]} (ReportBatchItemFailures).
Logs name only the URL's host: webhook URLs often carry their credential in the path.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from . import emf, settings
from .delivery import MAX_ATTEMPTS, RETRY_DELAYS_SECONDS, classify, post_json
from .internal_client import InternalClient
from .logs import log
from .signing import (
    HEADER_DELIVERY,
    HEADER_EVENT,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    USER_AGENT,
    sign_webhook,
)
from .urlguard import URL_REJECTED, check_url

REPORT_PATH = "/api/internal/webhooks/deliveries/report"
SIGNING_SECRET_MISSING = "SIGNING_SECRET_MISSING"
MAX_ERROR_CHARS = 500
REPORT_BUDGET_RESERVE_S = 2.0

# Seams for tests (monkeypatched); production uses the wall clock and the real client.
now = time.time
internal_client_factory = InternalClient


@dataclass(frozen=True)
class Message:
    delivery_id: str
    event_id: str
    event: str
    subscription_id: int
    url: str
    occurred_at: str
    body: str


def _is_uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


def parse_message(raw: Any) -> Message | None:
    """The §6.4 message, or None for any other shape."""
    if not isinstance(raw, str):
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    v = data.get("v")
    sub = data.get("subscriptionId")
    if type(v) is not int or v != 1:
        return None
    if not (_is_uuid(data.get("deliveryId")) and _is_uuid(data.get("eventId"))):
        return None
    if type(sub) is not int:
        return None
    for key in ("event", "url", "occurredAt", "body"):
        if not isinstance(data.get(key), str):
            return None
    return Message(
        delivery_id=data["deliveryId"],
        event_id=data["eventId"],
        event=data["event"],
        subscription_id=sub,
        url=data["url"],
        occurred_at=data["occurredAt"],
        body=data["body"],
    )


def queue_url_from_arn(arn: str) -> str:
    """arn:aws:sqs:<region>:<account>:<name> → https://sqs.<region>.amazonaws.com/<account>/<name>."""
    parts = arn.split(":")
    if len(parts) != 6 or parts[2] != "sqs":
        raise ValueError("not an SQS queue ARN")
    _, _, _, region, account, name = parts
    return f"https://sqs.{region}.amazonaws.com/{account}/{name}"


def _report_budget(context: Any) -> float | None:
    remaining = getattr(context, "get_remaining_time_in_millis", None)
    if not callable(remaining):
        return None
    return max(0.0, remaining() / 1000 - REPORT_BUDGET_RESERVE_S)


def _host_of(url: str) -> str | None:
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


def _process(record: dict[str, Any], context: Any, cfg: settings.Settings) -> bool:
    """Handle one record. True = ack (delete), False = batch item failure."""
    message_id = record.get("messageId")
    msg = parse_message(record.get("body"))
    if msg is None:
        log("warn", "webhook_bad_message", messageId=message_id)
        return True
    n = int(record["attributes"]["ApproximateReceiveCount"])

    host = _host_of(msg.url)
    status_code: int | None = None
    duration_ms = 0
    sent = False
    error: str | None
    kind: str  # delivered | retryable | permanent

    secret = settings.get_secret(cfg.signing_secret_ssm_name)
    if secret is None:
        kind, error = "retryable", SIGNING_SECRET_MISSING
    else:
        guard = check_url(msg.url)
        host = guard.host or host
        if guard.status == "rejected":
            kind, error = "permanent", f"{URL_REJECTED}: {guard.reason}"
        elif guard.status != "ok" or not guard.addresses:
            kind, error = "retryable", "DNS resolution failed"
        else:
            ts = int(now())
            headers = {
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                HEADER_EVENT: msg.event,
                HEADER_DELIVERY: msg.delivery_id,
                HEADER_TIMESTAMP: str(ts),
                HEADER_SIGNATURE: sign_webhook(secret, ts, msg.body),
            }
            result = post_json(
                msg.url,
                msg.body.encode("utf-8"),
                headers,
                cfg.http_timeout_seconds,
                connect_address=guard.addresses[0],
            )
            sent = True
            status_code = result.status
            duration_ms = result.duration_ms
            kind = classify(result)
            if kind == "delivered":
                error = None
            elif result.timed_out:
                error = "timeout"
            elif result.status is not None:
                error = f"HTTP {result.status}"
            else:
                error = result.error or "connection error"

    if kind == "delivered":
        outcome = "delivered"
    elif kind == "retryable":
        outcome = "retry" if n < MAX_ATTEMPTS else "dead"
    else:
        outcome = "failed"

    stop = _report(msg, n, outcome, status_code, duration_ms, error, context, cfg)

    ack = outcome in ("delivered", "failed")
    if outcome == "retry":
        if stop:
            ack = True
        else:
            _delay(record, RETRY_DELAYS_SECONDS[n - 1], msg)

    emf.delivery_attempt(cfg.metrics_namespace, outcome)
    if sent:
        emf.delivery_latency(cfg.metrics_namespace, duration_ms)
    log(
        "info",
        "webhook_delivery",
        deliveryId=msg.delivery_id,
        eventId=msg.event_id,
        event=msg.event,
        subscriptionId=msg.subscription_id,
        host=host,
        attempt=n,
        outcome=outcome,
        statusCode=status_code,
        durationMs=duration_ms,
        stopped=bool(stop and outcome == "retry"),
    )
    return ack


def _delay(record: dict[str, Any], seconds: int, msg: Message) -> None:
    try:
        settings.sqs_client().change_message_visibility(
            QueueUrl=queue_url_from_arn(record["eventSourceARN"]),
            ReceiptHandle=record["receiptHandle"],
            VisibilityTimeout=seconds,
        )
    except Exception as exc:
        log("warn", "webhook_visibility_failed", deliveryId=msg.delivery_id, errorClass=type(exc).__name__)


def _report(
    msg: Message,
    n: int,
    outcome: str,
    status_code: int | None,
    duration_ms: int,
    error: str | None,
    context: Any,
    cfg: settings.Settings,
) -> bool:
    """Report the attempt (§6.5.3). Returns the report's `stop` flag; failures only count."""
    internal_secret = settings.get_secret(cfg.internal_secret_ssm_name)
    if internal_secret is None:
        log("warn", "webhook_report_failed", deliveryId=msg.delivery_id, error="internal secret missing")
        emf.report_failure(cfg.metrics_namespace)
        return False
    payload = {
        "deliveryId": msg.delivery_id,
        "attempt": n,
        "outcome": outcome,
        "statusCode": status_code,
        "durationMs": duration_ms,
        "error": error[:MAX_ERROR_CHARS] if error is not None else None,
    }
    client = internal_client_factory(cfg.core_api_base, internal_secret)
    result = client.post(REPORT_PATH, payload, budget_s=_report_budget(context))
    if not result.ok:
        log(
            "warn",
            "webhook_report_failed",
            deliveryId=msg.delivery_id,
            status=result.status,
            error=result.error,
        )
        emf.report_failure(cfg.metrics_namespace)
        return False
    return bool(result.data and result.data.get("stop") is True)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, list[dict[str, str]]]:
    cfg = settings.load_settings()
    failures: list[dict[str, str]] = []
    for record in (event or {}).get("Records") or []:
        message_id = record.get("messageId") if isinstance(record, dict) else None
        try:
            ack = _process(record, context, cfg)
        except Exception as exc:
            log(
                "error",
                "webhook_unexpected_error",
                messageId=message_id,
                errorClass=type(exc).__name__,
            )
            ack = False
        if not ack:
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}

"""Lambda entry point (contract A00 §12.3): the SQS mail transport and the scheduler's clock.

Core renders every email and does all the tick's work; this function only sends what it is given
to the owner alert address and reports the outcome, or forwards the tick. It never calls a model
and never logs a subject, a body, the recipient or an SES message.
"""

from __future__ import annotations

import json
import random
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable, Mapping
from typing import Any

from . import emf, ses, tracectx
from .internal_client import REPORT_PATH, TICK_PATH, InternalClient
from .logs import log
from .settings import Settings, get_recipient, get_secret, load_settings, previous_secret_name, ses_client

TAG = "notifier"

# The notify queue's redrive maxReceiveCount (A10): the fifth receive is the last one.
MAX_RECEIVES = 5

KINDS = ("exception", "batch_summary", "weekly_digest", "source_changed", "test")
MODES = ("off", "dry_run", "live")
JOBS = ("tick", "digest")
MAX_SUBKIND_LENGTH = 60
MAX_SUBJECT_LENGTH = 200
MAX_TEXT_LENGTH = 100_000

SUBJECT_PREFIX = "[DeveloperCards] "
DRY_RUN_MARKER = "(dry run)"

BAD_MESSAGE = "BAD_MESSAGE"
RECIPIENT_UNSET = "RECIPIENT_UNSET"
ERROR_TEXTS = {
    BAD_MESSAGE: "The SQS message does not match the notification contract (v1).",
    RECIPIENT_UNSET: "The owner alert address is not set in SSM (missing, placeholder or invalid).",
}

# notificationId -> sesMessageId of the emails this container has sent, so a redelivery (for
# example after a failed report or a lost delete) does not send the same email twice.
SENT_CACHE_SIZE = 1000
_sent: OrderedDict[str, str | None] = OrderedDict()

# R18B contract K6: 3 report attempts, each pause drawn from its (low, high) range, so containers that
# failed together do not retry together. NotifierReportFailures only when every attempt failed.
REPORT_RETRY_PAUSES = ((0.5, 1.5), (2.0, 4.0))
# Kept back from the report budget for the function's own return.
REPORT_RESERVE_S = 2.0
# One attempt, under the gateway's 30 s integration timeout; the next tick covers a failure.
TICK_TIMEOUT_S = 28.0

# Seams for tests (monkeypatched).
sleep: Callable[[float], None] = time.sleep
jitter: Callable[[float, float], float] = random.uniform


def _default_client_factory(
    base_url: str, secret: str, *, previous_secret: Callable[[], str | None], timeout_s: float = 10.0
) -> InternalClient:
    return InternalClient(
        base_url, secret, previous_secret=previous_secret, timeout_s=timeout_s, sleep=lambda s: sleep(s)
    )


internal_client_factory: Callable[..., Any] = _default_client_factory


class InternalSecretMissing(RuntimeError):
    pass


def reset_sent_cache() -> None:
    _sent.clear()


def _remember(notification_id: str, message_id: str | None) -> None:
    _sent[notification_id] = message_id
    _sent.move_to_end(notification_id)
    while len(_sent) > SENT_CACHE_SIZE:
        _sent.popitem(last=False)


def _remaining_s(context: Any) -> float | None:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if getter is None:
        return None
    try:
        return int(getter()) / 1000
    except Exception:
        return None


def _receive_count(record: Mapping[str, Any]) -> int:
    attributes = record.get("attributes")
    raw = attributes.get("ApproximateReceiveCount") if isinstance(attributes, Mapping) else None
    try:
        return int(raw) if raw is not None else 1
    except (TypeError, ValueError):
        return 1


def _valid_uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return len(value) == 36


def parse_message(body: Any) -> tuple[dict[str, Any] | None, str | None]:
    """(message, notificationId) for a valid A00 §12.5 message, else (None, the id when it is a UUID)."""
    try:
        msg = json.loads(body) if isinstance(body, str) else None
    except ValueError:
        msg = None
    if not isinstance(msg, dict):
        return None, None
    notification_id = msg.get("notificationId") if _valid_uuid(msg.get("notificationId")) else None
    v, kind, subkind = msg.get("v"), msg.get("kind"), msg.get("subkind")
    subject, text, mode = msg.get("subject"), msg.get("text"), msg.get("mode")
    valid = (
        notification_id is not None
        and v == 1
        and not isinstance(v, bool)
        and kind in KINDS
        and (subkind is None or (isinstance(subkind, str) and len(subkind) <= MAX_SUBKIND_LENGTH))
        and isinstance(subject, str)
        and 1 <= len(subject) <= MAX_SUBJECT_LENGTH
        and isinstance(text, str)
        and len(text) <= MAX_TEXT_LENGTH
        and mode in MODES
    )
    if not valid:
        return None, notification_id
    return {
        "notificationId": notification_id,
        "kind": kind,
        "subkind": subkind,
        "subject": subject,
        "text": text,
        "mode": mode,
    }, notification_id


def mark_dry_run(subject: str) -> str:
    """Insert "(dry run) " after the "[DeveloperCards] " prefix (or prepend both)."""
    if subject.startswith(SUBJECT_PREFIX):
        return SUBJECT_PREFIX + DRY_RUN_MARKER + " " + subject[len(SUBJECT_PREFIX) :]
    return SUBJECT_PREFIX + DRY_RUN_MARKER + " " + subject


def _client(settings: Settings, secret: str, *, timeout_s: float | None = None) -> Any:
    previous_name = previous_secret_name(settings.internal_secret_ssm_name)
    kwargs: dict[str, Any] = {"previous_secret": lambda: get_secret(previous_name, optional=True)}
    if timeout_s is not None:
        kwargs["timeout_s"] = timeout_s
    return internal_client_factory(settings.core_api_base, secret, **kwargs)


def _report(
    settings: Settings,
    client: Any,
    context: Any,
    *,
    notification_id: str,
    status: str,
    attempt: int,
    ses_message_id: str | None = None,
    error_code: str | None = None,
    error: str | None = None,
) -> bool:
    """POST the outcome to core. A failure is counted and logged; it never changes what was sent."""
    payload = {
        "v": 1,
        "notificationId": notification_id,
        "status": status,
        "sesMessageId": ses_message_id,
        "errorCode": error_code,
        "error": error,
        "attempt": attempt,
    }
    remaining = _remaining_s(context)
    budget = remaining - REPORT_RESERVE_S if remaining is not None else None
    pauses = [jitter(low, high) for low, high in REPORT_RETRY_PAUSES]
    result = client.post(REPORT_PATH, payload, budget_s=budget, retry_pauses=pauses)
    if not result.ok:
        emf.report_failure(settings.metrics_namespace)
        log(
            "warn",
            TAG,
            event="report_failed",
            notificationId=notification_id,
            status=status,
            httpStatus=result.status,
            error=result.error,
        )
        return False
    return True


def _handle_record(settings: Settings, record: Mapping[str, Any], context: Any) -> bool:
    """Process one SQS record. True = ack, False = batch item failure (redeliver)."""
    attempt = max(_receive_count(record), 1)
    msg, notification_id = parse_message(record.get("body"))
    secret = get_secret(settings.internal_secret_ssm_name)

    if msg is None:
        log("warn", TAG, event="bad_message", notificationId=notification_id, attempt=attempt)
        if notification_id is not None and secret is not None:
            _report(
                settings,
                _client(settings, secret),
                context,
                notification_id=notification_id,
                status=ses.FAILED,
                attempt=attempt,
                error_code=BAD_MESSAGE,
                error=ERROR_TEXTS[BAD_MESSAGE],
            )
        return True

    fields = {
        "notificationId": msg["notificationId"],
        "kind": msg["kind"],
        "subkind": msg["subkind"],
        "mode": msg["mode"],
        "attempt": attempt,
    }
    if secret is None:
        # Sending without being able to report would make core resend and duplicate the email.
        log("error", TAG, event="internal_secret_missing", **fields)
        return False
    client = _client(settings, secret)

    if msg["notificationId"] in _sent:
        message_id = _sent[msg["notificationId"]]
        log("info", TAG, event="already_sent", status=ses.SENT, sesMessageId=message_id, **fields)
        _report(
            settings,
            client,
            context,
            notification_id=msg["notificationId"],
            status=ses.SENT,
            attempt=attempt,
            ses_message_id=message_id,
        )
        return True

    subject = msg["subject"]
    if msg["mode"] == "dry_run" and DRY_RUN_MARKER not in subject:
        subject = mark_dry_run(subject)
        log("warn", TAG, event="dry_run_marker_added", **fields)

    recipient = get_recipient(settings.notify_recipient_ssm_name)
    if recipient is None:
        log("error", TAG, event="notification_failed", status=ses.FAILED, errorCode=RECIPIENT_UNSET, **fields)
        emf.failure(settings.metrics_namespace, RECIPIENT_UNSET)
        _report(
            settings,
            client,
            context,
            notification_id=msg["notificationId"],
            status=ses.FAILED,
            attempt=attempt,
            error_code=RECIPIENT_UNSET,
            error=ERROR_TEXTS[RECIPIENT_UNSET],
        )
        return True

    result = ses.send(
        ses_client(),
        from_address=settings.notify_from,
        recipient=recipient,
        subject=subject,
        text=msg["text"],
        configuration_set=settings.ses_configuration_set,
        kind=msg["kind"],
        mode=msg["mode"],
        sleep=sleep,
    )

    if result.status == ses.SENT:
        _remember(msg["notificationId"], result.message_id)
        log("info", TAG, event="notification_sent", status=ses.SENT, sesMessageId=result.message_id, **fields)
        emf.sent(settings.metrics_namespace, msg["kind"])
        _report(
            settings,
            client,
            context,
            notification_id=msg["notificationId"],
            status=ses.SENT,
            attempt=attempt,
            ses_message_id=result.message_id,
        )
        return True

    if result.status == ses.RETRY and attempt < MAX_RECEIVES:
        log("warn", TAG, event="notification_retry", status=ses.RETRY, errorCode=result.error_code, **fields)
        return False

    # Permanent failure, or the last receive of a retryable one.
    log("error", TAG, event="notification_failed", status=ses.FAILED, errorCode=result.error_code, **fields)
    emf.failure(settings.metrics_namespace, result.error_code or "UnknownError")
    _report(
        settings,
        client,
        context,
        notification_id=msg["notificationId"],
        status=ses.FAILED,
        attempt=attempt,
        error_code=result.error_code,
        error=result.error,
    )
    return True


def _trace_header(record: object) -> object:
    """The SQS system attribute AWSTraceHeader (H00 §3.3); None when absent or malformed."""
    attributes = record.get("attributes") if isinstance(record, Mapping) else None
    return attributes.get("AWSTraceHeader") if isinstance(attributes, Mapping) else None


def _handle_sqs(settings: Settings, records: list[Any], context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []
    for record in records:
        tracectx.bind_upstream(_trace_header(record))
        try:
            record = record if isinstance(record, Mapping) else {}
            message_id = record.get("messageId")
            try:
                acked = _handle_record(settings, record, context)
            except Exception as exc:
                log("error", TAG, event="record_error", messageId=message_id, errorClass=type(exc).__name__)
                acked = False
            if not acked and isinstance(message_id, str):
                failures.append({"itemIdentifier": message_id})
        finally:
            tracectx.clear_upstream()
    return {"batchItemFailures": failures}


def _failed_steps(data: Mapping[str, Any]) -> list[str]:
    """Core's "failedSteps" (R18B contract K4): the names of swallowed automation failures."""
    raw = data.get("failedSteps")
    return [step for step in raw if isinstance(step, str)] if isinstance(raw, list) else []


def _handle_job(settings: Settings, job: str) -> dict[str, Any]:
    if job == "tick":
        # The heartbeat the tick-missing alarm watches: SQS email deliveries never emit it.
        emf.tick(settings.metrics_namespace)
    secret = get_secret(settings.internal_secret_ssm_name)
    if secret is None:
        emf.tick_failure(settings.metrics_namespace)
        log("error", TAG, event="internal_secret_missing", job=job)
        raise InternalSecretMissing("internal secret missing")

    tick_id = str(uuid.uuid4())
    client = _client(settings, secret, timeout_s=TICK_TIMEOUT_S)
    result = client.post(TICK_PATH, {"v": 1, "tickId": tick_id, "job": job}, retry_pauses=())
    if not result.ok:
        emf.tick_failure(settings.metrics_namespace)
        log("error", TAG, event="tick_failed", job=job, tickId=tick_id, status=result.status, error=result.error)
        raise RuntimeError(f"tick failed: {result.error}")

    data = result.data or {}
    raw_actions = data.get("actions")
    actions = (
        {
            key: value
            for key, value in raw_actions.items()
            if isinstance(key, str) and isinstance(value, int) and not isinstance(value, bool)
        }
        if isinstance(raw_actions, dict)
        else {}
    )
    skipped = data.get("skipped") if isinstance(data.get("skipped"), str) else None
    failed_steps = _failed_steps(data)

    def text(value: Any) -> str | None:
        return value if isinstance(value, str) else None

    log(
        "info",
        TAG,
        event="tick_ok",
        job=job,
        tickId=tick_id,
        mode=text(data.get("mode")),
        effectiveMode=text(data.get("effectiveMode")),
        skipped=skipped,
        actions=actions,
        failedSteps=failed_steps,
    )
    if failed_steps:
        # Core answered 200 but swallowed these failures; its AutomationStepFailures alarm counts them.
        log("warn", TAG, event="tick_steps_failed", job=job, tickId=tick_id, failedSteps=failed_steps)
    return {"tickId": tick_id, "skipped": skipped, "actions": actions, "failedSteps": failed_steps}


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    settings = load_settings()
    if isinstance(event, dict) and isinstance(event.get("Records"), list):
        return _handle_sqs(settings, event["Records"], context)
    if isinstance(event, dict) and event.get("job") in JOBS:
        return _handle_job(settings, event["job"])
    log("info", TAG, event="ignored_event")
    return {"ignored": True}

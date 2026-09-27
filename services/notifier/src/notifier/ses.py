"""One plain-text email through Amazon SES v2 SendEmail (contract A00 §12.2, §12.3).

The outcome is one of three statuses: "sent" (SES accepted it), "failed" (sending again will not
help; core records the code) or "retry" (a throttle, a server error or a connection problem; the
SQS message is redelivered). The error text is fixed per code and never the SES message, because
SES messages can quote the recipient address.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

SENT = "sent"
FAILED = "failed"
RETRY = "retry"

THROTTLE_CODE = "TooManyRequestsException"
# Two more attempts after the first throttle, this far apart (SES sandbox: 1 message/s).
THROTTLE_RETRIES = 2
THROTTLE_PAUSE_S = 1.1

# Codes that sending again cannot fix (A00 §12.3).
PERMANENT_CODES = (
    "LimitExceededException",
    "SendingPausedException",
    "AccountSuspendedException",
    "MessageRejected",
    "MailFromDomainNotVerifiedException",
    "NotFoundException",
    "BadRequestException",
)

# botocore's transport errors, matched by class name so this module needs no botocore import.
CONNECTION_ERRORS = (
    "EndpointConnectionError",
    "ConnectTimeoutError",
    "ReadTimeoutError",
    "ConnectionClosedError",
)

MAX_ERROR_CODE_LENGTH = 60
MAX_ERROR_LENGTH = 300

ERROR_TEXTS: dict[str, str] = {
    THROTTLE_CODE: "SES throttled the send (sending rate exceeded).",
    "LimitExceededException": "SES sending quota exceeded.",
    "SendingPausedException": "Sending is paused for the configuration set or the account.",
    "AccountSuspendedException": "The SES account is suspended.",
    "MessageRejected": "SES rejected the message (in the sandbox: an identity is not verified yet).",
    "MailFromDomainNotVerifiedException": "The sending domain is not verified in SES yet (DKIM pending).",
    "NotFoundException": "An SES resource (identity or configuration set) was not found.",
    "BadRequestException": "SES rejected the request as invalid.",
    "AccessDeniedException": "The notifier role is not allowed to send (no ses:SendEmail grant yet).",
    "EndpointConnectionError": "Could not connect to the SES endpoint.",
    "ConnectTimeoutError": "Connecting to SES timed out.",
    "ReadTimeoutError": "SES did not answer in time.",
    "ConnectionClosedError": "The SES connection was closed early.",
}


@dataclass(frozen=True)
class SendResult:
    status: str
    message_id: str | None
    error_code: str | None
    error: str | None


def _safe_code(code: Any) -> str:
    text = re.sub(r"[^A-Za-z0-9_.:-]", "", code if isinstance(code, str) else "")
    return text[:MAX_ERROR_CODE_LENGTH] or "UnknownError"


def error_text(code: str, http_status: int | None = None) -> str:
    """A fixed description of the code; never text that came from SES."""
    text = ERROR_TEXTS.get(code)
    if text is None:
        suffix = f" (HTTP {http_status})" if http_status else ""
        text = f"SES send failed with {code}{suffix}."
    return text[:MAX_ERROR_LENGTH]


def _client_error(exc: BaseException) -> tuple[str, int | None] | None:
    """(code, HTTP status) of a botocore ClientError, else None."""
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return None
    error = response.get("Error")
    if not isinstance(error, dict):
        return None
    meta = response.get("ResponseMetadata")
    status = meta.get("HTTPStatusCode") if isinstance(meta, dict) else None
    return _safe_code(error.get("Code")), status if isinstance(status, int) else None


def _result(status: str, code: str, http_status: int | None = None) -> SendResult:
    return SendResult(status, None, code, error_text(code, http_status))


def send(
    client: Any,
    *,
    from_address: str,
    recipient: str,
    subject: str,
    text: str,
    configuration_set: str,
    kind: str,
    mode: str,
    sleep: Callable[[float], None] = time.sleep,
) -> SendResult:
    """Send one email. Unexpected (non-SES, non-transport) exceptions propagate to the caller."""
    throttles = 0
    while True:
        try:
            response = client.send_email(
                FromEmailAddress=from_address,
                Destination={"ToAddresses": [recipient]},
                Content={
                    "Simple": {
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {"Text": {"Data": text, "Charset": "UTF-8"}},
                    }
                },
                ConfigurationSetName=configuration_set,
                EmailTags=[{"Name": "kind", "Value": kind}, {"Name": "mode", "Value": mode}],
            )
        except Exception as exc:
            name = type(exc).__name__
            if name in CONNECTION_ERRORS:
                return _result(RETRY, name)
            parsed = _client_error(exc)
            if parsed is None:
                raise
            code, http_status = parsed
            if code == THROTTLE_CODE:
                if throttles < THROTTLE_RETRIES:
                    throttles += 1
                    sleep(THROTTLE_PAUSE_S)
                    continue
                return _result(RETRY, code, http_status)
            if code in PERMANENT_CODES:
                return _result(FAILED, code, http_status)
            if http_status is not None and http_status >= 500:
                return _result(RETRY, code, http_status)
            return _result(FAILED, code, http_status)
        message_id = response.get("MessageId") if isinstance(response, dict) else None
        return SendResult(SENT, message_id if isinstance(message_id, str) else None, None, None)

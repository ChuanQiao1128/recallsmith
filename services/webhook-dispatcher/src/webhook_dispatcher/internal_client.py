"""Signed calls to core-vpc's internal routes (contract §4.3).

Server side: Auth.VerifyInternalSignature — timestamp in epoch milliseconds, skew ±5 min,
signature "v1=" + lowercase hex HMAC-SHA256(secret, f"{ts}.{body}").

Retryable: a connection error, any 5xx and 429 (the route's throttle). Secret rotation: when core
answers 401/403 to the current secret, the previous secret is loaded (only then) and, when one
exists, the same request is sent once more signed with it, so signing never depends on which side
flips first.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from . import tracectx

HEADER_TIMESTAMP = "x-internal-timestamp"
HEADER_SIGNATURE = "x-internal-signature"

# Default schedule: one retry after 1 s. Callers with more time pass a longer retry_pauses.
RETRY_PAUSE_S = 1.0
MIN_ATTEMPT_BUDGET_S = 2.0
MAX_RESPONSE_BYTES = 256 * 1024


def canonical_body(payload: Any) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True, sort_keys=True)


def sign_internal(secret: str, timestamp_ms: int, body: str) -> str:
    message = f"{timestamp_ms}.{body}".encode("utf-8")
    return "v1=" + hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class InternalResult:
    ok: bool
    status: int | None
    data: dict[str, Any] | None
    error: str | None


def is_retryable_status(status: int) -> bool:
    return status == 429 or 500 <= status < 600


def _now_ms() -> int:
    return int(time.time() * 1000)


class InternalClient:
    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        previous_secret: Callable[[], str | None] | None = None,
        timeout_s: float = 10.0,
        sleep: Callable[[float], None] = time.sleep,
        clock_ms: Callable[[], int] = _now_ms,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._previous_secret = previous_secret
        self._timeout_s = timeout_s
        self._sleep = sleep
        self._clock_ms = clock_ms

    def post(
        self,
        path: str,
        payload: Any,
        *,
        budget_s: float | None = None,
        retry_pauses: Sequence[float] = (RETRY_PAUSE_S,),
    ) -> InternalResult:
        """POST a signed JSON payload. Never raises.

        A retryable failure is tried again after each pause in retry_pauses (default: once after
        1 s) while the budget allows another attempt.
        """
        try:
            body = canonical_body(payload)
        except (TypeError, ValueError) as exc:
            return InternalResult(False, None, None, f"payload not serialisable: {type(exc).__name__}")
        deadline_ms = self._clock_ms() + budget_s * 1000 if budget_s is not None else None

        secret = self._secret
        result = InternalResult(False, None, None, "not attempted")
        pauses = [0.0, *retry_pauses]
        attempted = False
        index = 0
        while index < len(pauses):
            if index > 0 and pauses[index] > 0:
                self._sleep(pauses[index])
            timeout = self._timeout_s
            if deadline_ms is not None:
                remaining = (deadline_ms - self._clock_ms()) / 1000
                if remaining < MIN_ATTEMPT_BUDGET_S:
                    if not attempted:
                        return InternalResult(False, None, None, "budget exhausted")
                    return result
                timeout = min(self._timeout_s, remaining - 1)
            result, retryable = self._attempt(path, body, timeout, secret)
            attempted = True
            if result.status in (401, 403) and secret == self._secret:
                # Rotation window: core may still hold the other value. Retry at once, without
                # spending a pause, signed with the previous secret.
                previous = self._load_previous()
                if previous is not None:
                    secret = previous
                    pauses[index] = 0.0
                    continue
            if not retryable:
                return result
            index += 1
        return result

    def _load_previous(self) -> str | None:
        if self._previous_secret is None:
            return None
        try:
            previous = self._previous_secret()
        except Exception:
            return None
        return previous if previous and previous != self._secret else None

    def _attempt(self, path: str, body: str, timeout: float, secret: str) -> tuple[InternalResult, bool]:
        ts = self._clock_ms()
        headers = {
            "content-type": "application/json",
            HEADER_TIMESTAMP: str(ts),
            HEADER_SIGNATURE: sign_internal(secret, ts, body),
        }
        root = tracectx.current_root()
        if root is not None:
            headers[tracectx.HEADER] = root
        request = urllib.request.Request(
            self._base_url + path,
            data=body.encode("ascii"),
            method="POST",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.status
                raw = response.read(MAX_RESPONSE_BYTES)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            return InternalResult(False, status, None, f"HTTP {status}"), is_retryable_status(status)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
            name = type(reason).__name__ if isinstance(reason, BaseException) else type(exc).__name__
            return InternalResult(False, None, None, f"connection error: {name}"), True
        except Exception as exc:
            return InternalResult(False, None, None, f"unexpected error: {type(exc).__name__}"), False

        if not 200 <= status < 300:
            return InternalResult(False, status, None, f"HTTP {status}"), is_retryable_status(status)
        try:
            envelope = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return InternalResult(False, status, None, "invalid envelope"), False
        if not isinstance(envelope, dict) or envelope.get("success") is not True:
            return InternalResult(False, status, None, "envelope success is not true"), False
        data = envelope.get("data")
        return InternalResult(True, status, data if isinstance(data, dict) else None, None), False

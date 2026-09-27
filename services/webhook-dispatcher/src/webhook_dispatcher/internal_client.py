"""Signed calls to core-vpc's internal routes (contract §4.3).

Server side: Auth.VerifyInternalSignature — timestamp in epoch milliseconds, skew ±5 min,
signature "v1=" + lowercase hex HMAC-SHA256(secret, f"{ts}.{body}").
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

HEADER_TIMESTAMP = "x-internal-timestamp"
HEADER_SIGNATURE = "x-internal-signature"

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


def _now_ms() -> int:
    return int(time.time() * 1000)


class InternalClient:
    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        timeout_s: float = 10.0,
        sleep: Callable[[float], None] = time.sleep,
        clock_ms: Callable[[], int] = _now_ms,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout_s = timeout_s
        self._sleep = sleep
        self._clock_ms = clock_ms

    def post(self, path: str, payload: Any, *, budget_s: float | None = None) -> InternalResult:
        """POST a signed JSON payload. Never raises; one retry after 1 s on connection error or 5xx."""
        try:
            body = canonical_body(payload)
        except (TypeError, ValueError) as exc:
            return InternalResult(False, None, None, f"payload not serialisable: {type(exc).__name__}")
        deadline_ms = self._clock_ms() + budget_s * 1000 if budget_s is not None else None

        result = InternalResult(False, None, None, "not attempted")
        for attempt in (1, 2):
            if attempt == 2:
                self._sleep(RETRY_PAUSE_S)
            timeout = self._timeout_s
            if deadline_ms is not None:
                remaining = (deadline_ms - self._clock_ms()) / 1000
                if remaining < MIN_ATTEMPT_BUDGET_S:
                    if attempt == 1:
                        return InternalResult(False, None, None, "budget exhausted")
                    return result
                timeout = min(self._timeout_s, remaining - 1)
            result, retryable = self._attempt(path, body, timeout)
            if not retryable:
                return result
        return result

    def _attempt(self, path: str, body: str, timeout: float) -> tuple[InternalResult, bool]:
        ts = self._clock_ms()
        request = urllib.request.Request(
            self._base_url + path,
            data=body.encode("ascii"),
            method="POST",
            headers={
                "content-type": "application/json",
                HEADER_TIMESTAMP: str(ts),
                HEADER_SIGNATURE: sign_internal(self._secret, ts, body),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.status
                raw = response.read(MAX_RESPONSE_BYTES)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            return InternalResult(False, status, None, f"HTTP {status}"), 500 <= status < 600
        except (urllib.error.URLError, OSError, ValueError) as exc:
            reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
            name = type(reason).__name__ if isinstance(reason, BaseException) else type(exc).__name__
            return InternalResult(False, None, None, f"connection error: {name}"), True
        except Exception as exc:
            return InternalResult(False, None, None, f"unexpected error: {type(exc).__name__}"), False

        if not 200 <= status < 300:
            return InternalResult(False, status, None, f"HTTP {status}"), 500 <= status < 600
        try:
            envelope = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return InternalResult(False, status, None, "invalid envelope"), False
        if not isinstance(envelope, dict) or envelope.get("success") is not True:
            return InternalResult(False, status, None, "envelope success is not true"), False
        data = envelope.get("data")
        return InternalResult(True, status, data if isinstance(data, dict) else None, None), False

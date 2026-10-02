"""R25X F04: deletes the RevenueCat customer record of a deleted account (contract R25-00 §4, revised).

core-vpc has no egress, so it only queues the Cognito sub (the RevenueCat app_user_id) when an account is deleted. On
every tick the notifier, which runs outside the VPC, reads the pending subs from core, calls
DELETE https://api.revenuecat.com/v1/subscribers/{sub} with the secret API key from SSM and reports each status back;
core removes a row on 2xx or 404 and counts an attempt otherwise.

Never logged: the key, a sub, a URL or a RevenueCat response body. Log lines carry counts only.
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

from .internal_client import REVENUECAT_PENDING_PATH, REVENUECAT_REPORT_PATH
from .logs import log

TAG = "notifier"
EVENT = "revenuecat_delete"

# SecureString, created by the owner; read lazily like notify-recipient. Absent (or unreadable) skips the whole step.
KEY_SSM_NAME = "/developercards/prod/revenuecat-secret-api-key"
API_BASE = "https://api.revenuecat.com"
TIMEOUT_S = 5.0
PENDING_LIMIT = 50
# Time kept back for the report and the function's own return before another RevenueCat call is started.
REPORT_RESERVE_S = 12.0

# Seam for tests: urllib.request.urlopen.
urlopen: Callable[..., Any] = urllib.request.urlopen


def subscriber_url(sub: str) -> str:
    return f"{API_BASE}/v1/subscribers/{urllib.parse.quote(sub, safe='')}"


def delete_subscriber(sub: str, key: str) -> int | None:
    """The HTTP status RevenueCat answered, or None on a timeout or any other error. Never raises."""
    request = urllib.request.Request(
        subscriber_url(sub),
        method="DELETE",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=TIMEOUT_S) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        exc.close()
        return status
    except Exception:
        # Timeout, DNS, refused/reset connection, TLS: no status. The text may echo the URL, so it is not logged.
        return None


def _outcome(status: int | None) -> str:
    if status is not None and (200 <= status < 300 or status == 404):
        return "deleted" if status != 404 else "not_found"
    return "failed"


def run(client: Any, key: str | None, remaining_s: Callable[[], float | None]) -> dict[str, int | str]:
    """One pass over the pending subs. Returns (and logs) counts only. Never raises."""
    if key is None:
        log("info", TAG, event=EVENT, outcome="skipped_no_key")
        return {"outcome": "skipped_no_key"}

    pending = client.get(f"{REVENUECAT_PENDING_PATH}?limit={PENDING_LIMIT}")
    raw = (pending.data or {}).get("subs") if pending.ok else None
    if not isinstance(raw, list):
        log("warn", TAG, event=EVENT, outcome="pending_failed", status=pending.status, error=pending.error)
        return {"outcome": "pending_failed"}
    subs = [sub for sub in raw if isinstance(sub, str) and sub]

    results: list[dict[str, Any]] = []
    counts = {"deleted": 0, "not_found": 0, "failed": 0}
    for sub in subs:
        left = remaining_s()
        if left is not None and left < TIMEOUT_S + REPORT_RESERVE_S:
            break  # the rest stays pending for the next tick
        status = delete_subscriber(sub, key)
        counts[_outcome(status)] += 1
        results.append({"sub": sub, "status": status})

    reported = True
    if results:
        left = remaining_s()
        report = client.post(
            REVENUECAT_REPORT_PATH,
            results,
            budget_s=left - 2.0 if left is not None else None,
            retry_pauses=(1.0,),
        )
        reported = bool(report.ok)
        if not reported:
            log("warn", TAG, event=EVENT, outcome="report_failed", status=report.status, error=report.error)

    summary: dict[str, int | str] = {
        "outcome": "done",
        "pending": len(subs),
        "deferred": len(subs) - len(results),
        "reported": int(reported),
        **counts,
    }
    log("warn" if counts["failed"] or not reported else "info", TAG, event=EVENT, **summary)
    return summary

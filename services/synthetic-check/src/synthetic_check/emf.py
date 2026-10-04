"""The one CloudWatch Embedded Metric Format line per synthetic run (H00 §5.2)."""

from __future__ import annotations

import json
import sys
import time
from typing import Any

from . import tracectx
from .checks import CheckResult

SERVICE = "synthetic-check"

SUCCESS = "SyntheticCheckSuccess"
LATENCY = "SyntheticCheckLatency"


def _check_entry(result: CheckResult) -> dict[str, Any]:
    """`{ok, status, ms, code}`, plus `detail` (a fixed rule id, checks.DETAILS) when the check set one."""
    entry: dict[str, Any] = {"ok": result.ok, "status": result.status, "ms": result.ms, "code": result.code}
    if result.detail is not None:
        entry["detail"] = result.detail
    return entry


def run_line(namespace: str, results: list[CheckResult], latency_ms: int, *, timestamp_ms: int | None = None) -> None:
    """Print exactly one EMF line: success 1 only when every check passed. Never raises.

    Carries check names, statuses, durations, codes and rule ids only: never a URL, body or header value.
    """
    try:
        ok = bool(results) and all(r.ok for r in results)
        line: dict[str, Any] = {
            "_aws": {
                "Timestamp": timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": namespace,
                        "Dimensions": [["Service"]],
                        "Metrics": [
                            {"Name": SUCCESS, "Unit": "Count"},
                            {"Name": LATENCY, "Unit": "Milliseconds"},
                        ],
                    }
                ],
            },
            "Service": SERVICE,
            SUCCESS: 1 if ok else 0,
            LATENCY: max(0, int(latency_ms)),
            "failedChecks": [r.name for r in results if not r.ok],
            "checks": {r.name: _check_entry(r) for r in results},
        }
        root = tracectx.current_root()
        if root is not None:
            line["xrayTraceId"] = root
        sys.stdout.write(json.dumps(line, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except Exception:
        return

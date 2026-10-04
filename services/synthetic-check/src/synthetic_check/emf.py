"""The one CloudWatch Embedded Metric Format line per synthetic run (H00 §5.2)."""

from __future__ import annotations

import json
import sys
import time
from typing import Any

from . import tracectx
from .checks import ADVISORY_CHECKS, CheckResult

SERVICE = "synthetic-check"

SUCCESS = "SyntheticCheckSuccess"
LATENCY = "SyntheticCheckLatency"
# One success metric per advisory check (checks.ADVISORY_CHECKS), each read by its own alarm (infra alarms_r28.tf).
ADVISORY_METRICS = {"remote-config": "SyntheticRemoteConfigSuccess"}


def core_ok(results: list[CheckResult]) -> bool:
    """SyntheticCheckSuccess and the handler's `ok`: every check except the advisory ones passed."""
    core = [r for r in results if r.name not in ADVISORY_CHECKS]
    return bool(core) and all(r.ok for r in core)


def _check_entry(result: CheckResult) -> dict[str, Any]:
    """`{ok, status, ms, code}`, plus `detail` (a fixed rule id, checks.DETAILS) when the check set one."""
    entry: dict[str, Any] = {"ok": result.ok, "status": result.status, "ms": result.ms, "code": result.code}
    if result.detail is not None:
        entry["detail"] = result.detail
    return entry


def run_line(namespace: str, results: list[CheckResult], latency_ms: int, *, timestamp_ms: int | None = None) -> None:
    """Print exactly one EMF line. Never raises.

    SyntheticCheckSuccess is 1 only when every check other than the advisory ones passed; each advisory check
    has its own 0/1 metric (ADVISORY_METRICS), written only when the run has a result for it. `failedChecks`
    lists every failed check, advisory ones included. Carries check names, statuses, durations, codes and rule
    ids only: never a URL, body or header value.
    """
    try:
        by_name = {r.name: r for r in results}
        advisory = {metric: by_name[name].ok for name, metric in ADVISORY_METRICS.items() if name in by_name}
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
                            *({"Name": metric, "Unit": "Count"} for metric in advisory),
                        ],
                    }
                ],
            },
            "Service": SERVICE,
            SUCCESS: 1 if core_ok(results) else 0,
            LATENCY: max(0, int(latency_ms)),
            **{metric: 1 if passed else 0 for metric, passed in advisory.items()},
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

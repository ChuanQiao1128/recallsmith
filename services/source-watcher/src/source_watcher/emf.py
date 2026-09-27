"""CloudWatch Embedded Metric Format lines (contract A00 §10.7), RouteMetrics shape."""

from __future__ import annotations

import json
import sys
import time

SERVICE = "source-watcher"

CHECKS = "SourceWatchChecks"
LATENCY = "SourceWatchLatency"
REPORT_FAILURES = "SourceWatchReportFailures"
# M6: one per source-watch invocation; the source-watch-missing alarm fires when none arrive.
RUNS = "SourceWatchRuns"


def emit(
    namespace: str,
    name: str,
    value: float,
    unit: str,
    dimensions: dict[str, str] | None = None,
    *,
    timestamp_ms: int | None = None,
) -> None:
    """Print one EMF line for one data point. Never raises."""
    try:
        dims = {"Service": SERVICE, **(dimensions or {})}
        line = {
            "_aws": {
                "Timestamp": timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": namespace,
                        "Dimensions": [list(dims.keys())],
                        "Metrics": [{"Name": name, "Unit": unit}],
                    }
                ],
            },
            **dims,
            name: value,
        }
        sys.stdout.write(json.dumps(line, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except Exception:
        return


def check(namespace: str, outcome: str) -> None:
    """One observation; Outcome = the observation status."""
    emit(namespace, CHECKS, 1, "Count", {"Outcome": outcome})


def latency(namespace: str, duration_ms: int) -> None:
    """Only when a request was sent."""
    emit(namespace, LATENCY, duration_ms, "Milliseconds")


def report_failure(namespace: str) -> None:
    emit(namespace, REPORT_FAILURES, 1, "Count")


def run(namespace: str) -> None:
    """The per-invocation heartbeat (M6)."""
    emit(namespace, RUNS, 1, "Count")

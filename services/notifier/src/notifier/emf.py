"""CloudWatch Embedded Metric Format lines (contract A00 §12.3), RouteMetrics shape."""

from __future__ import annotations

import json
import sys
import time

SERVICE = "notifier"

SENT = "NotificationsSent"
FAILURES = "NotificationFailures"
REPORT_FAILURES = "NotifierReportFailures"
TICK_FAILURES = "AutomationTickFailures"


def emit(
    namespace: str,
    name: str,
    value: float,
    unit: str,
    dimensions: dict[str, str] | None = None,
    *,
    dimension_sets: list[list[str]] | None = None,
    timestamp_ms: int | None = None,
) -> None:
    """Print one EMF line for one data point. Never raises.

    dimension_sets defaults to one set holding Service plus every key of dimensions; a metric that
    must also be readable per Service alone passes several sets (one line, several aggregations).
    """
    try:
        dims = {"Service": SERVICE, **(dimensions or {})}
        line = {
            "_aws": {
                "Timestamp": timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": namespace,
                        "Dimensions": dimension_sets if dimension_sets is not None else [list(dims.keys())],
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


def sent(namespace: str, kind: str) -> None:
    emit(namespace, SENT, 1, "Count", {"Kind": kind})


def failure(namespace: str, error_code: str) -> None:
    """The Service-only set feeds A10's notification_failures alarm; the other splits by code."""
    emit(
        namespace,
        FAILURES,
        1,
        "Count",
        {"ErrorCode": error_code},
        dimension_sets=[["Service"], ["Service", "ErrorCode"]],
    )


def report_failure(namespace: str) -> None:
    emit(namespace, REPORT_FAILURES, 1, "Count")


def tick_failure(namespace: str) -> None:
    emit(namespace, TICK_FAILURES, 1, "Count")

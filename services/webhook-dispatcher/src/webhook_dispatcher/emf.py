"""CloudWatch Embedded Metric Format lines (contract §6.5.4), RouteMetrics shape."""

from __future__ import annotations

import json
import sys
import time

SERVICE = "webhook-dispatcher"

DELIVERY_ATTEMPTS = "WebhookDeliveryAttempts"
DELIVERY_LATENCY = "WebhookDeliveryLatency"
REPORT_FAILURES = "WebhookReportFailures"

OUTCOMES = ("delivered", "retry", "failed", "dead")


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


def delivery_attempt(namespace: str, outcome: str) -> None:
    emit(namespace, DELIVERY_ATTEMPTS, 1, "Count", {"Outcome": outcome})


def delivery_latency(namespace: str, duration_ms: int) -> None:
    emit(namespace, DELIVERY_LATENCY, duration_ms, "Milliseconds")


def report_failure(namespace: str) -> None:
    emit(namespace, REPORT_FAILURES, 1, "Count")

"""CloudWatch Embedded Metric Format lines (contract §7.8), RouteMetrics envelope shape."""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Mapping
from typing import Any

SERVICE = "ai-qa"

CARDS_REVIEWED = "AiQaCardsReviewed"
LATENCY = "AiQaLatency"
INPUT_TOKENS = "AiQaInputTokens"
OUTPUT_TOKENS = "AiQaOutputTokens"
CACHE_READ_TOKENS = "AiQaCacheReadTokens"
ESTIMATED_COST_MICRO_USD = "AiQaEstimatedCostMicroUsd"
FINDINGS = "AiQaFindings"
ERRORS = "AiQaErrors"
REFUSALS = "AiQaRefusals"

# The bounded ErrorCode dimension (contract §7.5). Anything else is dropped, never emitted.
ERROR_CODES = frozenset(
    {
        "PROVIDER_ACCESS_DENIED",
        "PROVIDER_AUTH",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_ERROR",
        "PROVIDER_TIMEOUT",
        "SCHEMA_INVALID",
        "MAX_TOKENS",
        "REFUSAL",
        "DISABLED",
        "CONFIG",
    }
)

SEVERITIES = ("blocker", "major", "minor")


def emit(
    namespace: str,
    metrics: Mapping[str, tuple[float, str]],
    dimensions: Mapping[str, str] | None = None,
    *,
    timestamp_ms: int | None = None,
) -> None:
    """Print one EMF line carrying every metric in `metrics` ({name: (value, unit)}). Never raises."""
    try:
        dims = {"Service": SERVICE, **(dimensions or {})}
        line: dict[str, Any] = {
            "_aws": {
                "Timestamp": timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
                "CloudWatchMetrics": [
                    {
                        "Namespace": namespace,
                        "Dimensions": [list(dims.keys())],
                        "Metrics": [{"Name": name, "Unit": unit} for name, (_, unit) in metrics.items()],
                    }
                ],
            },
            **dims,
        }
        for name, (value, _) in metrics.items():
            line[name] = value
        sys.stdout.write(json.dumps(line, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except Exception:
        return


def _count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def emit_item(namespace: str, provider: str, item: Mapping[str, Any], *, model_called: bool) -> None:
    """All EMF lines for one result item. Never raises."""
    try:
        if model_called:
            usage = item.get("usage") or {}
            cost = item.get("estimatedCostUsd") or 0.0
            emit(
                namespace,
                {
                    CARDS_REVIEWED: (1 if item.get("status") == "done" else 0, "Count"),
                    LATENCY: (_count(item.get("latencyMs")), "Milliseconds"),
                    INPUT_TOKENS: (_count(usage.get("inputTokens")), "Count"),
                    OUTPUT_TOKENS: (_count(usage.get("outputTokens")), "Count"),
                    CACHE_READ_TOKENS: (_count(usage.get("cacheReadInputTokens")), "Count"),
                    ESTIMATED_COST_MICRO_USD: (int(round(float(cost) * 1_000_000)), "Count"),
                },
                {"Provider": provider},
            )
        counts = {severity: 0 for severity in SEVERITIES}
        for finding in item.get("findings") or []:
            severity = finding.get("severity")
            if severity in counts:
                counts[severity] += 1
        for severity in SEVERITIES:
            if counts[severity] > 0:
                emit(namespace, {FINDINGS: (counts[severity], "Count")}, {"Severity": severity})
        code = item.get("errorCode")
        if code is not None and code in ERROR_CODES:
            emit(namespace, {ERRORS: (1, "Count")}, {"ErrorCode": code})
        if item.get("status") == "refused":
            emit(namespace, {REFUSALS: (1, "Count")})
    except Exception:
        return

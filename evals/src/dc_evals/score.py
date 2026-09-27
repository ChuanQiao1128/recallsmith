"""Scoring (contract §12.1): recall, precision, F1, control false-positive rate, latency, errors, cost."""

from __future__ import annotations

import math
from collections import Counter
from typing import Any

from .dataset import DEFECT_CLASSES

RECALL_GATE = 0.80
PRECISION_GATE = 0.70

ACCEPTED_CATEGORIES = {
    "incorrect_answer": {"incorrect_answer"},
    "multiple_correct": {"multiple_correct"},
    "answer_leak": {"answer_leak"},
    "ambiguous_stem": {"ambiguous_stem"},
    "outdated_fact": {"outdated_fact", "incorrect_answer"},
    "qualifier_mismatch": {"qualifier_mismatch", "ambiguous_stem"},
}

SERIOUS_SEVERITIES = frozenset({"blocker", "major"})


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def f1(precision: float, recall: float) -> float:
    return round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0


def serious_findings(record: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in record.get("findings") or [] if f.get("severity") in SERIOUS_SEVERITIES]


def is_flagged(record: dict[str, Any]) -> bool:
    """Flagged = at least one blocker or major finding."""
    return bool(serious_findings(record))


def is_true_positive(record: dict[str, Any]) -> bool:
    """A defective record flagged by a blocker/major finding in its class's accepted set."""
    if record.get("status") != "done":
        return False
    accepted = ACCEPTED_CATEGORIES[record["defect"]]
    return any(f.get("category") in accepted for f in serious_findings(record))


def nearest_rank(values: list[int], q: float) -> int:
    """sorted[ceil(q*n) - 1]; 0 for an empty list."""
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(math.ceil(q * len(ordered)) - 1, 0)]


def score(records: list[dict[str, Any]]) -> dict[str, Any]:
    """The report's metric blocks plus flaggedWrongCategory (Markdown summary only)."""
    per_class: dict[str, dict[str, Any]] = {}
    tp_total = fn_total = fp = controls = wrong_category = 0
    for defect in DEFECT_CLASSES:
        tp = fn = 0
        for record in records:
            if record.get("defect") != defect:
                continue
            if is_true_positive(record):
                tp += 1
            else:
                fn += 1
                if record.get("status") == "done" and is_flagged(record):
                    wrong_category += 1
        per_class[defect] = {"tp": tp, "fn": fn, "recall": ratio(tp, tp + fn)}
        tp_total += tp
        fn_total += fn
    for record in records:
        if record.get("defect") is None:
            controls += 1
            if record.get("status") == "done" and is_flagged(record):
                fp += 1
    recall = ratio(tp_total, tp_total + fn_total)
    precision = ratio(tp_total, tp_total + fp)
    raw_recall = tp_total / (tp_total + fn_total) if tp_total + fn_total else 0.0
    raw_precision = tp_total / (tp_total + fp) if tp_total + fp else 0.0
    latencies = [int(r["latencyMs"]) for r in records if (r.get("latencyMs") or 0) > 0]
    errors = Counter(r["errorCode"] for r in records if r.get("errorCode"))
    return {
        "n": len(records),
        "estimatedCostUsd": round(sum(float(r.get("estimatedCostUsd") or 0.0) for r in records), 6),
        "perClass": per_class,
        "overall": {
            "tp": tp_total,
            "fp": fp,
            "fn": fn_total,
            "recall": recall,
            "precision": precision,
            "f1": f1(raw_precision, raw_recall),
            "controlFalsePositiveRate": ratio(fp, controls),
        },
        "latencyMs": {"p50": nearest_rank(latencies, 0.50), "p95": nearest_rank(latencies, 0.95)},
        "errors": dict(sorted(errors.items())),
        "flaggedWrongCategory": wrong_category,
    }


def gate_passes(report: dict[str, Any]) -> bool:
    """recall >= RECALL_GATE and precision >= PRECISION_GATE overall; a run with no items fails."""
    if not report.get("n"):
        return False
    overall = report["overall"]
    return overall["recall"] >= RECALL_GATE and overall["precision"] >= PRECISION_GATE

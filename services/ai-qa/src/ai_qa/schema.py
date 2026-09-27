"""What the model returns (contract §7.6). Length limits are applied client-side (review.py)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Severity = Literal["blocker", "major", "minor"]
Category = Literal[
    "incorrect_answer",
    "multiple_correct",
    "answer_leak",
    "ambiguous_stem",
    "outdated_fact",
    "qualifier_mismatch",
    "source_unsupported",
    "weak_distractor",
    "other",
]

SEVERITIES: tuple[str, ...] = ("blocker", "major", "minor")
CATEGORIES: tuple[str, ...] = (
    "incorrect_answer",
    "multiple_correct",
    "answer_leak",
    "ambiguous_stem",
    "outdated_fact",
    "qualifier_mismatch",
    "source_unsupported",
    "weak_distractor",
    "other",
)


class ModelFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Severity
    category: Category
    message: str
    suggestedFix: str | None


class ModelReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: list[ModelFinding]

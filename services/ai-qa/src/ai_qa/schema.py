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

# The rubric in prompts.py says "the category fixes the severity". The model still returns a
# severity (the schema and prompt are unchanged), but the stored severity always comes from this
# table: the publish gate (blocker) and card.flagged (blocker/major) key on it.
CATEGORY_SEVERITY: dict[str, str] = {
    "incorrect_answer": "blocker",
    "multiple_correct": "blocker",
    "answer_leak": "major",
    "ambiguous_stem": "major",
    "outdated_fact": "major",
    "qualifier_mismatch": "major",
    "source_unsupported": "major",
    "weak_distractor": "minor",
    "other": "minor",
}


class ModelFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Severity
    category: Category
    message: str
    suggestedFix: str | None


class ModelReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: list[ModelFinding]

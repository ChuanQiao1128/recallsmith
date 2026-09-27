"""Paths and JSONL helpers. Every path resolves from the package root (evals/), never the cwd."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

EVALS_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = EVALS_ROOT / "data"
REPORTS_DIR = EVALS_ROOT / "reports"

DECKS = ("aws-saa-c03", "claude-ccdv-f")
DATASET_NAME = "seeded-v1"
SEEDED_PATH = DATA_DIR / f"{DATASET_NAME}.jsonl"
MUTATIONS_PATH = DATA_DIR / "mutations-v1.json"

# The six defect classes in the fixed seeding order (contract §12.1).
DEFECT_CLASSES = (
    "incorrect_answer",
    "multiple_correct",
    "answer_leak",
    "ambiguous_stem",
    "outdated_fact",
    "qualifier_mismatch",
)


def cards_path(deck_slug: str) -> Path:
    return DATA_DIR / f"cards-{deck_slug}.jsonl"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def dump_line(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"


def load_exported_cards() -> dict[str, list[dict[str, Any]]]:
    """The exported cards per deck, in file order."""
    return {slug: read_jsonl(cards_path(slug)) for slug in DECKS}


def load_mutations(path: Path = MUTATIONS_PATH) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_dataset(path: Path = SEEDED_PATH) -> list[dict[str, Any]]:
    return read_jsonl(path)


def card_of(exported: dict[str, Any]) -> dict[str, Any]:
    """An exported card without sourceUid/deckSlug: the QaCard fields the reviewer sees."""
    return {key: value for key, value in exported.items() if key not in ("sourceUid", "deckSlug")}

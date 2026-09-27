"""Paths and JSONL helpers. Every path resolves from the package root (evals/), never the cwd."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EVALS_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = EVALS_ROOT / "data"
REPORTS_DIR = EVALS_ROOT / "reports"

DECKS = ("aws-saa-c03", "claude-ccdv-f")
DATASET_NAME = "seeded-v1"
SEEDED_PATH = DATA_DIR / f"{DATASET_NAME}.jsonl"
MUTATIONS_PATH = DATA_DIR / "mutations-v1.json"

# The six seeded-v1 defect classes in the fixed seeding order (contract §12.1).
DEFECT_CLASSES_V1 = (
    "incorrect_answer",
    "multiple_correct",
    "answer_leak",
    "ambiguous_stem",
    "outdated_fact",
    "qualifier_mismatch",
)
# seeded-v2 adds source_unsupported (the rubric's "does the source support the answer" check).
DEFECT_CLASSES = (*DEFECT_CLASSES_V1, "source_unsupported")


@dataclass(frozen=True)
class DatasetSpec:
    """One committed dataset version: its rows file, mutation templates and defect classes."""

    key: str
    name: str
    path: Path
    mutations_path: Path
    classes: tuple[str, ...]


DATASETS = {
    "v1": DatasetSpec("v1", DATASET_NAME, SEEDED_PATH, MUTATIONS_PATH, DEFECT_CLASSES_V1),
    "v2": DatasetSpec(
        "v2", "seeded-v2", DATA_DIR / "seeded-v2.jsonl", DATA_DIR / "mutations-v2.json", DEFECT_CLASSES
    ),
}
DATASETS_BY_NAME = {spec.name: spec for spec in DATASETS.values()}


def classes_for(dataset_name: str | None) -> tuple[str, ...]:
    """The defect classes a dataset seeds; every class for an unknown or missing name."""
    spec = DATASETS_BY_NAME.get(dataset_name or "")
    return spec.classes if spec else DEFECT_CLASSES


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources_path(deck_slug: str) -> Path:
    return DATA_DIR / f"sources-{deck_slug}.jsonl"


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

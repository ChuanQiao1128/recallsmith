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
# seeded-v1 is frozen; deck corrections made after its cut keep their v1-era text here.
V1_PINS_PATH = DATA_DIR / "seeded-v1-pins.json"

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
    mutations_path: Path | None
    classes: tuple[str, ...]
    # authored-v1 only: the jury labels file joined onto the authored rows (load_rows).
    labels_path: Path | None = None


DATASETS = {
    "v1": DatasetSpec("v1", DATASET_NAME, SEEDED_PATH, MUTATIONS_PATH, DEFECT_CLASSES_V1),
    "v2": DatasetSpec(
        "v2", "seeded-v2", DATA_DIR / "seeded-v2.jsonl", DATA_DIR / "mutations-v2.json", DEFECT_CLASSES
    ),
    # Y05: no surface cues, source-silent fact swaps, adjudicated judgment classes (seed.build_rows_v3).
    "v3": DatasetSpec(
        "v3", "seeded-v3", DATA_DIR / "seeded-v3.jsonl", DATA_DIR / "mutations-v3.json", DEFECT_CLASSES
    ),
}
# Q03: agent-authored cards labeled by a model jury (author.py, jury.py). Not seeded, so not in
# DATASETS (`seed` never builds it); `run` and `score` load it through RUN_DATASETS / load_rows.
AUTHORED_SOURCES_PATH = DATA_DIR / "authored-sources-v1.json"
AUTHORED_LABELS_PATH = DATA_DIR / "authored-v1.labels.jsonl"
AUTHORED = DatasetSpec(
    "authored-v1",
    "authored-v1",
    DATA_DIR / "authored-v1.jsonl",
    None,
    DEFECT_CLASSES,
    labels_path=AUTHORED_LABELS_PATH,
)
# R18A (A15): the automation gate's agent-authored set, 60 sources (A00 §15.2); same shape as
# authored-v1, labeled by the same jury.
AUTHORED_V2_SOURCES_PATH = DATA_DIR / "authored-sources-v2.json"
AUTHORED_V2_LABELS_PATH = DATA_DIR / "authored-v2.labels.jsonl"
AUTHORED_V2 = DatasetSpec(
    "authored-v2",
    "authored-v2",
    DATA_DIR / "authored-v2.jsonl",
    None,
    DEFECT_CLASSES,
    labels_path=AUTHORED_V2_LABELS_PATH,
)
# R18B (B06): authored-v2 has two strata. "docs" rows come from `dc-evals author` (the single-shot,
# tool-less author over established documentation pages, data/authored-sources-v2.json); a row
# without a "stratum" key is a docs row. "new-facts" rows are drafts the production authoring path
# wrote (the author-runner's queue-item prompt, CLAUDE args and the author-cards skill with its
# tools and verifier, against a sandbox deck) from the announcement and release-notes pages of
# data/authored-sources-v2-new-facts.json, imported with `dc-evals import-drafts`.
STRATUM_DOCS = "docs"
STRATUM_NEW_FACTS = "new-facts"
STRATA = (STRATUM_DOCS, STRATUM_NEW_FACTS)
AUTHORED_V2_NEW_FACTS_SOURCES_PATH = DATA_DIR / "authored-sources-v2-new-facts.json"
RUN_DATASETS = {**DATASETS, AUTHORED.key: AUTHORED, AUTHORED_V2.key: AUTHORED_V2}
DATASETS_BY_NAME = {spec.name: spec for spec in RUN_DATASETS.values()}


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


def load_v1_cards(pins_path: Path = V1_PINS_PATH) -> dict[str, list[dict[str, Any]]]:
    """The exported cards with every seeded-v1 pin applied: the decks as seeded-v1 was cut from them."""
    exported = load_exported_cards()
    index = {(slug, card["sourceUid"]): card for slug, cards in exported.items() for card in cards}
    with pins_path.open(encoding="utf-8") as fh:
        pins = json.load(fh)["pins"]
    for pin in pins:
        card = index[(pin["deck"], pin["uid"])]
        for field, value in pin["fields"].items():
            if field not in card or field in ("sourceUid", "deckSlug", "stableUid", "source"):
                raise ValueError(f"seeded-v1 pin {pin['deck']}/{pin['uid']}: cannot pin field {field!r}")
            card[field] = value
    return exported


def load_mutations(path: Path = MUTATIONS_PATH) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_dataset(path: Path = SEEDED_PATH) -> list[dict[str, Any]]:
    return read_jsonl(path)


def stratum_of(row: dict[str, Any]) -> str:
    """The authored-v2 stratum of an authored row (STRATUM_DOCS when the row names none)."""
    return row.get("stratum") or STRATUM_DOCS


def spec_exists(spec: DatasetSpec) -> bool:
    return spec.path.exists() and (spec.labels_path is None or spec.labels_path.exists())


def load_rows(spec: DatasetSpec) -> list[dict[str, Any]]:
    """The rows `run` reviews: the dataset file itself, or for authored-v1 the authored rows joined
    with their jury labels (jury.dataset_rows: excluded and not scorable rows are left out)."""
    if spec.labels_path is None:
        return load_dataset(spec.path)
    from .jury import dataset_rows

    return dataset_rows(read_jsonl(spec.path), read_jsonl(spec.labels_path))


def spec_sha256(spec: DatasetSpec) -> str:
    """sha256 of the dataset file; for authored-v1, of the authored file's bytes followed by the
    labels file's bytes (a new jury run changes the dataset)."""
    if spec.labels_path is None:
        return file_sha256(spec.path)
    return hashlib.sha256(spec.path.read_bytes() + spec.labels_path.read_bytes()).hexdigest()


def card_of(exported: dict[str, Any]) -> dict[str, Any]:
    """An exported card without sourceUid/deckSlug: the QaCard fields the reviewer sees."""
    return {key: value for key, value in exported.items() if key not in ("sourceUid", "deckSlug")}

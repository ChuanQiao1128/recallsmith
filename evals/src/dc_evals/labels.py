"""Label provenance of the constructed judgment-class rows and the owner's human adjudication
(Z04, ai-agent-27).

The seeded-v3 multiple_correct, ambiguous_stem and qualifier_mismatch rows come from constructions
in mutations-v3.json that were written and adjudicated in a model-assisted session (Y05); no
independent human has reviewed them. Their labels are therefore recorded as model-assisted, and a
row an owner later adjudicates carries that verdict.

How an ambiguous_stem or qualifier_mismatch defect is evidenced:
- "self-evidenced": the card still says, in the viable option's why (or the explanation), the
  criterion that makes that option viable (rationale.evidence.text is in that field). Every
  seeded-v3 row is built this way (mutations.apply_constructed_ambiguous_stem refuses any other),
  and the reviewer prompt names exactly that inconsistency as a sign, so recall on these rows
  shows the reviewer applies that rule, not that it finds ambiguity no why points to.
- "why-neutral": no field of the card states that evidence any more (a why rewritten to reject the
  option on a requirement the stem still states, or a construction without a citing why). A future
  dataset version adds such rows; the report shows their recall separately and the gate holds them
  to the per-class floor on their own.

The adjudication file, data/adjudications-<dataset key>.json:

    {
      "format": 1,
      "dataset": "seeded-v3",
      "datasetSha256": "<sha256 of data/seeded-v3.jsonl>",
      "labelSource": "model-assisted",
      "labelSourceNote": "...",
      "verdicts": [
        {"id": "s-0147", "verdict": "valid" | "invalid", "adjudicator": "<who>",
         "date": "YYYY-MM-DD", "note": "<why>"}
      ]
    }

Only rows of LABELED_CLASSES take a verdict, each at most once. The scorer drops a row judged
"invalid" from every recall figure and from its class's distinct-card count (so a class that
loses a row falls under MIN_CLASS_CARDS and needs a new dataset version).
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from .dataset import DATA_DIR, DATASETS_BY_NAME, EVALS_ROOT, DatasetSpec, file_sha256, load_dataset
from .mutations import CONSTRUCTED_CLASSES

LABELED_CLASSES = CONSTRUCTED_CLASSES
EVIDENCED_CLASSES = ("ambiguous_stem", "qualifier_mismatch")
SELF_EVIDENCED = "self-evidenced"
WHY_NEUTRAL = "why-neutral"
EVIDENCE_TIERS = (SELF_EVIDENCED, WHY_NEUTRAL)
VERDICTS = ("valid", "invalid")
ADJUDICATION_FORMAT = 1


def adjudications_path(spec: DatasetSpec) -> Path:
    return DATA_DIR / f"adjudications-{spec.key}.json"


def _evidence_source(row: dict[str, Any], evidence: dict[str, Any]) -> str:
    card = row["card"]
    if evidence.get("field") == "why":
        for option in (card.get("mcq") or {}).get("options") or []:
            if option.get("key") == evidence.get("option"):
                return option.get("why") or ""
        return ""
    return str(card.get(str(evidence.get("field"))) or "")


def row_evidence(row: dict[str, Any]) -> str | None:
    """SELF_EVIDENCED or WHY_NEUTRAL for an ambiguous_stem / qualifier_mismatch row; None for any
    other row."""
    if row.get("defect") not in EVIDENCED_CLASSES:
        return None
    evidence = (row.get("rationale") or {}).get("evidence")
    if not isinstance(evidence, dict) or not evidence.get("text"):
        return WHY_NEUTRAL
    return SELF_EVIDENCED if evidence["text"] in _evidence_source(row, evidence) else WHY_NEUTRAL


def load_adjudications(spec: DatasetSpec, path: Path | None = None) -> dict[str, Any] | None:
    """The validated adjudication file for spec (None when it does not exist). Raises ValueError
    when it names another dataset, a row that is not a judgment-class row, an unknown verdict, a
    row twice, or a verdict without adjudicator and date."""
    path = path or adjudications_path(spec)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != ADJUDICATION_FORMAT or data.get("dataset") != spec.name:
        raise ValueError(f"{path}: not a format-{ADJUDICATION_FORMAT} adjudication file for {spec.name}")
    if data.get("datasetSha256") != file_sha256(spec.path):
        raise ValueError(f"{path}: datasetSha256 does not match {spec.path.name}; the verdicts are for another file")
    if not isinstance(data.get("labelSource"), str) or not isinstance(data.get("verdicts"), list):
        raise ValueError(f"{path}: needs labelSource and a verdicts list")
    defects = {row["id"]: row["defect"] for row in load_dataset(spec.path)}
    seen: set[str] = set()
    for entry in data["verdicts"]:
        row_id = entry.get("id")
        if row_id not in defects:
            raise ValueError(f"{path}: {row_id!r} is not a row of {spec.name}")
        if defects[row_id] not in LABELED_CLASSES:
            raise ValueError(f"{path}: {row_id} is not a judgment-class row ({', '.join(LABELED_CLASSES)})")
        if row_id in seen:
            raise ValueError(f"{path}: {row_id} is adjudicated twice")
        seen.add(row_id)
        if entry.get("verdict") not in VERDICTS:
            raise ValueError(f"{path}: {row_id}: verdict must be one of {', '.join(VERDICTS)}")
        if not isinstance(entry.get("adjudicator"), str) or not entry["adjudicator"].strip():
            raise ValueError(f"{path}: {row_id}: adjudicator is required")
        try:
            dt.date.fromisoformat(str(entry.get("date")))
        except ValueError:
            raise ValueError(f"{path}: {row_id}: date must be YYYY-MM-DD") from None
    return data


def labels_for(
    dataset_name: str | None, dataset_sha256: str | None, adjudications: Path | None = None
) -> dict[str, Any] | None:
    """Provenance of every judgment-class row of a committed dataset, keyed by row id, plus the
    label source; None when the run's dataset is not the committed file or has no adjudication
    file (seeded-v1 and seeded-v2 have none)."""
    spec = DATASETS_BY_NAME.get(dataset_name or "")
    if spec is None or not spec.path.exists() or dataset_sha256 != file_sha256(spec.path):
        return None
    data = load_adjudications(spec, adjudications)
    if data is None:
        return None
    verdicts = {entry["id"]: entry["verdict"] for entry in data["verdicts"]}
    source_path = adjudications or adjudications_path(spec)
    try:
        shown = str(source_path.resolve().relative_to(EVALS_ROOT))
    except ValueError:
        shown = str(source_path)
    return {
        "source": data["labelSource"],
        "note": data.get("labelSourceNote"),
        "adjudicationFile": shown,
        "rows": {
            row["id"]: {"defect": row["defect"], "evidence": row_evidence(row), "humanVerdict": verdicts.get(row["id"])}
            for row in load_dataset(spec.path)
            if row["defect"] in LABELED_CLASSES
        },
    }

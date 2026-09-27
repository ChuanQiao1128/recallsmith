"""Z04 (ai-agent-27): label provenance of the constructed judgment-class rows and the owner's
human-adjudication file. Nothing here calls a model."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import gate_header, gate_records, item

from dc_evals.dataset import DATASETS, file_sha256, load_dataset
from dc_evals.labels import (
    SELF_EVIDENCED,
    WHY_NEUTRAL,
    adjudications_path,
    labels_for,
    load_adjudications,
    row_evidence,
)
from dc_evals.report import build_report, render_markdown
from dc_evals.score import gate_failures

V3 = DATASETS["v3"]


def v3_rows() -> list[dict]:
    return load_dataset(V3.path)


def adjudication_file(tmp_path: Path, verdicts: list[dict], **overrides) -> Path:
    body = json.loads(adjudications_path(V3).read_text(encoding="utf-8"))
    path = tmp_path / "adjudications-v3.json"
    path.write_text(json.dumps({**body, **overrides, "verdicts": verdicts}), encoding="utf-8")
    return path


def verdict(row_id: str, value: str) -> dict:
    return {"id": row_id, "verdict": value, "adjudicator": "owner", "date": "2026-10-01", "note": "n"}


def test_every_committed_ambiguous_stem_and_qualifier_mismatch_row_is_self_evidenced() -> None:
    """The finding: every such row keeps, in the viable option's why (or the explanation), the
    criterion that makes that option viable. The provenance says so for every row, and says the
    labels are model-assisted with no human verdict yet."""
    labels = labels_for(V3.name, file_sha256(V3.path))
    assert labels is not None and labels["source"] == "model-assisted"
    rows = labels["rows"]
    by_class: dict[str, list[dict]] = {}
    for row in v3_rows():
        if row["id"] in rows:
            by_class.setdefault(row["defect"], []).append(rows[row["id"]])
    assert {c: len(v) for c, v in by_class.items()} == {
        "multiple_correct": 15, "ambiguous_stem": 15, "qualifier_mismatch": 15
    }
    for defect in ("ambiguous_stem", "qualifier_mismatch"):
        assert {entry["evidence"] for entry in by_class[defect]} == {SELF_EVIDENCED}, defect
    assert {entry["evidence"] for entry in by_class["multiple_correct"]} == {None}
    assert all(entry["humanVerdict"] is None for entry in rows.values())
    s0019 = next(r for r in v3_rows() if r["id"] == "s-0019")
    assert s0019["defect"] == "ambiguous_stem" and row_evidence(s0019) == SELF_EVIDENCED


def test_a_row_whose_card_text_no_longer_states_the_evidence_is_why_neutral() -> None:
    row = next(r for r in v3_rows() if r["defect"] == "ambiguous_stem")
    viable = row["rationale"]["evidence"]["option"]
    for option in row["card"]["mcq"]["options"]:
        if option["key"] == viable:
            option["why"] = "It fails the stated requirement that the stem still names."
    assert row_evidence(row) == WHY_NEUTRAL
    qm = next(r for r in v3_rows() if r["defect"] == "qualifier_mismatch")
    assert row_evidence({**qm, "rationale": {**qm["rationale"], "evidence": None}}) == WHY_NEUTRAL
    control = next(r for r in v3_rows() if r["defect"] is None)
    assert row_evidence(control) is None


def test_the_report_records_label_provenance_per_judgment_class() -> None:
    report = build_report(gate_header(), gate_records())
    labels = report["labels"]
    assert labels["source"] == "model-assisted"
    assert labels["perClass"]["ambiguous_stem"] == {
        "rows": 15, "selfEvidenced": 15, "whyNeutral": 0, "humanValid": 0, "humanInvalid": 0, "unadjudicated": 15
    }
    assert labels["perClass"]["multiple_correct"]["unadjudicated"] == 15
    assert labels["perEvidence"]["qualifier_mismatch"][SELF_EVIDENCED]["tp"] == 30
    assert labels["perEvidence"]["qualifier_mismatch"][WHY_NEUTRAL]["tp"] == 0
    assert labels["excludedRows"] == []
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "## Label provenance" in markdown and "model-assisted" in markdown
    assert "| ambiguous_stem | 15 | 15 | 0 | 0 | 0 |" in markdown
    # A run on a dataset without an adjudication file (v2) carries no provenance.
    from conftest import dataset_records

    assert build_report(gate_header("v2", reps=1), dataset_records("v2"))["labels"] is None


def test_a_human_invalid_verdict_drops_the_row_from_scoring(tmp_path: Path) -> None:
    rows = v3_rows()
    ambiguous = [r["id"] for r in rows if r["defect"] == "ambiguous_stem"]
    path = adjudication_file(
        tmp_path, [verdict(ambiguous[0], "invalid")] + [verdict(i, "valid") for i in ambiguous[1:5]]
    )
    records = gate_records(misses={"ambiguous_stem": 1})  # the first ambiguous_stem row is missed
    before = build_report(gate_header(), records)
    after = build_report(gate_header(), records, adjudications=path)
    assert before["perClass"]["ambiguous_stem"] == {**before["perClass"]["ambiguous_stem"], "tp": 28, "fn": 2}
    assert (after["perClass"]["ambiguous_stem"]["tp"], after["perClass"]["ambiguous_stem"]["fn"]) == (28, 0)
    assert after["labels"]["excludedRows"] == [ambiguous[0]]
    assert after["labels"]["perClass"]["ambiguous_stem"] == {
        "rows": 15, "selfEvidenced": 15, "whyNeutral": 0, "humanValid": 4, "humanInvalid": 1, "unadjudicated": 10
    }
    assert after["unitOfAnalysis"]["cards"]["perClass"]["ambiguous_stem"] == 14
    assert "class ambiguous_stem has 14 distinct cards, fewer than 15" in after["gate"]["failures"]
    assert after["n"] == before["n"] == 452


def test_the_why_neutral_tier_is_under_the_class_floor() -> None:
    """A why-neutral row counts in its class like any other, and its tier must reach the per-class
    floor on its own, so self-evidenced rows cannot carry it."""
    records = gate_records()
    labels = labels_for(V3.name, file_sha256(V3.path))
    ambiguous = [r["id"] for r in v3_rows() if r["defect"] == "ambiguous_stem"]
    for row_id in ambiguous[:3]:
        labels["rows"][row_id] = {**labels["rows"][row_id], "evidence": WHY_NEUTRAL}
    missed = set(ambiguous[:2])
    records = [
        item("ambiguous_stem", [], index=int(r["id"][2:]), rep=r["rep"]) if r["id"] in missed else r for r in records
    ]
    report = build_report(gate_header(), records, labels=labels)
    assert report["perClass"]["ambiguous_stem"]["recall"] == 0.8667
    assert report["labels"]["perEvidence"]["ambiguous_stem"][WHY_NEUTRAL]["recall"] == 0.3333
    assert gate_failures(report) == ["class ambiguous_stem why-neutral tier recall 0.3333 < 0.60"]
    assert "| ambiguous_stem | why-neutral | 2 | 4 | 0.3333 |" in render_markdown(report, flagged_wrong_category=0)


@pytest.mark.parametrize(
    ("verdicts", "overrides", "message"),
    [
        ([verdict("s-0019", "maybe")], {}, "verdict"),
        ([{"id": "s-0019", "verdict": "valid"}], {}, "adjudicator"),
        ([verdict("s-9999", "valid")], {}, "not a row"),
        ([verdict("s-0019", "valid"), verdict("s-0019", "invalid")], {}, "twice"),
        ([], {"datasetSha256": "0" * 64}, "datasetSha256"),
    ],
)
def test_an_adjudication_file_is_validated(tmp_path: Path, verdicts, overrides, message) -> None:
    path = adjudication_file(tmp_path, verdicts, **overrides)
    with pytest.raises(ValueError, match=message):
        load_adjudications(V3, path)


def test_a_verdict_on_a_row_outside_the_judgment_classes_is_refused(tmp_path: Path) -> None:
    control = next(r["id"] for r in v3_rows() if r["defect"] is None)
    with pytest.raises(ValueError, match="judgment-class"):
        load_adjudications(V3, adjudication_file(tmp_path, [verdict(control, "invalid")]))


def test_the_committed_adjudication_file_matches_the_dataset() -> None:
    data = load_adjudications(V3)
    assert data is not None
    assert data["dataset"] == "seeded-v3" and data["datasetSha256"] == file_sha256(V3.path)
    assert data["labelSource"] == "model-assisted" and data["verdicts"] == []


def test_score_cli_takes_an_adjudication_file(tmp_path: Path, capsys) -> None:
    from dc_evals.cli import main

    rows = v3_rows()
    target = next(r["id"] for r in rows if r["defect"] == "qualifier_mismatch")
    records = gate_records()
    run = tmp_path / "run.jsonl"
    run.write_text("".join(json.dumps(line) + "\n" for line in [gate_header(), *records]), encoding="utf-8")
    path = adjudication_file(tmp_path, [verdict(target, "invalid")])
    assert main(["score", str(run), "--adjudications", str(path)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["labels"]["excludedRows"] == [target]
    assert report["perClass"]["qualifier_mismatch"]["tp"] == 28

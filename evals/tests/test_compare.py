"""Q03 `dc-evals compare`: the report schema, the jury caveat and the file names. Hand-built run
files only: no model."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import finding, gate_header, gate_records, item

from dc_evals.cli import main
from dc_evals.compare import JURY_NOTE, build_compare, vendor_of

ROW_KEYS = {
    "runFile",
    "configuration",
    "provider",
    "model",
    "secondProvider",
    "secondModel",
    "promptVersion",
    "dataset",
    "reps",
    "n",
    "recall",
    "recallCi95",
    "precision",
    "controlFalsePositiveRate",
    "controlFalsePositiveRateCi95",
    "precisionAtPrevalence",
    "estimatedCostUsd",
    "estimatedCostPerCardUsd",
    "juryCaveat",
}


def write_run(path: Path, header: dict, records: list[dict]) -> Path:
    path.write_text("".join(json.dumps(line) + "\n" for line in [header, *records]), encoding="utf-8")
    return path


def authored_records() -> list[dict]:
    return [
        item("incorrect_answer", [finding("blocker", "incorrect_answer")], index=1, cost=0.02),
        item("outdated_fact", [], index=2, cost=0.02),
        item(None, [], index=3, cost=0.02),
        item(None, [finding("major", "ambiguous_stem")], index=4, cost=0.02),
    ]


def runs(tmp_path: Path) -> list[Path]:
    seeded = gate_records(reps=1)
    authored = authored_records()
    return [
        write_run(tmp_path / "opus-seeded.jsonl", gate_header(reps=1, n=len(seeded)), seeded),
        write_run(
            tmp_path / "opus-second-authored.jsonl",
            gate_header(
                reps=1,
                n=len(authored),
                dataset="authored-v1",
                datasetSha256="0" * 64,
                secondProvider="bedrock-converse",
                secondModel="mistral.mistral-large-3",
            ),
            authored,
        ),
        write_run(
            tmp_path / "qwen-authored.jsonl",
            gate_header(
                reps=1,
                n=len(authored),
                provider="bedrock-converse",
                model="qwen.qwen3-235b-a22b-2507-v1:0",
                dataset="authored-v1",
                datasetSha256="0" * 64,
            ),
            authored,
        ),
    ]


SUMMARY = {
    "jurors": [
        "bedrock-converse:qwen.qwen3-235b-a22b-2507-v1:0",
        "bedrock-converse:deepseek.v3.2",
        "bedrock-converse:global.moonshotai.kimi-k3",
    ],
    "labeled": 4,
    "excluded": {"tie": 1, "all_unsure": 0},
    "notScorable": 0,
    "unanimityRate": 0.75,
}


def test_compare_report_schema(tmp_path: Path) -> None:
    data = build_compare(runs(tmp_path), name="q03", date="2026-09-27", jury_summary=SUMMARY)
    assert set(data) == {"v", "name", "date", "labelsNote", "costNote", "rows"}
    assert data["v"] == 1 and data["labelsNote"] == JURY_NOTE
    assert [(r["dataset"], r["configuration"]) for r in data["rows"]] == [
        ("authored-v1", "bedrock-converse:qwen.qwen3-235b-a22b-2507-v1:0"),
        ("authored-v1", "bedrock:anthropic.claude-opus-5 + second bedrock-converse:mistral.mistral-large-3"),
        ("seeded-v3", "bedrock:anthropic.claude-opus-5"),
    ]
    for row in data["rows"]:
        assert set(row) == ROW_KEYS
        assert len(row["recallCi95"]) == 2 and len(row["controlFalsePositiveRateCi95"]) == 2
        assert row["precisionAtPrevalence"]["prevalence"] == 0.10
    authored = data["rows"][1]
    assert (authored["recall"], authored["precision"], authored["controlFalsePositiveRate"]) == (0.5, 0.5, 0.5)
    assert authored["estimatedCostPerCardUsd"] == 0.02
    caveat = authored["juryCaveat"]
    assert caveat["unanimityRate"] == 0.75 and caveat["jurorVendors"] == ["deepseek", "moonshotai", "qwen"]
    assert caveat["reviewerVendorOverlap"] == []
    # a reviewer from a juror's vendor is called out
    assert data["rows"][0]["juryCaveat"]["reviewerVendorOverlap"] == ["qwen"]
    assert data["rows"][2]["juryCaveat"] is None  # seeded rows carry no jury caveat


def test_compare_cli_writes_json_and_md(tmp_path: Path, capsys) -> None:
    summary = tmp_path / "summary.json"
    summary.write_text(json.dumps(SUMMARY), encoding="utf-8")
    out = tmp_path / "reports"
    args = ["compare", *map(str, runs(tmp_path)), "--name", "q03 configs", "--out", str(out), "--date", "2026-09-27",
            "--labels-summary", str(summary)]
    assert main(args) == 0
    printed = capsys.readouterr().out.split()
    assert [Path(p).name for p in printed] == ["2026-09-27-compare-q03-configs.json", "2026-09-27-compare-q03-configs.md"]
    data = json.loads((out / "2026-09-27-compare-q03-configs.json").read_text(encoding="utf-8"))
    assert len(data["rows"]) == 3
    md = (out / "2026-09-27-compare-q03-configs.md").read_text(encoding="utf-8")
    assert "labels are model-generated" in md and "no human labeled any card" in md
    assert "The jurors come from vendors not under test" in md
    assert "Unanimity rate: 0.7500" in md
    assert "shares a vendor with the jury (qwen)" in md
    # a second compare with the same name never overwrites the first
    assert main(args) == 0
    assert (out / "2026-09-27-compare-q03-configs-2.json").exists()


def test_compare_without_a_jury_summary_says_so(tmp_path: Path) -> None:
    data = build_compare(runs(tmp_path)[1:2], name="x", date="2026-09-27", jury_summary=None)
    assert data["rows"][0]["juryCaveat"] == {"note": JURY_NOTE, "summaryFound": False}


def test_vendor_of() -> None:
    assert vendor_of("qwen.qwen3-235b-a22b-2507-v1:0") == "qwen"
    assert vendor_of("global.moonshotai.kimi-k3") == "moonshotai"
    assert vendor_of("deepseek.v3.2") == "deepseek"
    assert vendor_of("us.anthropic.claude-opus-5-v1:0") == "anthropic"
    assert vendor_of("claude-opus-5") == "anthropic"
    assert vendor_of(None) is None

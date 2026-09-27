from __future__ import annotations

import json
from pathlib import Path

from conftest import finding, item

from dc_evals.dataset import DEFECT_CLASSES
from dc_evals.report import build_report, file_stem, read_run, render_markdown, run_header, unique_stem, write_run_files

HEADER = run_header(
    run_id="run-1",
    started_at="2026-09-27T01:02:03Z",
    provider="bedrock",
    model="anthropic.claude-opus-5",
    prompt_version="qa-v1",
    n=3,
)
RECORDS = [
    item("incorrect_answer", [finding("blocker", "incorrect_answer")], index=1, latency_ms=900, cost=0.05),
    item(None, [], index=2, latency_ms=1100, cost=0.04),
    item("answer_leak", [], status="error", error_code="SCHEMA_INVALID", index=3, latency_ms=0, cost=0.0),
]


def test_report_json_matches_contract_schema() -> None:
    report = build_report(HEADER, RECORDS)
    assert set(report) == {
        "v",
        "runId",
        "startedAt",
        "provider",
        "model",
        "promptVersion",
        "n",
        "estimatedCostUsd",
        "perClass",
        "overall",
        "latencyMs",
        "errors",
    }
    assert report["v"] == 1
    assert (report["runId"], report["provider"], report["model"], report["promptVersion"]) == (
        "run-1",
        "bedrock",
        "anthropic.claude-opus-5",
        "qa-v1",
    )
    assert report["n"] == 3
    assert report["estimatedCostUsd"] == 0.09
    assert set(report["perClass"]) == set(DEFECT_CLASSES)
    for block in report["perClass"].values():
        assert set(block) == {"tp", "fn", "recall"}
    assert set(report["overall"]) == {"tp", "fp", "fn", "recall", "precision", "f1", "controlFalsePositiveRate"}
    assert report["overall"] == {
        "tp": 1,
        "fp": 0,
        "fn": 1,
        "recall": 0.5,
        "precision": 1.0,
        "f1": 0.6667,
        "controlFalsePositiveRate": 0.0,
    }
    assert set(report["latencyMs"]) == {"p50", "p95"}
    assert report["latencyMs"] == {"p50": 900, "p95": 1100}
    assert report["errors"] == {"SCHEMA_INVALID": 1}
    json.dumps(report)  # serialisable
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "FAIL" in markdown and "| incorrect_answer | 1 | 0 | 1.0000 |" in markdown


def test_report_file_stem_uses_date_provider_model_prompt_version(tmp_path: Path) -> None:
    assert file_stem("2026-09-27", "bedrock", "anthropic.claude-opus-5", "qa-v1") == (
        "2026-09-27-bedrock-anthropic.claude-opus-5-qa-v1"
    )
    assert file_stem("2026-09-27", "anthropic", "claude-opus-5", "qa-v1") == "2026-09-27-anthropic-claude-opus-5-qa-v1"
    assert file_stem("2026-09-27", "bedrock", "a/b:c", "qa-v1") == "2026-09-27-bedrock-a-b-c-qa-v1"

    stem = file_stem("2026-09-27", "anthropic", "claude-opus-5", "qa-v1")
    first = write_run_files(tmp_path, stem, HEADER, RECORDS)
    second = write_run_files(tmp_path, stem, HEADER, RECORDS)
    assert [p.name for p in first] == [f"{stem}.jsonl", f"{stem}.json", f"{stem}.md"]
    assert [p.name for p in second] == [f"{stem}-2.jsonl", f"{stem}-2.json", f"{stem}-2.md"]
    assert unique_stem(tmp_path, stem) == f"{stem}-3"

    header, records = read_run(first[0])
    assert header == HEADER
    assert list(header) == ["type", "runId", "startedAt", "provider", "model", "promptVersion", "dataset", "n"]
    assert records == RECORDS
    assert json.loads(first[1].read_text(encoding="utf-8")) == build_report(HEADER, RECORDS)

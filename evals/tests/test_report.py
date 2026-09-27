from __future__ import annotations

import json
from pathlib import Path

from conftest import finding, item

from dc_evals.dataset import DATASETS, DEFECT_CLASSES, REPORTS_DIR, file_sha256, read_jsonl
from dc_evals.report import build_report, file_stem, read_run, render_markdown, run_header, unique_stem, write_run_files

HEADER = run_header(
    run_id="run-1",
    started_at="2026-09-27T01:02:03Z",
    provider="bedrock",
    model="anthropic.claude-opus-5",
    prompt_version="qa-v1",
    n=3,
    dataset="seeded-v2",
    dataset_sha256=file_sha256(DATASETS["v2"].path),
    dataset_rows=240,
    reps=1,
    review_date="2026-09-27",
    effort="high",
    structured_outputs="auto",
    structured_outputs_at_start=False,
)
BASELINE = REPORTS_DIR / "2026-09-27-claude-cli-claude-opus-5-qa-v1"
RECORDS = [
    item("incorrect_answer", [finding("blocker", "incorrect_answer")], index=1, latency_ms=900, cost=0.05),
    item(None, [], index=2, latency_ms=1100, cost=0.04),
    item("answer_leak", [], status="error", error_code="SCHEMA_INVALID", index=3, latency_ms=0, cost=0.0),
]


def test_report_json_matches_contract_schema() -> None:
    report = build_report(HEADER, RECORDS)
    # X04 (ai-agent-1/-2/-12) extends the §12.1 keys with the run settings, CIs, unscored counts,
    # tiers, repetitions and the gate verdict; every §12.1 key is still present with its meaning.
    # Y05 (ai-agent-20) adds the resolved structured-output mode and the evidence class.
    assert set(report) == {
        "v",
        "runId",
        "startedAt",
        "provider",
        "model",
        "promptVersion",
        "dataset",
        "datasetSha256",
        "reps",
        "reviewDate",
        "effort",
        "structuredOutputs",
        "structuredOutputsAtStart",
        "evidenceClass",
        "n",
        "estimatedCostUsd",
        "perClass",
        "overall",
        "unscored",
        "perTier",
        "perRep",
        "servedModel",
        "structuredItems",
        "latencyMs",
        "errors",
        "unitOfAnalysis",  # Z04 (ai-agent-28): what one sample is in every interval
        "proxyFidelity",  # Z04 (ai-agent-30): what a claude-cli run cannot observe
        "gate",
    }
    assert report["v"] == 2
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
        assert set(block) == {"tp", "fn", "recall", "recallCi95"}
    assert set(report["overall"]) == {
        "tp",
        "fp",
        "fn",
        "recall",
        "precision",
        "f1",
        "controlFalsePositiveRate",
        "recallCi95",
        "controlFalsePositiveRateCi95",
        "precisionAtPrevalence",
    }
    assert {k: v for k, v in report["overall"].items() if not isinstance(v, (list, dict))} == {
        "tp": 1,
        "fp": 0,
        "fn": 1,
        "recall": 0.5,
        "precision": 1.0,
        "f1": 0.6667,
        "controlFalsePositiveRate": 0.0,
    }
    assert report["unscored"] == {"defective": 1, "controls": 0, "controlUnscoredRate": 0.0}
    assert report["gate"]["passes"] is False
    assert any("truncated run" in reason for reason in report["gate"]["failures"])
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
    assert list(header) == [
        "type",
        "runId",
        "startedAt",
        "provider",
        "model",
        "promptVersion",
        "dataset",
        "datasetSha256",
        "datasetRows",
        "reps",
        "n",
        "reviewDate",
        "effort",
        "structuredOutputs",
        "structuredOutputsAtStart",
    ]
    assert records == RECORDS
    assert json.loads(first[1].read_text(encoding="utf-8")) == build_report(HEADER, RECORDS)


def test_run_header_records_every_setting_that_changes_results() -> None:
    """ai-agent-12: review date, effort, structured-output mode, dataset name + sha256, reps."""
    assert HEADER["reviewDate"] == "2026-09-27"
    assert HEADER["effort"] == "high"
    assert HEADER["structuredOutputs"] == "auto" and HEADER["structuredOutputsAtStart"] is False
    assert HEADER["dataset"] == "seeded-v2" and len(HEADER["datasetSha256"]) == 64
    assert HEADER["datasetRows"] == 240 and HEADER["reps"] == 1
    report = build_report(HEADER, RECORDS)
    for key in ("dataset", "datasetSha256", "reps", "reviewDate", "effort", "structuredOutputs"):
        assert report[key] == HEADER[key]
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "review date 2026-09-27, effort high, structured outputs auto" in markdown
    assert HEADER["datasetSha256"] in markdown


def test_markdown_reports_cis_prevalence_precision_unscored_and_tiers() -> None:
    records = [
        item("incorrect_answer", [finding("blocker", "incorrect_answer")], index=1, tier="easy"),
        item("incorrect_answer", [], index=2, tier="subtle"),
        item(None, [], index=3),
        item(None, [], status="refused", error_code="REFUSAL", index=4),
    ]
    report = build_report(HEADER, records)
    assert report["perTier"]["easy"]["recall"] == 1.0 and report["perTier"]["subtle"]["recall"] == 0.0
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "## Per difficulty tier" in markdown and "| subtle | 0 | 1 | 0.0000 |" in markdown
    assert "Precision at a 10% defect prevalence" in markdown
    assert "1 controls (left out of the FP rate" in markdown
    assert "95% CI" in markdown
    assert "truncated run" in markdown


def test_committed_baseline_run_still_scores_and_is_refused_by_the_gate() -> None:
    """The v1 claude-cli baseline stays readable: its §12.1 numbers are unchanged, and the gate
    names every reason it is not rollout evidence."""
    header, records = read_run(BASELINE.with_suffix(".jsonl"))
    report = build_report(header, records)
    committed = json.loads(BASELINE.with_suffix(".json").read_text(encoding="utf-8"))
    for key in ("tp", "fp", "fn", "recall", "precision", "f1", "controlFalsePositiveRate"):
        assert report["overall"][key] == committed["overall"][key], key
    for defect, block in committed["perClass"].items():
        assert {k: report["perClass"][defect][k] for k in block} == block
    assert set(report["perClass"]) == set(committed["perClass"])  # v1 seeds six classes
    failures = report["gate"]["failures"]
    assert report["gate"]["passes"] is False
    assert any("provider 'claude-cli'" in f for f in failures)
    assert any("dataset 'seeded-v1'" in f for f in failures)
    assert any("sha256" in f for f in failures)
    assert any("control false-positive rate 0.2900" in f for f in failures)
    assert any("class ambiguous_stem recall" in f for f in failures)


TUNING = REPORTS_DIR / "tuning-2026-09-27"


def test_no_committed_run_is_rollout_evidence_and_the_readmes_say_so() -> None:
    """Y05 ai-agent-17: every committed run is proxy evidence (claude-cli on seeded-v1) and the
    gate refuses it; the qa-v3 holdout run also fails on substance. The READMEs must not claim a
    passing or pending-in-this-folder run."""
    runs = sorted(REPORTS_DIR.rglob("*.jsonl"))
    runs = [p for p in runs if not p.name.startswith("split-")]
    assert runs
    for path in runs:
        header, records = read_run(path)
        report = build_report(header, records)
        assert report["evidenceClass"] == "proxy" and report["gate"]["passes"] is False, path.name
    holdout = build_report(*read_run(TUNING / "holdout-qa-v3.jsonl"))
    assert "recall 0.7826 < 0.80" in holdout["gate"]["failures"]
    assert "class ambiguous_stem recall 0.3750 < 0.60" in holdout["gate"]["failures"]
    assert "class qualifier_mismatch recall 0.4286 < 0.60" in holdout["gate"]["failures"]
    tuning = (TUNING / "README.md").read_text(encoding="utf-8")
    assert "qa-v3 has **not** passed the rollout gate" in tuning
    assert "Its run is the next report in this folder's parent" not in tuning
    assert "seeded-v2` (X04) rewrites those templates" not in tuning
    evals_readme = (REPORTS_DIR.parent / "README.md").read_text(encoding="utf-8")
    assert "so qa-v3 has **not** passed the gate" in evals_readme


def test_tuning_readme_discloses_that_the_holdout_informed_qa_v3() -> None:
    """Y05 ai-agent-19: the control adjudication covered holdout rows, so the README must say the
    holdout comparison is not clean and point to the fresh-dataset run."""
    adjudicated = {entry["id"] for entry in json.loads((TUNING / "adjudication-controls-qa-v1.json").read_text())}
    holdout_ids = {row["id"] for row in read_jsonl(TUNING / "split-holdout.jsonl")}
    assert len(adjudicated) == 29 and len(adjudicated & holdout_ids) == 16
    tuning = (TUNING / "README.md").read_text(encoding="utf-8")
    assert "Holdout contamination" in tuning and "16 of the 29 ids are holdout rows" in tuning
    assert "not a clean held-out result" in tuning
    assert "Prompt changes were derived only from dev errors." not in tuning
    assert "--dataset v3 --reps 2" in tuning


def test_a_proxy_report_states_what_the_transport_cannot_observe() -> None:
    """Z04 (ai-agent-30): a claude-cli report says MAX_TOKENS and REFUSAL are observable only when
    the CLI reports the stop reason, and that the Bedrock gate run checks both rates; a
    production-provider report carries no such caveat."""
    proxy = build_report({**HEADER, "provider": "claude-cli", "model": "claude-opus-5"}, RECORDS)
    assert proxy["proxyFidelity"]["outcomes"] == ["MAX_TOKENS", "REFUSAL"]
    assert "Bedrock gate run" in proxy["proxyFidelity"]["note"]
    markdown = render_markdown(proxy, flagged_wrong_category=0)
    assert "MAX_TOKENS and REFUSAL" in markdown and "Bedrock gate run" in markdown
    rollout = build_report(HEADER, RECORDS)
    assert rollout["proxyFidelity"] is None
    assert "MAX_TOKENS and REFUSAL" not in render_markdown(rollout, flagged_wrong_category=0)

"""A15: `dc-evals automation-gate` (A00 §15) on synthetic run files. No model, no network; every
file lives in tmp_path, and the real services/ai-qa/env/prod.env.json is never asserted on."""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest
from conftest import finding, gate_header, gate_records, item

from ai_qa.prompts import PROMPT_VERSION
from dc_evals import automation_gate as gate
from dc_evals.cli import main
from dc_evals.dataset import AUTHORED_V2, DATA_DIR, DATASETS, DEFECT_CLASSES, DatasetSpec, dump_line, spec_sha256
from dc_evals.jury import DEFAULT_JURORS, parse_jurors, summary_path
from dc_evals.score import clustered_wilson_ci

PROVIDER = "bedrock-converse"
MODEL = "global.openai.gpt-5.5"
NOW = dt.datetime(2026, 9, 28, 12, 0, 0, tzinfo=dt.UTC)
ENV = {
    "AI_QA_AUTOMATION_PROVIDER": PROVIDER,
    "AI_QA_AUTOMATION_MODEL": MODEL,
    "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "2.5",
    "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK": "15",
}


def write_lines(path: Path, lines: list[dict[str, Any]]) -> Path:
    path.write_text("".join(dump_line(line) for line in lines), encoding="utf-8")
    return path


def write_env(tmp_path: Path, **overrides: Any) -> Path:
    env = {key: value for key, value in {**ENV, **overrides}.items() if value is not None}
    path = tmp_path / "prod.env.json"
    path.write_text(json.dumps(env), encoding="utf-8")
    return path


def seeded_run(tmp_path: Path, records: list[dict[str, Any]] | None = None, **overrides: Any) -> Path:
    records = gate_records() if records is None else records
    header = gate_header(**{"provider": PROVIDER, "model": MODEL, "n": len(records), **overrides})
    return write_lines(tmp_path / "seeded.jsonl", [header, *records])


def authored_spec(
    tmp_path: Path, correct: int = 130, defective: int = 10, jurors: str = DEFAULT_JURORS
) -> tuple[DatasetSpec, list[dict[str, Any]]]:
    """An AUTHORED_V2-shaped spec in tmp_path: `correct` control cards then `defective` cards
    labelled incorrect_answer, with a jury summary naming `jurors`. Returns (spec, run rows)."""
    authored, labels = [], []
    for index in range(1, correct + defective + 1):
        row_id = f"a-{index:04d}"
        defect = None if index <= correct else "incorrect_answer"
        card = {"stableUid": f"u{index}", "difficulty": 1, "question": "Q?", "explanation": "E."}
        authored.append(
            {"id": row_id, "deckSlug": "aws-saa-c03", "sourceUrl": "https://docs.aws.amazon.com/x", "chunkId": "c0001",
             "chunkText": "t", "card": card, "authorModel": "m", "generatedAt": "g"}
        )
        labels.append(
            {"id": row_id, "label": "correct" if defect is None else "defective", "category": defect, "excluded": None,
             "unanimous": True, "defect": defect, "scorable": True, "counts": {}, "votes": []}
        )
    data = tmp_path / "authored-data"
    data.mkdir(exist_ok=True)
    path = write_lines(data / "authored-v2.jsonl", authored)
    labels_path = write_lines(data / "authored-v2.labels.jsonl", labels)
    summary_path(labels_path).write_text(
        json.dumps({"v": 1, "dataset": "authored-v2", "jurors": [j.name for j in parse_jurors(jurors)]}),
        encoding="utf-8",
    )
    spec = dataclasses.replace(AUTHORED_V2, path=path, labels_path=labels_path)
    rows = [{"id": row["id"], "defect": label["defect"]} for row, label in zip(authored, labels, strict=True)]
    return spec, rows


def authored_records(
    rows: list[dict[str, Any]], *, reps: int = 2, escaped: int = 0, unscored: int = 0
) -> list[dict[str, Any]]:
    """Every defective card flagged except the first `escaped` (in every rep); the first
    `unscored` correct cards end in a provider error (in every rep)."""
    records = []
    for rep in range(1, reps + 1):
        seen_defective = seen_correct = 0
        for index, row in enumerate(rows, start=1):
            defect = row["defect"]
            if defect is None:
                seen_correct += 1
                if seen_correct <= unscored:
                    record = item(None, [], status="error", error_code="PROVIDER_TIMEOUT", index=index, rep=rep)
                else:
                    record = item(None, [], index=index, rep=rep)
            else:
                seen_defective += 1
                hit = [] if seen_defective <= escaped else [finding("blocker", defect)]
                record = item(defect, hit, index=index, rep=rep)
            records.append({**record, "id": row["id"]})
    return records


def authored_run(
    tmp_path: Path, spec: DatasetSpec, records: list[dict[str, Any]], reps: int = 2, **overrides: Any
) -> Path:
    header = gate_header(
        **{
            "provider": PROVIDER,
            "model": MODEL,
            "dataset": spec.name,
            "datasetSha256": spec_sha256(spec),
            "datasetRows": len(records) // reps,
            "n": len(records),
            "reps": reps,
            **overrides,
        }
    )
    return write_lines(tmp_path / "authored.jsonl", [header, *records])


def evaluate(
    tmp_path: Path,
    *,
    seeded: Path | None = None,
    authored: Path | None = None,
    spec: DatasetSpec | None = None,
    env: Path | None = None,
    seeded_spec: DatasetSpec = DATASETS["v3"],
) -> dict[str, Any]:
    if spec is None or authored is None:
        spec, rows = authored_spec(tmp_path)
        authored = authored or authored_run(tmp_path, spec, authored_records(rows))
    return gate.evaluate_gate(
        seeded or seeded_run(tmp_path),
        authored,
        env_path=env or write_env(tmp_path),
        seeded_spec=seeded_spec,
        authored_spec=spec,
        now=NOW,
    )


def test_gate_passes_when_every_threshold_is_met(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    assert report["failures"] == []
    assert report["passed"] is True
    assert report["createdAt"] == "2026-09-28T12:00:00Z"
    assert report["reviewer"] == {
        "provider": PROVIDER, "model": MODEL, "promptVersion": PROMPT_VERSION, "secondProvider": None,
        "secondModel": None,
    }
    seeded = report["seeded"]
    assert (seeded["dataset"], seeded["reps"], seeded["n"], seeded["tp"], seeded["fn"]) == ("seeded-v3", 2, 452, 226, 0)
    assert seeded["recall"] == 1.0 and seeded["controlFalsePositiveRate"] == 0.0
    assert seeded["controlUnscoredRate"] == 0.0
    assert seeded["perClassRecall"] == {c: 1.0 for c in DEFECT_CLASSES}
    authored = report["authored"]
    assert {key: authored[key] for key in (
        "reps", "n", "scored", "wouldAccept", "wouldAcceptCorrect", "wouldAcceptCards", "autoAcceptPrecision",
        "defectiveLabeled", "defectEscaped", "defectEscapeRate", "humanRouteRate", "unscoredRate", "estimatedCostUsd",
    )} == {
        "reps": 2, "n": 280, "scored": 280, "wouldAccept": 260, "wouldAcceptCorrect": 260, "wouldAcceptCards": 130,
        "autoAcceptPrecision": 1.0, "defectiveLabeled": 20, "defectEscaped": 0, "defectEscapeRate": 0.0,
        "humanRouteRate": 0.0714, "unscoredRate": 0.0, "estimatedCostUsd": 2.8,
    }
    assert authored["autoAcceptPrecisionCi95"] == clustered_wilson_ci([(2, 2)] * 130)
    assert authored["autoAcceptPrecisionCi95"][0] >= gate.AUTO_ACCEPT_PRECISION_CI_LOWER_GATE
    assert authored["dataset"] == "authored-v2" and authored["labelsSha256"]


def _failures_with(tmp_path: Path, **kwargs: Any) -> list[str]:
    return evaluate(tmp_path, **kwargs)["failures"]


def _authored_case(tmp_path: Path, *, correct: int = 130, defective: int = 10, reps: int = 2, **records: Any):
    spec, rows = authored_spec(tmp_path, correct=correct, defective=defective)
    return {"spec": spec, "authored": authored_run(tmp_path, spec, authored_records(rows, reps=reps, **records), reps)}


def test_each_threshold_failure_is_reported(tmp_path: Path) -> None:
    def case(name: str) -> Path:
        path = tmp_path / name
        path.mkdir()
        return path

    # seeded recall: two misses in every class (the same cards in both reps)
    t = case("recall")
    report = evaluate(t, seeded=seeded_run(t, gate_records(misses={c: 2 for c in DEFECT_CLASSES})))
    recall = report["seeded"]["recall"]
    assert recall < 0.90 and f"seeded recall {recall:.4f} < 0.90" in report["failures"]

    # its CI: the point estimate passes, the card-clustered lower bound does not
    t = case("recall-ci")
    misses = {c: 1 for c in DEFECT_CLASSES} | {"incorrect_answer": 2, "source_unsupported": 2, "outdated_fact": 2}
    report = evaluate(t, seeded=seeded_run(t, gate_records(misses=misses)))
    lower = report["seeded"]["recallCi95"][0]
    assert report["seeded"]["recall"] >= 0.90
    assert report["failures"] == [f"seeded recall 95% CI lower bound {lower:.4f} < 0.85"]

    # a class floor
    t = case("class")
    report = evaluate(t, seeded=seeded_run(t, gate_records(misses={"answer_leak": 4})))
    assert report["failures"] == ["seeded class answer_leak recall 0.7333 < 0.75"]

    # a class without rows
    t = case("class-rows")
    extra = dataclasses.replace(DATASETS["v3"], classes=(*DEFECT_CLASSES, "weak_distractor"))
    assert _failures_with(t, seeded_spec=extra) == ["seeded class weak_distractor has no rows"]

    # control false-positive rate
    t = case("fpr")
    assert _failures_with(t, seeded=seeded_run(t, gate_records(false_positives=25))) == [
        "seeded control false-positive rate 0.2212 > 0.20"
    ]

    # control unscored rate
    t = case("unscored")
    assert _failures_with(t, seeded=seeded_run(t, gate_records(unscored_controls=3))) == [
        "seeded control unscored rate 0.0265 > 0.02"
    ]

    # auto-accept precision (and its interval and the escapes that cause it)
    t = case("precision")
    report = evaluate(t, **_authored_case(t, escaped=5))
    lower = report["authored"]["autoAcceptPrecisionCi95"][0]
    assert report["failures"] == [
        "auto-accept precision 0.9630 < 0.97",
        f"auto-accept precision 95% CI lower bound {lower:.4f} < 0.93",
        "defect escape rate 0.5000 > 0.20",
    ]

    # its CI: 40 cards all correct, precision 1.0 but a wide interval (and too few cards)
    t = case("precision-ci")
    report = evaluate(t, **_authored_case(t, correct=40))
    lower = report["authored"]["autoAcceptPrecisionCi95"][0]
    assert report["failures"] == [
        f"auto-accept precision 95% CI lower bound {lower:.4f} < 0.93",
        "40 distinct would-accept cards, fewer than 120",
    ]

    # would-accept cards
    t = case("cards")
    assert _failures_with(t, **_authored_case(t, correct=100)) == ["100 distinct would-accept cards, fewer than 120"]

    # no defective item
    t = case("no-defective")
    assert _failures_with(t, **_authored_case(t, defective=0)) == [
        "the authored run has no defective-labelled item, so the defect escape rate is undefined"
    ]

    # defect escape rate
    t = case("escape")
    assert _failures_with(t, **_authored_case(t, escaped=3)) == ["defect escape rate 0.3000 > 0.20"]

    # authored unscored rate
    t = case("authored-unscored")
    assert _failures_with(t, **_authored_case(t, unscored=10)) == ["authored unscored rate 0.0714 > 0.05"]

    # repetitions, on each run
    t = case("reps")
    failures = _failures_with(t, seeded=seeded_run(t, gate_records(reps=1), reps=1), **_authored_case(t, reps=1))
    assert failures == [
        "seeded run: 1 repetition(s); the gate needs at least 2",
        "authored run: 1 repetition(s); the gate needs at least 2",
    ]


def test_configuration_mismatch_fails_the_gate(tmp_path: Path) -> None:
    def case(name: str) -> Path:
        path = tmp_path / name
        path.mkdir()
        return path

    # wrong provider on the seeded run
    t = case("provider")
    assert _failures_with(t, seeded=seeded_run(t, provider="bedrock")) == [
        "seeded run: provider 'bedrock' is not one of ['bedrock-converse']",
        "seeded run: provider 'bedrock' is not AI_QA_AUTOMATION_PROVIDER 'bedrock-converse'",
        "the seeded and authored runs used different reviewers",
    ]

    # wrong model on both runs (the same reviewer, but not the automation one)
    t = case("model")
    spec, rows = authored_spec(t)
    authored = authored_run(t, spec, authored_records(rows), model="qwen.qwen3-235b-a22b-2507-v1:0")
    assert _failures_with(t, seeded=seeded_run(t, model="qwen.qwen3-235b-a22b-2507-v1:0"), authored=authored,
                          spec=spec) == [
        "seeded run: model 'qwen.qwen3-235b-a22b-2507-v1:0' is not AI_QA_AUTOMATION_MODEL 'global.openai.gpt-5.5'",
        "authored run: model 'qwen.qwen3-235b-a22b-2507-v1:0' is not AI_QA_AUTOMATION_MODEL 'global.openai.gpt-5.5'",
        "juror bedrock-converse:qwen.qwen3-235b-a22b-2507-v1:0 shares the reviewer's vendor qwen; the authored "
        "labels are not independent",
    ]

    # another prompt version
    t = case("prompt")
    failures = _failures_with(t, seeded=seeded_run(t, promptVersion="qa-v0"))
    assert f"seeded run: promptVersion 'qa-v0' is not the ai_qa PROMPT_VERSION {PROMPT_VERSION!r}" in failures
    assert "the seeded and authored runs used different reviewers" in failures

    # a second reviewer
    t = case("second")
    failures = _failures_with(t, seeded=seeded_run(t, secondProvider="bedrock", secondModel="anthropic.claude-opus-5"))
    assert "seeded run: a second reviewer is configured; the automation reviewer runs alone" in failures

    # env keys: missing, empty, non-positive, not a number
    t = case("env-missing")
    env = write_env(t, AI_QA_AUTOMATION_PROVIDER=None, AI_QA_AUTOMATION_MODEL="",
                    AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK="0", AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK="abc")
    assert _failures_with(t, env=env) == [
        f"AI_QA_AUTOMATION_PROVIDER is not set in {env}",
        f"AI_QA_AUTOMATION_MODEL is not set in {env}",
        f"AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK in {env} is not a positive number",
        f"AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK in {env} is not a positive number",
    ]
    t = case("env-absent")
    env = t / "absent.env.json"
    assert _failures_with(t, env=env) == [f"{key} is not set in {env}" for key in gate.AUTOMATION_ENV_KEYS]
    t = case("env-other")
    failures = _failures_with(t, env=write_env(t, AI_QA_AUTOMATION_MODEL="global.openai.gpt-6"))
    assert "authored run: model 'global.openai.gpt-5.5' is not AI_QA_AUTOMATION_MODEL 'global.openai.gpt-6'" in failures

    # the two runs on different reviewers (both automation-shaped, different second reviewer)
    t = case("different")
    spec, rows = authored_spec(t)
    authored = authored_run(t, spec, authored_records(rows), secondModel="deepseek.v3.2")
    failures = _failures_with(t, authored=authored, spec=spec)
    assert failures == [
        "authored run: a second reviewer is configured; the automation reviewer runs alone",
        "the seeded and authored runs used different reviewers",
    ]

    # a juror from the reviewer's vendor
    t = case("juror")
    spec, rows = authored_spec(t, jurors=DEFAULT_JURORS + ",bedrock-converse:openai.gpt-oss-120b-1:0")
    failures = _failures_with(t, authored=authored_run(t, spec, authored_records(rows)), spec=spec)
    assert failures == [
        "juror bedrock-converse:openai.gpt-oss-120b-1:0 shares the reviewer's vendor openai; the authored labels "
        "are not independent"
    ]
    # ...and a missing jury summary
    summary_path(spec.labels_path).unlink()
    failures = _failures_with(t, authored=t / "authored.jsonl", spec=spec)
    assert failures == [f"authored run: the jury summary {summary_path(spec.labels_path)} is missing"]

    # dataset name and sha mismatches
    t = case("dataset")
    failures = _failures_with(t, seeded=seeded_run(t, dataset="seeded-v2", datasetSha256="0" * 64))
    assert failures[:2] == [
        "seeded run: dataset 'seeded-v2' is not 'seeded-v3'",
        "seeded run: the dataset sha256 does not match the committed seeded-v3 file",
    ]
    t = case("authored-dataset")
    spec, rows = authored_spec(t)
    authored = authored_run(t, spec, authored_records(rows), dataset="authored-v1", datasetSha256="1" * 64)
    assert _failures_with(t, authored=authored, spec=spec) == [
        "authored run: dataset 'authored-v1' is not 'authored-v2'",
        "authored run: the dataset sha256 does not match the committed authored-v2 files",
    ]

    # truncated runs
    t = case("truncated")
    spec, rows = authored_spec(t)
    records = authored_records(rows)[:-3]
    failures = _failures_with(t, seeded=seeded_run(t, gate_records()[:-1]),
                              authored=authored_run(t, spec, records), spec=spec)
    assert "seeded run: truncated run: 451 items, expected 226 rows x 2 reps" in failures
    assert "authored run: truncated run: 277 items, expected 140 rows x 2 reps" in failures

    # missing authored-v2 files (named relative to evals/ when they live there; nothing is created)
    t = case("missing")
    absent = dataclasses.replace(
        AUTHORED_V2, path=DATA_DIR / "authored-v2-absent.jsonl", labels_path=DATA_DIR / "authored-v2-absent.labels.jsonl"
    )
    _, rows = authored_spec(t)
    records = authored_records(rows)
    authored = write_lines(t / "authored.jsonl", [gate_header(provider=PROVIDER, model=MODEL, dataset="authored-v2",
                                                              n=len(records)), *records])
    failures = _failures_with(t, authored=authored, spec=absent)
    assert failures == [
        "authored run: data/authored-v2-absent.jsonl or data/authored-v2-absent.labels.jsonl is missing",
        "authored run: the jury summary data/authored-v2-absent.labels.summary.json is missing",
    ]
    assert not absent.path.exists()

    # a file that is not a run file, or no file at all
    t = case("invalid")
    report_json = t / "seeded.json"
    report_json.write_text(json.dumps({"v": 2, "n": 1}, indent=2), encoding="utf-8")
    with pytest.raises(ValueError, match="not a run file"):
        evaluate(t, seeded=report_json)
    with pytest.raises(ValueError, match="does not exist"):
        evaluate(t, seeded=t / "nope.jsonl")
    with pytest.raises(ValueError, match="not a run file"):
        evaluate(t, seeded=write_lines(t / "items.jsonl", gate_records(reps=1)[:3]))


def test_report_json_has_the_contract_keys(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    assert list(report) == [
        "v", "kind", "createdAt", "passed", "failures", "reviewer", "thresholds", "seeded", "authored",
    ]
    assert report["v"] == 1 and report["kind"] == "automation-gate"
    assert list(report["reviewer"]) == ["provider", "model", "promptVersion", "secondProvider", "secondModel"]
    assert report["thresholds"] == {
        "seededRecall": 0.90, "seededRecallCiLower": 0.85, "seededPerClassRecallFloor": 0.75, "seededControlFpr": 0.20,
        "seededControlUnscoredRate": 0.02, "autoAcceptPrecision": 0.97, "autoAcceptPrecisionCiLower": 0.93,
        "minWouldAcceptCards": 120, "defectEscapeRate": 0.20, "authoredUnscoredRate": 0.05, "minReps": 2,
    }
    assert list(report["thresholds"]) == [
        "seededRecall", "seededRecallCiLower", "seededPerClassRecallFloor", "seededControlFpr",
        "seededControlUnscoredRate", "autoAcceptPrecision", "autoAcceptPrecisionCiLower", "minWouldAcceptCards",
        "defectEscapeRate", "authoredUnscoredRate", "minReps",
    ]
    assert list(report["seeded"]) == [
        "report", "reportSha256", "dataset", "datasetSha256", "reps", "n", "tp", "fn", "recall", "recallCi95",
        "perClassRecall", "controlFalsePositiveRate", "controlUnscoredRate",
    ]
    assert list(report["authored"]) == [
        "report", "reportSha256", "dataset", "datasetSha256", "labelsSha256", "reps", "n", "scored", "wouldAccept",
        "wouldAcceptCorrect", "wouldAcceptCards", "autoAcceptPrecision", "autoAcceptPrecisionCi95",
        "defectiveLabeled", "defectEscaped", "defectEscapeRate", "humanRouteRate", "unscoredRate", "estimatedCostUsd",
    ]
    json.dumps(report)


def test_would_accept_precision_and_ci_are_card_clustered(tmp_path: Path) -> None:
    def record(card: int, rep: int, defect: str | None, flagged: bool = False) -> dict[str, Any]:
        return item(defect, [finding("blocker", "incorrect_answer")] if flagged else [], index=card, rep=rep)

    # 50 cards, each reviewed twice, repetitions agreeing: 48 correct cards and 2 escaped defective ones
    agreeing = [record(c, rep, None if c <= 48 else "incorrect_answer") for rep in (1, 2) for c in range(1, 51)]
    metrics = gate.authored_metrics(agreeing)
    assert (metrics["wouldAccept"], metrics["wouldAcceptCorrect"], metrics["wouldAcceptCards"]) == (100, 96, 50)
    assert metrics["autoAcceptPrecision"] == 0.96
    # agreeing repetitions give the distinct-card interval, not the pooled-item one
    assert metrics["autoAcceptPrecisionCi95"] == clustered_wilson_ci([(1, 1)] * 48 + [(0, 1)] * 2)
    assert metrics["autoAcceptPrecisionCi95"] == clustered_wilson_ci([(2, 2)] * 48 + [(0, 2)] * 2)
    pooled = clustered_wilson_ci([(1, 1)] * 96 + [(0, 1)] * 4)
    assert metrics["autoAcceptPrecisionCi95"][0] < pooled[0]
    # a card flagged in one repetition only counts once, in the reps where it would be accepted
    split = [record(1, 1, None), record(1, 2, None, flagged=True), record(2, 1, None), record(2, 2, None)]
    metrics = gate.authored_metrics(split)
    assert (metrics["wouldAccept"], metrics["wouldAcceptCards"], metrics["humanRouteRate"]) == (3, 2, 0.25)


def test_cli_exit_codes_and_files(tmp_path: Path, capsys, monkeypatch) -> None:
    spec, rows = authored_spec(tmp_path)
    authored = authored_run(tmp_path, spec, authored_records(rows))
    seeded = seeded_run(tmp_path)
    env = write_env(tmp_path)
    out = tmp_path / "reports"
    original = gate.evaluate_gate
    monkeypatch.setattr(gate, "evaluate_gate", lambda *a, **kw: original(*a, **{"authored_spec": spec, **kw}))
    args = ["automation-gate", "--seeded", str(seeded), "--authored", str(authored), "--date", "2026-09-28",
            "--out", str(out), "--ai-qa-env", str(env)]
    assert main(args) == 0
    first = capsys.readouterr()
    assert first.err == ""
    json_path = out / "2026-09-28-automation-gate-global.openai.gpt-5.5.json"
    md_path = out / "2026-09-28-automation-gate-global.openai.gpt-5.5.md"
    assert first.out.split() == [str(json_path), str(md_path)]
    report = json.loads(json_path.read_text(encoding="utf-8"))
    assert report["passed"] is True
    assert md_path.read_text(encoding="utf-8").startswith(
        f"# Automation gate: {PROVIDER} {MODEL} {PROMPT_VERSION} — PASS"
    )
    assert "POST /api/v1/admin/automation/eval-gate" in md_path.read_text(encoding="utf-8")

    # a second call never overwrites
    assert main(args) == 0
    assert capsys.readouterr().out.split() == [
        str(out / "2026-09-28-automation-gate-global.openai.gpt-5.5-2.json"),
        str(out / "2026-09-28-automation-gate-global.openai.gpt-5.5-2.md"),
    ]
    assert json.loads(json_path.read_text(encoding="utf-8")) == report

    # a failed gate: exit 1, files still written, every failure on stderr
    bad_env = write_env(tmp_path, AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK=None)
    assert main([*args[:-1], str(bad_env)]) == 1
    failed = capsys.readouterr()
    assert failed.err.splitlines() == [f"gate: AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK is not set in {bad_env}"]
    failed_json = Path(failed.out.split()[0])
    assert failed_json.name.endswith("-3.json") and json.loads(failed_json.read_text())["passed"] is False
    assert "— FAIL" in Path(failed.out.split()[1]).read_text(encoding="utf-8")

    # not a run file (the derived .json report), or a missing file: exit 2, nothing written
    before = sorted(out.iterdir())
    assert main(["automation-gate", "--seeded", str(json_path), "--authored", str(authored), "--out", str(out),
                 "--ai-qa-env", str(env)]) == 2
    err = capsys.readouterr().err
    assert err.startswith("dc-evals: ") and "not a run file" in err
    assert main(["automation-gate", "--seeded", str(seeded), "--authored", str(tmp_path / "missing.jsonl"),
                 "--out", str(out), "--ai-qa-env", str(env)]) == 2
    assert capsys.readouterr().err.startswith("dc-evals: authored run file")
    assert sorted(out.iterdir()) == before

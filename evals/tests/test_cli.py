from __future__ import annotations

import json
import shutil
from pathlib import Path

from conftest import FakeLlm, finding, gate_header, gate_records, item, reply, review_json

from dc_evals.cli import main
from dc_evals.dataset import DATASETS, SEEDED_PATH, file_sha256
from dc_evals.report import read_run


def write_run(path: Path, records: list[dict], **header_overrides) -> Path:
    header = gate_header(n=len(records), **header_overrides)
    path.write_text("".join(json.dumps(line) + "\n" for line in [header, *records]), encoding="utf-8")
    return path


def test_score_gate_exit_codes(tmp_path: Path, capsys) -> None:
    # X04 (ai-agent-2): the old passing fixture was a 20-item run, which is exactly the truncated
    # run the gate must now refuse. Y05 (ai-agent-20/-21): a passing run is a complete two-rep
    # seeded-v3 run of the shipping configuration.
    misses = {"incorrect_answer": 3, "multiple_correct": 3, "answer_leak": 3, "ambiguous_stem": 3,
              "outdated_fact": 3, "qualifier_mismatch": 3, "source_unsupported": 3}
    passing = write_run(tmp_path / "pass.jsonl", gate_records(misses=misses))
    failing = write_run(tmp_path / "fail.jsonl", gate_records(misses={**misses, "incorrect_answer": 5}))
    truncated = write_run(tmp_path / "short.jsonl", [item("incorrect_answer", [finding("blocker", "incorrect_answer")])])
    empty = write_run(tmp_path / "empty.jsonl", [])

    assert main(["score", str(passing), "--gate"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["overall"]["recall"] == 0.8142 and report["overall"]["precision"] == 1.0
    assert main(["score", str(failing), "--gate"]) == 1
    assert "gate: recall 0.7965 < 0.80" in capsys.readouterr().err
    assert main(["score", str(failing)]) == 0  # without --gate, score only reports
    capsys.readouterr()
    assert main(["score", str(truncated), "--gate"]) == 1
    assert "truncated run" in capsys.readouterr().err
    assert main(["score", str(empty), "--gate"]) == 1


def test_seed_check_detects_drift(tmp_path: Path, capsys) -> None:
    target = tmp_path / "seeded-v1.jsonl"
    assert main(["seed", "--output", str(target)]) == 0
    assert target.read_bytes() == SEEDED_PATH.read_bytes()
    assert main(["seed", "--check", "--output", str(target)]) == 0

    data = bytearray(target.read_bytes())
    data[100] = ord("X") if data[100] != ord("X") else ord("Y")
    target.write_bytes(bytes(data))
    capsys.readouterr()
    assert main(["seed", "--check", "--output", str(target)]) != 0
    assert "differs" in capsys.readouterr().err

    shutil.copyfile(SEEDED_PATH, target)
    with target.open("ab") as fh:
        fh.write(b"\n")
    assert main(["seed", "--check", "--output", str(target)]) != 0


def test_seed_v2_and_sources_are_reproducible(tmp_path: Path, capsys) -> None:
    spec = DATASETS["v2"]
    assert main(["seed", "--dataset", "v2", "--check"]) == 0
    target = tmp_path / "seeded-v2.jsonl"
    assert main(["seed", "--dataset", "v2", "--output", str(target)]) == 0
    assert target.read_bytes() == spec.path.read_bytes()
    assert main(["export-sources", "--check"]) == 0


def test_dry_run_prints_estimate_without_a_client(monkeypatch, tmp_path: Path, capsys) -> None:
    def no_client(*args, **kwargs):
        raise AssertionError("dry run must not construct a client")

    monkeypatch.setattr("ai_qa.providers.make_client", no_client)
    out = tmp_path / "reports"
    code = main(
        ["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "10", "--reps", "1", "--dry-run",
         "--out", str(out)]
    )
    assert code == 0
    printed = capsys.readouterr().out
    assert "rows: 10" in printed and "reps" not in printed
    # 10 rows x (3000 x $5 + 1500 x $25) / 1e6 = $0.525
    assert "$0.53" in printed or "$0.52" in printed
    assert not out.exists()

    code = main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "10", "--reps", "3",
                 "--dry-run", "--out", str(out)])
    assert code == 0
    printed = capsys.readouterr().out
    assert "rows: 10 x 3 reps" in printed
    assert "$1.57" in printed or "$1.58" in printed  # three times the single-rep estimate
    # Y05 (ai-agent-21): the default is two repetitions, the gate's minimum.
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "10", "--dry-run",
                 "--out", str(out)]) == 0
    assert "rows: 10 x 2 reps" in capsys.readouterr().out
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--reps", "0", "--dry-run",
                 "--out", str(out)]) == 2


def test_run_writes_a_full_header_and_per_item_provenance(monkeypatch, tmp_path: Path, capsys) -> None:
    """ai-agent-12: the header records every setting; items record rep, tier, structured, served
    model. The client is a FakeLlm: no model is called."""
    fake = FakeLlm(lambda uid, kwargs: reply(review_json()))
    monkeypatch.setattr("ai_qa.providers.make_client", lambda settings, api_key=None: fake)
    out = tmp_path / "reports"
    code = main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "3", "--reps", "2",
                 "--review-date", "2026-01-02", "--concurrency", "1", "--out", str(out)])
    assert code == 0
    run_file = next(out.glob("*.jsonl"))
    header, records = read_run(run_file)
    spec = DATASETS["v3"]  # Y05: the default dataset is the gate dataset, seeded-v3
    assert header["dataset"] == "seeded-v3"
    assert header["datasetSha256"] == file_sha256(spec.path)
    assert header["datasetRows"] == 226 and header["reps"] == 2 and header["n"] == 6
    assert header["reviewDate"] == "2026-01-02"
    assert header["effort"] == "high"
    assert header["structuredOutputs"] == "auto" and header["structuredOutputsAtStart"] is True
    assert [r["rep"] for r in records] == [1, 1, 1, 2, 2, 2]
    assert all(r["structured"] is True and r["servedModel"] == "claude-opus-5" for r in records)
    assert all("Review date: 2026-01-02" in call["messages"][0]["content"] for call in fake.calls)
    capsys.readouterr()
    assert main(["score", str(run_file), "--gate"]) == 1  # a --limit run is never gate evidence
    err = capsys.readouterr().err
    assert "truncated run: 6 items, expected 226 rows x 2 reps" in err
    # Y05 (ai-agent-20): the Anthropic API resolves structured outputs to on; Bedrock ships off.
    assert "structuredOutputsAtStart True is not the shipping structuredOutputsAtStart False" in err


def test_bedrock_rejects_a_first_party_model_id(tmp_path: Path, capsys) -> None:
    code = main(["run", "--provider", "bedrock", "--model", "claude-opus-5", "--dry-run", "--out", str(tmp_path)])
    assert code == 2
    assert "anthropic." in capsys.readouterr().err


def test_seed_v3_is_reproducible(tmp_path: Path) -> None:
    """Y05: `dc-evals seed --dataset v3` rebuilds the gate dataset byte for byte."""
    spec = DATASETS["v3"]
    assert main(["seed", "--dataset", "v3", "--check"]) == 0
    target = tmp_path / "seeded-v3.jsonl"
    assert main(["seed", "--dataset", "v3", "--output", str(target)]) == 0
    assert target.read_bytes() == spec.path.read_bytes()

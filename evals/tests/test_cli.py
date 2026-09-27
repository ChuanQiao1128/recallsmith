from __future__ import annotations

import json
import shutil
from pathlib import Path

from conftest import finding, item

from dc_evals.cli import main
from dc_evals.dataset import SEEDED_PATH
from dc_evals.report import run_header


def write_run(path: Path, records: list[dict]) -> Path:
    header = run_header(
        run_id="run-1",
        started_at="2026-09-27T00:00:00Z",
        provider="anthropic",
        model="claude-opus-5",
        prompt_version="qa-v1",
        n=len(records),
    )
    path.write_text("".join(json.dumps(line) + "\n" for line in [header, *records]), encoding="utf-8")
    return path


def test_score_gate_exit_codes(tmp_path: Path, capsys) -> None:
    hit = [finding("blocker", "incorrect_answer")]
    passing = write_run(
        tmp_path / "pass.jsonl",
        [item("incorrect_answer", hit) for _ in range(8)] + [item("incorrect_answer", []) for _ in range(2)]
        + [item(None, []) for _ in range(10)],
    )
    failing = write_run(
        tmp_path / "fail.jsonl",
        [item("incorrect_answer", hit) for _ in range(7)] + [item("incorrect_answer", []) for _ in range(3)]
        + [item(None, []) for _ in range(10)],
    )
    empty = write_run(tmp_path / "empty.jsonl", [])

    assert main(["score", str(passing), "--gate"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["overall"]["recall"] == 0.8 and report["overall"]["precision"] == 1.0
    assert main(["score", str(failing), "--gate"]) == 1
    capsys.readouterr()
    assert main(["score", str(failing)]) == 0  # without --gate, score only reports
    capsys.readouterr()
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


def test_dry_run_prints_estimate_without_a_client(monkeypatch, tmp_path: Path, capsys) -> None:
    def no_client(*args, **kwargs):
        raise AssertionError("dry run must not construct a client")

    monkeypatch.setattr("ai_qa.providers.make_client", no_client)
    out = tmp_path / "reports"
    code = main(
        ["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "10", "--dry-run", "--out", str(out)]
    )
    assert code == 0
    printed = capsys.readouterr().out
    assert "rows: 10" in printed
    # 10 rows x (3000 x $5 + 1500 x $25) / 1e6 = $0.525
    assert "$0.53" in printed or "$0.52" in printed
    assert not out.exists()


def test_bedrock_rejects_a_first_party_model_id(tmp_path: Path, capsys) -> None:
    code = main(["run", "--provider", "bedrock", "--model", "claude-opus-5", "--dry-run", "--out", str(tmp_path)])
    assert code == 2
    assert "anthropic." in capsys.readouterr().err

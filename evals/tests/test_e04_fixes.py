"""E04 (R18E fix round 4): the gated reviewer's served model is asserted per scored item
(ai-agent-19), and the jurors come from vendors other than both the reviewer's and the author's
(ai-agent-25). Fakes only; nothing calls a model."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from conftest import FakeLlm, finding, gate_records, reply, review_json
from test_automation_gate import (
    authored_records,
    authored_run,
    authored_spec,
    evaluate,
    seeded_run,
    write_env,
)
from test_c06_fixes import MANTLE, MANTLE_MODEL, mantle_served
from test_runner import rows

from dc_evals import automation_gate as gate
from dc_evals.jury import DEFAULT_JURORS, summary_path
from dc_evals.runner import MODEL_MISMATCH, model_matches, run_eval

# What bedrock-mantle names for a dated GPT-5.5 snapshot, as the openai-mantle adapter reports it
# (ai_qa.openai_mantle_client.served_model prepends the openai. namespace).
DATED = "openai.gpt-5.5-2026-08-07"


# --- ai-agent-19: OpenAI dated snapshots and the openai. namespace in model_matches ----------------


@pytest.mark.parametrize(
    ("requested", "served", "matches"),
    [
        ("openai.gpt-5.5", "openai.gpt-5.5", True),
        ("openai.gpt-5.5", DATED, True),
        ("openai.gpt-5.5", "gpt-5.5-2026-08-07", True),
        ("global.openai.gpt-5.5", DATED, True),
        ("openai.gpt-5.5", "openai.gpt-5.5-mini", False),
        ("openai.gpt-5.5", "openai.gpt-5.4-2026-08-07", False),
        ("openai.gpt-5.5", "openai.gpt-5.5-2026-8-7", False),
        ("openai.gpt-5", "openai.gpt-5.5", False),
        # the Anthropic forms keep working
        ("claude-opus-5", "claude-opus-5-20260901", True),
        ("claude-opus-5", "claude-opus-5-2026-09-01", True),
        ("us.anthropic.claude-opus-5-v1:0", "claude-opus-5", True),
    ],
)
def test_model_matches_knows_openai_dated_snapshots(requested: str, served: str, matches: bool) -> None:
    assert model_matches(requested, served) is matches


def test_a_dated_openai_reply_is_not_a_model_mismatch(settings) -> None:
    sample = rows(2)
    requested = dataclasses.replace(settings, model=MANTLE_MODEL)

    def respond(uid: str, kwargs: dict[str, Any]):
        return reply(review_json(finding("blocker", "incorrect_answer")), model=DATED)

    records = run_eval(sample, client=FakeLlm(respond), settings=requested, review_date="2026-09-28")
    assert [r["status"] for r in records] == ["done", "done"]
    assert all(r["errorCode"] != MODEL_MISMATCH for r in records)
    assert [r["servedModel"] for r in records] == [DATED, DATED]


# --- ai-agent-19: the automation gate requires a verified, matching served model per scored item ---


def _mantle_case(tmp_path: Path, served: str | None) -> tuple[dict[str, Any], list[str]]:
    spec, run_rows = authored_spec(tmp_path)
    env = write_env(tmp_path, AI_QA_AUTOMATION_PROVIDER=MANTLE, AI_QA_AUTOMATION_MODEL=MANTLE_MODEL)
    mantle = {"provider": MANTLE, "model": MANTLE_MODEL, "effectiveEffort": "high"}
    seeded = seeded_run(tmp_path, mantle_served(gate_records(), served), **mantle)
    authored = authored_run(tmp_path, spec, mantle_served(authored_records(run_rows), served), **mantle)
    report = evaluate(tmp_path, seeded=seeded, authored=authored, spec=spec, env=env)
    return report, report["failures"]


def test_gate_passes_an_openai_mantle_run_served_by_a_dated_snapshot(tmp_path: Path) -> None:
    report, failures = _mantle_case(tmp_path, DATED)
    assert failures == []
    assert report["passed"] is True
    assert report["reviewer"]["servedModels"] == [DATED]


def test_gate_fails_an_openai_mantle_run_without_a_served_model(tmp_path: Path) -> None:
    report, failures = _mantle_case(tmp_path, None)
    assert failures == [
        "seeded run: 452 scored items carry no verified served model id",
        "authored run: 280 scored items carry no verified served model id",
    ]
    assert report["passed"] is False
    assert report["reviewer"]["servedModels"] == []


def test_gate_fails_an_openai_mantle_run_served_by_another_model(tmp_path: Path) -> None:
    report, failures = _mantle_case(tmp_path, "openai.gpt-5.4-2026-08-07")
    assert failures == [
        f"{which} run: scored items were served by openai.gpt-5.4-2026-08-07, not the gated model 'openai.gpt-5.5'"
        for which in ("seeded", "authored")
    ]
    assert report["reviewer"]["servedModels"] == ["openai.gpt-5.4-2026-08-07"]


def test_gate_counts_only_scored_items_without_a_served_model(tmp_path: Path) -> None:
    spec, run_rows = authored_spec(tmp_path)
    env = write_env(tmp_path, AI_QA_AUTOMATION_PROVIDER=MANTLE, AI_QA_AUTOMATION_MODEL=MANTLE_MODEL)
    mantle = {"provider": MANTLE, "model": MANTLE_MODEL, "effectiveEffort": "high"}
    records = mantle_served(authored_records(run_rows, unscored=2), DATED)
    records[5] = {**records[5], "servedModel": None}
    seeded = seeded_run(tmp_path, mantle_served(gate_records(), DATED), **mantle)
    authored = authored_run(tmp_path, spec, records, **mantle)
    failures = evaluate(tmp_path, seeded=seeded, authored=authored, spec=spec, env=env)["failures"]
    # the errored items carry no served model and are not scored, so only the one scored item counts
    assert failures == ["authored run: 1 scored items carry no verified served model id"]


# --- ai-agent-25: jurors outside the author's vendor too, and a summary that names them ------------


@pytest.mark.parametrize(
    "juror",
    [
        "claude-cli:claude-opus-5",
        "anthropic:claude-sonnet-5",
        "bedrock:anthropic.claude-opus-5",
        "bedrock:us.anthropic.claude-opus-5-v1:0",
        "bedrock-converse:global.anthropic.claude-sonnet-5",
    ],
)
def test_gate_fails_a_juror_from_the_author_vendor(tmp_path: Path, juror: str) -> None:
    """authored-v2 is Claude-authored (docs rows by dc-evals author, new-facts rows by the runner's
    claude CLI), so an Anthropic juror is not independent of the drafts it labels."""
    spec, run_rows = authored_spec(tmp_path, jurors=f"{DEFAULT_JURORS},{juror}")
    failures = evaluate(tmp_path, authored=authored_run(tmp_path, spec, authored_records(run_rows)), spec=spec)["failures"]
    assert failures == [f"juror {juror} shares the author's vendor anthropic; the authored labels are not independent"]


def test_gate_fails_a_juror_from_a_recorded_author_model_vendor(tmp_path: Path) -> None:
    spec, run_rows = authored_spec(tmp_path, jurors=DEFAULT_JURORS)
    authored = [json.loads(line) for line in spec.path.read_text(encoding="utf-8").splitlines()]
    authored[0] = {**authored[0], "authorModel": "deepseek.v3.2"}
    spec.path.write_text("".join(json.dumps(row) + "\n" for row in authored), encoding="utf-8")
    assert gate.author_vendors(authored) == ["anthropic", "deepseek", "m"]
    failures = evaluate(tmp_path, authored=authored_run(tmp_path, spec, authored_records(run_rows)), spec=spec)["failures"]
    assert "juror bedrock-converse:deepseek.v3.2 shares the author's vendor deepseek; the authored labels are not " \
           "independent" in failures


@pytest.mark.parametrize("summary", [{"v": 1, "dataset": "authored-v2", "jurors": []}, {"v": 1, "dataset": "authored-v2"}])
def test_gate_fails_a_jury_summary_without_jurors(tmp_path: Path, summary: dict[str, Any]) -> None:
    spec, run_rows = authored_spec(tmp_path)
    summary_file = summary_path(spec.labels_path)
    summary_file.write_text(json.dumps(summary), encoding="utf-8")
    failures = evaluate(tmp_path, authored=authored_run(tmp_path, spec, authored_records(run_rows)), spec=spec)["failures"]
    assert failures == [
        f"authored run: the jury summary {summary_file} names no jurors; the labels' independence cannot be checked"
    ]


def test_default_jurors_are_independent_of_reviewer_and_author() -> None:
    authors = gate.author_vendors([])
    assert authors == ["anthropic"]
    vendors = [gate.juror_vendor(j) for j in DEFAULT_JURORS.split(",")]
    assert vendors == ["qwen", "deepseek", "moonshotai"]
    assert not set(vendors) & {*authors, "openai"}

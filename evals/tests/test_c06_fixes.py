"""C06 (R18C fix round 2): an executable new-facts procedure (ai-agent-12), a CI-bounded new-facts
stratum (ai-agent-15), the author configuration bound into the gate report (ai-agent-3) and the
openai-mantle automation provider (ai-agent-11, contract L1). Fakes only; nothing calls a model."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from conftest import FakeLlm, reply, review_json
from test_automation_gate import (
    AUTHOR_CONFIG,
    authored_records,
    authored_run,
    authored_spec,
    evaluate,
    seeded_run,
    write_env,
    write_lines,
)
from test_b06_gate_fixes import AUTOMATION_TEXT, RUN_AUTHOR, _draft, _ingest, _rewrite, _runs_dir

from ai_qa import prompts
from ai_qa import settings as ai_qa_settings
from dc_evals import automation_gate as gate
from dc_evals.cli import main
from dc_evals.dataset import EVALS_ROOT, STRATUM_NEW_FACTS, read_jsonl
from dc_evals.drafts_import import (
    NEW_FACTS_AUTOMATION_MODE,
    NEW_FACTS_QUEUE_NOTE,
    RUNNER_AUTHOR_PATH,
    default_runs_dir,
    draft_rows,
    import_drafts,
)
from dc_evals.report import read_run
from dc_evals.runner import AUTOMATION_PROMPT_VERSION
from dc_evals.score import clustered_wilson_ci

REPO_ROOT = EVALS_ROOT.parent
MANTLE = "openai-mantle"
MANTLE_MODEL = "openai.gpt-5.5"


# --- ai-agent-12: the new-facts procedure runs in a mode the runner claims under -------------------


def _new_facts_procedure() -> str:
    text = (EVALS_ROOT / "README.md").read_text(encoding="utf-8")
    start = text.index("### New-facts stratum")
    end = text.index("\n### ", start + 1)
    return text[start:end]


def _automation_modes() -> set[str]:
    """Every AUTOMATION_MODE value core knows (src_C AutomationMode)."""
    source = (REPO_ROOT / "src_C" / "Vpc" / "Automation" / "AutomationMode.cs").read_text(encoding="utf-8")
    line = re.search(r'public const string Off = "(\w+)", DryRun = "(\w+)", Live = "(\w+)";', source)
    assert line is not None, "AutomationMode.cs no longer declares Off / DryRun / Live"
    return set(line.groups())


def _modes_the_runner_does_not_claim_under() -> set[str]:
    """The effective modes under which the runner exits without claiming (runner.ts) and the claim
    route answers no items (RunnerRoutes.cs)."""
    runner = (REPO_ROOT / "tools" / "author-runner" / "src" / "runner.ts").read_text(encoding="utf-8")
    idle = set(re.findall(r"effectiveMode === '(\w+)'", runner))
    routes = (REPO_ROOT / "src_C" / "Vpc" / "Automation" / "RunnerRoutes.cs").read_text(encoding="utf-8")
    names = set(re.findall(r"mode\.Effective == AutomationMode\.(\w+)\)", routes))
    constants = {"Off": "off", "DryRun": "dry_run", "Live": "live"}
    assert idle and names, "the runner's no-claim rule moved; re-read runner.ts and RunnerRoutes.cs"
    return idle | {constants[name] for name in names}


def test_new_facts_procedure_uses_a_mode_the_runner_claims_under() -> None:
    procedure = _new_facts_procedure()
    modes = set(re.findall(r"AUTOMATION_MODE=(\w+)", procedure))
    idle = _modes_the_runner_does_not_claim_under()
    assert idle == {"off"}
    assert modes == {NEW_FACTS_AUTOMATION_MODE} == {"dry_run"}
    assert modes <= _automation_modes()
    assert not modes & idle, f"the runner claims nothing under {sorted(modes & idle)}"
    # live would auto-accept and publish the eval drafts, and needs a passed gate in the first place
    assert "live" not in modes


def test_new_facts_procedure_runs_on_the_stack_that_exists() -> None:
    procedure = _new_facts_procedure()
    assert "sandbox" not in procedure.lower()
    assert "production" in procedure
    # an explicit QA choice: off, so every eval decision routes to a human (QA_UNAVAILABLE), never
    # would_accept, and the shadow agreement (would_accept decisions only) never counts them
    assert "AI_QA_ENABLED=0" in procedure and "QA_UNAVAILABLE" in procedure and "shadow agreement" in procedure
    # tagged, exported, then rejected so they leave the review queue
    assert f'"note": "{NEW_FACTS_QUEUE_NOTE}"' in procedure
    assert "GET /api/v1/authoring/drafts/:draftId" in procedure
    assert "Reject" in procedure and "POST /api/v1/authoring/drafts/:draftId/reject" in procedure
    assert "--runs-dir" in procedure


# --- ai-agent-15: the new-facts stratum is gated on its CI lower bound ------------------------------


def test_new_facts_minimum_is_the_smallest_sample_that_can_pass_the_ci_bound() -> None:
    lower_gate = gate.NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE
    assert lower_gate == gate.AUTO_ACCEPT_PRECISION_CI_LOWER_GATE == 0.93
    minimum = gate.MIN_NEW_FACTS_WOULD_ACCEPT_CARDS
    # every card correct and both repetitions agreeing: the distinct-card Wilson bound
    assert clustered_wilson_ci([(2, 2)] * minimum)[0] >= lower_gate
    assert clustered_wilson_ci([(2, 2)] * (minimum - 1))[0] < lower_gate
    assert minimum == 51
    assert gate.THRESHOLDS["newFactsAutoAcceptPrecisionCiLower"] == lower_gate


def test_new_facts_stratum_fails_on_its_ci_lower_bound_when_the_point_estimate_passes(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)

    def one_wrong_new_facts_card(row: dict[str, Any]) -> dict[str, Any]:
        if row["id"] == "a-0131":  # the first defective card, which escapes in every rep below
            return {**row, "stratum": STRATUM_NEW_FACTS, "authorPath": RUNNER_AUTHOR_PATH, "runId": "run-x",
                    "authorConfig": AUTHOR_CONFIG}
        return row

    _rewrite(spec, one_wrong_new_facts_card)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows, escaped=1)))
    new = report["authored"]["strata"][STRATUM_NEW_FACTS]
    # 61 cards, 120 of 122 would-accept items correct: the point estimate passes, the bound does not
    assert (new["wouldAcceptCards"], new["wouldAccept"], new["wouldAcceptCorrect"]) == (61, 122, 120)
    assert new["autoAcceptPrecision"] >= gate.NEW_FACTS_AUTO_ACCEPT_PRECISION_GATE
    lower = new["autoAcceptPrecisionCi95"][0]
    assert lower < 0.93
    assert report["failures"] == [f"new-facts stratum auto-accept precision 95% CI lower bound {lower:.4f} < 0.93"]
    md = gate.render_markdown(report)
    assert ">= 0.97, CI lower >= 0.93, on >= 51 cards" in md


def test_new_facts_stratum_at_the_minimum_passes(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path, new_facts=51)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [] and report["authored"]["strata"][STRATUM_NEW_FACTS]["wouldAcceptCards"] == 51


# --- ai-agent-3: the gate report binds the author configuration ------------------------------------


def test_gate_report_binds_the_author_configuration(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    assert report["passed"] is True
    assert report["authored"]["author"] == {
        "model": "claude-opus-5-5",
        "skillVersion": "author-cards@1.2.0",
        "authorConfigIds": ["0123456789abcdef"],
        "configs": [AUTHOR_CONFIG],
    }
    md = gate.render_markdown(report)
    assert "- Author (new-facts stratum): claude-opus-5-5, skill author-cards@1.2.0, author configuration " \
           "`0123456789abcdef` (any change of the author configuration needs a new gate)" in md


def test_gate_fails_closed_on_new_facts_rows_without_an_author_configuration(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    _rewrite(spec, lambda row: {k: v for k, v in row.items() if k != "authorConfig"} if row["id"] == "a-0100" else row)
    partial = {k: v for k, v in AUTHOR_CONFIG.items() if k != "promptSha256"}
    _rewrite(spec, lambda row: {**row, "authorConfig": partial} if row["id"] == "a-0101" else row)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [
        "2 new-facts row(s) have no complete authorConfig (rerun dc-evals import-drafts with the runner's run records)"
    ]


def test_gate_fails_on_new_facts_rows_from_two_author_models_and_lists_every_configuration(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    other = {**AUTHOR_CONFIG, "id": "fedcba9876543210", "model": "claude-fable-5-1", "claudeVersion": "2.2.0"}
    _rewrite(spec, lambda row: {**row, "authorConfig": other} if row["id"] == "a-0130" else row)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [
        "the new-facts rows come from 2 author models (claude-fable-5-1, claude-opus-5-5); the gate measures one"
    ]
    author = report["authored"]["author"]
    assert author["authorConfigIds"] == ["0123456789abcdef", "fedcba9876543210"] and author["model"] is None
    # a changed prompt or CLI under the same model and skill: a second id, both bound by the gate
    spec2_dir = tmp_path / "same-model"
    spec2_dir.mkdir()
    spec2, rows2 = authored_spec(spec2_dir)
    changed = {**AUTHOR_CONFIG, "id": "1111111111111111", "promptSha256": "e" * 64}
    _rewrite(spec2, lambda row: {**row, "authorConfig": changed} if row["id"] == "a-0130" else row)
    report2 = evaluate(spec2_dir, spec=spec2, authored=authored_run(spec2_dir, spec2, authored_records(rows2)))
    assert report2["passed"] is True
    assert report2["authored"]["author"]["authorConfigIds"] == ["0123456789abcdef", "1111111111111111"]


def test_import_drafts_records_the_run_author_configuration(tmp_path: Path, capsys) -> None:
    runs_dir = _runs_dir(tmp_path, {
        "run-1": RUN_AUTHOR,
        "run-model": {**RUN_AUTHOR, "model": "claude-fable-5-1"},
        "run-partial": {k: v for k, v in RUN_AUTHOR.items() if k != "mcpServerSha256"},
    })
    (runs_dir / "run-bad.meta.json").write_text("{", encoding="utf-8")
    (runs_dir / "run-other.meta.json").write_text(json.dumps({"runId": "run-9", "authorConfig": RUN_AUTHOR}),
                                                  encoding="utf-8")
    drafts = [_draft(1), _draft(2, run_id="run-missing"), _draft(3, run_id="run-model"),
              _draft(4, run_id="run-partial"), _draft(5, run_id="run-bad"), _draft(6, run_id="run-other"),
              _draft(7, run_id="../run-1")]
    rows, dropped = draft_rows(drafts, {7: "aws-saa-c03"}, runs_dir=runs_dir, ingest_fn=_ingest,
                               imported_at="2026-09-28T00:00:00Z")
    assert [(row["draftId"], row["authorConfig"]) for row in rows] == [(1, RUN_AUTHOR)]
    text = "\n".join(dropped)
    assert "draft 2: no run record" in text and "run-missing.meta.json" in text
    assert "draft 3: agent.model 'claude-opus-5-5' is not its run's author model 'claude-fable-5-1'" in text
    assert "draft 4: run record" in text and "authorConfig lacks mcpServerSha256" in text
    assert "draft 5: run record" in text and "is not JSON" in text
    assert "draft 6: run record" in text and "is not the record of run run-other" in text
    assert "draft 7: run id '../run-1' is not a run record name" in text
    # the CLI refuses a runs directory that does not exist
    drafts_file = write_lines(tmp_path / "drafts.jsonl", [_draft(1)])
    assert main(["import-drafts", "--drafts", str(drafts_file), "--deck", "7=aws-saa-c03", "--output",
                 str(tmp_path / "out.jsonl"), "--runs-dir", str(tmp_path / "nowhere")]) == 2
    assert "does not exist (pass --runs-dir)" in capsys.readouterr().err
    output = tmp_path / "authored-v2.jsonl"
    assert import_drafts(drafts_path=drafts_file, decks={7: "aws-saa-c03"}, output=output, runs_dir=runs_dir,
                         ingest_fn=_ingest) == 0
    assert read_jsonl(output)[0]["authorConfig"]["id"] == AUTHOR_CONFIG["id"]


def test_default_runs_dir_is_the_runner_log_dir() -> None:
    assert default_runs_dir({"DC_RUNNER_LOG_DIR": "/var/tmp/dc"}) == Path("/var/tmp/dc/runs")
    assert default_runs_dir({}) == Path.home() / "Library" / "Logs" / "DeveloperCards" / "runs"


# --- ai-agent-11 (contract L1): openai-mantle is an automation gate provider -----------------------


def test_gate_accepts_both_automation_providers() -> None:
    assert gate.AUTOMATION_GATE_PROVIDERS == frozenset({"openai-mantle", "bedrock-converse"})


def test_gate_passes_for_an_openai_mantle_reviewer_and_pins_it(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    env = write_env(tmp_path, AI_QA_AUTOMATION_PROVIDER=MANTLE, AI_QA_AUTOMATION_MODEL=MANTLE_MODEL,
                    AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK="5.5", AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK="33")
    seeded = seeded_run(tmp_path, provider=MANTLE, model=MANTLE_MODEL)
    authored = authored_run(tmp_path, spec, authored_records(rows), provider=MANTLE, model=MANTLE_MODEL)
    report = evaluate(tmp_path, seeded=seeded, authored=authored, spec=spec, env=env)
    assert report["failures"] == []
    assert (report["reviewer"]["provider"], report["reviewer"]["model"]) == (MANTLE, MANTLE_MODEL)
    # the reviewer triple pins the provider actually used: a bedrock-converse run is not this gate's evidence
    converse = authored_run(tmp_path, spec, authored_records(rows), model=MANTLE_MODEL)
    failures = evaluate(tmp_path, seeded=seeded, authored=converse, spec=spec, env=env)["failures"]
    assert "authored run: provider 'bedrock-converse' is not AI_QA_AUTOMATION_PROVIDER 'openai-mantle'" in failures
    assert "the seeded and authored runs used different reviewers" in failures


@pytest.fixture
def mantle_provider(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """The ai-qa side of contract L1 (lands in a parallel wave): ai_qa accepts provider openai-mantle,
    and make_client is a fake that records the settings it was built with."""
    if MANTLE not in ai_qa_settings.PROVIDERS:
        monkeypatch.setattr(ai_qa_settings, "PROVIDERS", (*ai_qa_settings.PROVIDERS, MANTLE))
    monkeypatch.setattr(prompts, "PROMPT_VERSION_AUTOMATION", AUTOMATION_PROMPT_VERSION, raising=False)
    monkeypatch.setattr(prompts, "SYSTEM_PROMPT_AUTOMATION", AUTOMATION_TEXT, raising=False)
    built: list[Any] = []
    fake = FakeLlm(lambda uid, kwargs: reply(review_json(), model=MANTLE_MODEL))

    def make_client(settings, api_key=None):
        built.append(settings)
        return fake

    monkeypatch.setattr("ai_qa.providers.make_client", make_client)
    return built


def test_cli_run_reviews_in_process_with_openai_mantle(mantle_provider: list[Any], tmp_path: Path) -> None:
    out = tmp_path / "reports"
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--profile", "automation", "--limit", "2",
                 "--reps", "1", "--out", str(out)]) == 0
    assert [(s.provider, s.model) for s in mantle_provider] == [(MANTLE, MANTLE_MODEL)]
    header, records = read_run(next(out.glob("*.jsonl")))
    assert (header["provider"], header["model"], header["promptVersion"], header["profile"]) == (
        MANTLE, MANTLE_MODEL, "qa-v4-auto", "automation",
    )
    assert [r["status"] for r in records] == ["done", "done"]
    assert {r["servedModel"] for r in records} == {MANTLE_MODEL}


def test_cli_run_refuses_openai_mantle_when_ai_qa_has_no_such_provider(monkeypatch, tmp_path: Path, capsys) -> None:
    monkeypatch.setattr(ai_qa_settings, "PROVIDERS", tuple(p for p in ai_qa_settings.PROVIDERS if p != MANTLE))
    monkeypatch.setattr("ai_qa.providers.make_client", lambda settings, api_key=None: pytest.fail("no client"))
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--dry-run", "--out", str(tmp_path)]) == 2
    assert "AI_PROVIDER must be one of" in capsys.readouterr().err

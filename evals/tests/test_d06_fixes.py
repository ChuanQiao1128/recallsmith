"""D06 (R18D fix round 3): the gated reviewer identity includes the effort the review sent
(ai-agent-9), the new-facts bound clustered by source page (ai-agent-20), the gated authorConfigId
of contract M1, and eval drafts kept out of the agent-quality numbers (automation-24). Fakes only;
nothing calls a model."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from test_automation_gate import (
    AUTHOR_CONFIG,
    authored_records,
    authored_run,
    authored_spec,
    evaluate,
    seeded_run,
    write_env,
)
from test_b06_gate_fixes import RUN_AUTHOR, _draft, _ingest, _rewrite, _runs_dir
from test_c06_fixes import MANTLE, MANTLE_MODEL, mantle_provider

from dc_evals import automation_gate as gate
from dc_evals.cli import main
from dc_evals.dataset import EVALS_ROOT, STRATUM_NEW_FACTS
from dc_evals.drafts_import import (
    NEW_FACTS_QUEUE_NOTE,
    NEW_FACTS_REJECT_REASON,
    draft_rows,
    gated_author_config_id,
)
from dc_evals.report import read_run
from dc_evals.score import clustered_wilson_ci

REPO_ROOT = EVALS_ROOT.parent
# the openai-mantle fixture of C06, used by the run tests below
__all__ = ["mantle_provider"]


# --- ai-agent-9: the effort the review sent is part of the gated reviewer identity -----------------


def test_gate_fails_closed_on_runs_that_do_not_record_the_effort_sent(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    seeded = seeded_run(tmp_path, effectiveEffort=None)
    authored = authored_run(tmp_path, spec, authored_records(rows), effectiveEffort=None)
    report = evaluate(tmp_path, seeded=seeded, authored=authored, spec=spec)
    assert report["failures"] == [
        f"{which} run: the header records no effectiveEffort (the reasoning effort the review sent); rerun with "
        "dc-evals run --profile automation"
        for which in ("seeded", "authored")
    ]


def test_gate_compares_the_run_effort_with_production(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    mantle = {"provider": MANTLE, "model": MANTLE_MODEL}
    env = write_env(tmp_path, AI_QA_AUTOMATION_PROVIDER=MANTLE, AI_QA_AUTOMATION_MODEL=MANTLE_MODEL, AI_EFFORT="max")
    # reviewed at max: openai-mantle sends it as xhigh, and that is what the header records
    seeded = seeded_run(tmp_path, **mantle, effort="max", effectiveEffort="xhigh")
    authored = authored_run(tmp_path, spec, authored_records(rows), **mantle, effort="max", effectiveEffort="xhigh")
    report = evaluate(tmp_path, seeded=seeded, authored=authored, spec=spec, env=env)
    assert report["failures"] == []
    assert (report["reviewer"]["effort"], report["reviewer"]["effectiveEffort"]) == ("max", "xhigh")
    md = gate.render_markdown(report)
    assert "effort max (sent as xhigh), served by anthropic.claude-opus-5" in md
    # the owner's shell effort (high) is not production's (max): both checks name it
    stale = authored_run(tmp_path, spec, authored_records(rows), **mantle, effort="high", effectiveEffort="high")
    failures = evaluate(tmp_path, seeded=seeded, authored=stale, spec=spec, env=env)["failures"]
    assert failures == [
        "authored run: effort 'high' is not the production AI_EFFORT 'max'",
        "authored run: effective effort 'high' is not 'xhigh', the production AI_EFFORT 'max' as openai-mantle sends it",
        "the seeded and authored runs used different reviewers",
    ]


def test_gate_refuses_an_invalid_production_effort(tmp_path: Path) -> None:
    failures = evaluate(tmp_path, env=write_env(tmp_path, AI_EFFORT="turbo"))["failures"]
    assert failures == ["AI_EFFORT 'turbo' in " + str(tmp_path / "prod.env.json") + " is not one of low, medium, "
                        "high, xhigh, max"]


def test_seeded_and_authored_runs_must_send_the_same_effort(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    # bedrock-converse sends no effort, so a different configured AI_EFFORT shows only in `effort`
    authored = authored_run(tmp_path, spec, authored_records(rows), effort="low")
    failures = evaluate(tmp_path, authored=authored, spec=spec)["failures"]
    assert failures == [
        "authored run: effort 'low' is not the production AI_EFFORT 'high'",
        "the seeded and authored runs used different reviewers",
    ]


def test_gate_reports_the_served_model_ids(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    records = authored_records(rows)
    records[0] = {**records[0], "servedModel": "openai.gpt-5.5-2026-09-01"}
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, records))
    assert report["reviewer"]["servedModels"] == ["anthropic.claude-opus-5", "openai.gpt-5.5-2026-09-01"]


def _production_env(tmp_path: Path, **overrides: str) -> Path:
    env = {"AI_PROVIDER": "bedrock", "AI_MODEL": "anthropic.claude-opus-5", "AI_EFFORT": "max",
           "AI_QA_AUTOMATION_PROVIDER": MANTLE, "AI_QA_AUTOMATION_MODEL": MANTLE_MODEL,
           "AI_QA_AUTOMATION_REGION": "us-east-2", "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "5.5",
           "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK": "33", **overrides}
    path = tmp_path / "prod.env.json"
    path.write_text(json.dumps(env), encoding="utf-8")
    return path


def test_cli_automation_run_takes_effort_prices_and_region_from_production(
    mantle_provider: list[Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    # the owner's shell says otherwise; none of it is what production's automation reviewer runs with
    for key, value in {"AI_EFFORT": "low", "AI_PRICE_INPUT_PER_MTOK": "999", "AI_PRICE_OUTPUT_PER_MTOK": "999",
                       "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK": "999", "AI_QA_AUTOMATION_REGION": "eu-west-1"}.items():
        monkeypatch.setenv(key, value)
    env_file = _production_env(tmp_path)
    out = tmp_path / "reports"
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--profile", "automation", "--limit", "2",
                 "--reps", "1", "--out", str(out), "--ai-qa-env", str(env_file)]) == 0
    [settings] = mantle_provider
    assert (settings.provider, settings.model, settings.effort) == (MANTLE, MANTLE_MODEL, "max")
    assert (settings.price_input_per_mtok, settings.price_output_per_mtok) == (5.5, 33.0)
    assert settings.automation_region == "us-east-2"
    header, _ = read_run(next(out.glob("*.jsonl")))
    assert (header["effort"], header["effectiveEffort"]) == ("max", "xhigh")
    capsys.readouterr()
    # the dry-run estimate uses the automation prices too
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--profile", "automation", "--limit", "2",
                 "--reps", "1", "--out", str(out), "--ai-qa-env", str(env_file), "--dry-run"]) == 0
    assert "at $5.5/$33.0 per MTok" in capsys.readouterr().out


def test_cli_automation_run_uses_the_ai_qa_default_when_production_sets_no_effort(
    mantle_provider: list[Any], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("AI_EFFORT", "low")
    env_file = tmp_path / "prod.env.json"
    data = json.loads(_production_env(tmp_path).read_text(encoding="utf-8"))
    del data["AI_EFFORT"]
    env_file.write_text(json.dumps(data), encoding="utf-8")
    out = tmp_path / "reports"
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--profile", "automation", "--limit", "1",
                 "--reps", "1", "--out", str(out), "--ai-qa-env", str(env_file)]) == 0
    header, _ = read_run(next(out.glob("*.jsonl")))
    assert (header["effort"], header["effectiveEffort"]) == ("high", "high")


def test_cli_automation_run_refuses_without_the_production_env_or_prices(tmp_path: Path, capsys) -> None:
    assert main(["run", "--provider", MANTLE, "--model", MANTLE_MODEL, "--profile", "automation", "--dry-run",
                 "--out", str(tmp_path), "--ai-qa-env", str(tmp_path / "missing.json")]) == 2
    assert "cannot read the production ai-qa env file" in capsys.readouterr().err
    no_prices = _production_env(tmp_path, AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK="")
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--profile", "automation",
                 "--dry-run", "--out", str(tmp_path), "--ai-qa-env", str(no_prices)]) == 2
    assert "the automation profile needs AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK" in capsys.readouterr().err


# --- ai-agent-20: the new-facts bound clusters by source page -------------------------------------


def _pages(spec, count: int) -> None:
    """Spread the new-facts rows over `count` source pages, round robin."""
    seen = [0]

    def change(row: dict[str, Any]) -> dict[str, Any]:
        if row.get("stratum") != STRATUM_NEW_FACTS:
            return row
        seen[0] += 1
        return {**row, "sourceUrl": f"https://aws.amazon.com/about-aws/whats-new/2026/09/page-{seen[0] % count}/"}

    _rewrite(spec, change)


def test_51_cards_over_18_pages_fail_the_page_clustered_gate(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path, new_facts=51)
    _pages(spec, 18)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    new = report["authored"]["strata"][STRATUM_NEW_FACTS]
    # every card correct: the card bound passes (0.93), the page bound is the 18-cluster bound (0.82)
    assert new["wouldAcceptCards"] == 51 and new["autoAcceptPrecision"] == 1.0
    assert new["autoAcceptPrecisionCi95"][0] >= 0.93 and new["autoAcceptPrecisionEffectiveN"] == 51.0
    assert new["byPage"] == {
        "unit": "source page", "wouldAcceptPages": 18, "effectiveN": 18.0,
        "autoAcceptPrecisionCi95": clustered_wilson_ci([(6, 6)] * 18),
    }
    assert new["byPage"]["autoAcceptPrecisionCi95"][0] == pytest.approx(18 / (18 + 1.96**2), abs=1e-3)
    assert report["failures"] == [
        "new-facts stratum: would-accept cards from 18 distinct source pages, fewer than 51; too few to measure "
        "its precision (add pages to data/authored-sources-v2-new-facts.json)"
    ]
    md = gate.render_markdown(report)
    assert "| new-facts | 51 | 102 (102) | 51 (51.0) | 18 (18.0) | 1.0000 |" in md
    assert "Units of analysis:" in md and "source page" in md


def test_page_minimum_is_the_smallest_that_can_pass_the_page_bound(tmp_path: Path) -> None:
    minimum = gate.MIN_NEW_FACTS_WOULD_ACCEPT_PAGES
    assert minimum == 51 and gate.THRESHOLDS["minNewFactsWouldAcceptPages"] == minimum
    # every item correct: n_eff is the number of pages, however many cards each page gave
    assert clustered_wilson_ci([(6, 6)] * minimum)[0] >= 0.93 > clustered_wilson_ci([(6, 6)] * (minimum - 1))[0]
    # enough pages, several cards each: the gate passes
    spec, rows = authored_spec(tmp_path, new_facts=102)
    _pages(spec, 51)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [] and report["authored"]["strata"][STRATUM_NEW_FACTS]["byPage"]["wouldAcceptPages"] == 51


def test_wrong_cards_from_one_page_are_one_cluster(tmp_path: Path) -> None:
    """Two wrong cards from one misread page: the card interval counts two independent errors, the
    page interval one page whose items are all wrong; the report shows both and gates on both."""
    spec, rows = authored_spec(tmp_path, correct=180, new_facts=120)
    _pages(spec, 60)
    by_id = {row["id"]: row for row in rows}
    wrong = ["a-0061", "a-0121"]  # page-1 and page-1 again (the 1st and 61st new-facts rows)
    records = [{**r, "defect": "incorrect_answer"} if r["id"] in wrong else r for r in authored_records(rows)]
    assert all(by_id[i]["defect"] is None for i in wrong)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, records))
    new = report["authored"]["strata"][STRATUM_NEW_FACTS]
    assert (new["wouldAcceptCards"], new["byPage"]["wouldAcceptPages"]) == (120, 60)
    assert new["byPage"]["effectiveN"] < new["autoAcceptPrecisionEffectiveN"]
    assert new["byPage"]["autoAcceptPrecisionCi95"][0] < new["autoAcceptPrecisionCi95"][0]


def test_page_key_normalises_the_source_url() -> None:
    assert gate.page_key({"sourceUrl": "HTTPS://AWS.amazon.com/a/b/#top"}) == gate.page_key(
        {"sourceUrl": "https://aws.amazon.com/a/b"}
    )
    assert gate.page_key({"sourceUrl": "https://x.dev/p?v=1"}) != gate.page_key({"sourceUrl": "https://x.dev/p?v=2"})
    assert gate.page_key({"id": "n-0001"}) == "row:n-0001"


# --- contract M1: the gated authorConfigId --------------------------------------------------------


def test_gated_author_config_id_is_the_runners() -> None:
    """The vector node computes with tools/author-runner/src/authorConfig.ts authorConfigIdOf's
    algorithm (canonical JSON of the five fields, sorted keys, no spaces, sha256 hex)."""
    config = {"claudeArgsSha256": "c" * 64, "model": "claude-opus-5-5", "promptSha256": "b" * 64,
              "skillSha256": "a" * 64, "skillVersion": "author-cards@1.2.0", "claudeVersion": "9.9.9",
              "runnerVersion": "9.9.9", "mcpServerSha256": "f" * 64}
    assert gated_author_config_id(config) == "1c0f21219c13236f0d8ead804d90ccd7439244a0caecfbba5f8d3075982c4b6a"
    assert AUTHOR_CONFIG["authorConfigId"] == gated_author_config_id(AUTHOR_CONFIG)
    source = (REPO_ROOT / "tools" / "author-runner" / "src" / "authorConfig.ts").read_text(encoding="utf-8")
    body = source[source.index("export function authorConfigIdOf"):]
    body = body[: body.index("\n}\n")]
    assert set(re.findall(r"^\s+(\w+): config\.\w+,$", body, re.M)) == {
        "argsSha256", "model", "promptSha256", "skillSha256", "skillVersion",
    }


def _meta(runs_dir: Path, run_id: str, config: dict[str, Any], **top: Any) -> None:
    meta = {"runId": run_id, "itemId": 1, "startedAt": "2026-09-28T00:00:00Z", **top, "authorConfig": config}
    (runs_dir / f"{run_id}.meta.json").write_text(json.dumps(meta), encoding="utf-8")


def test_import_copies_the_gated_id_from_the_run_record(tmp_path: Path) -> None:
    runs_dir = _runs_dir(tmp_path, {})
    inner = {k: v for k, v in RUN_AUTHOR.items() if k != "authorConfigId"}
    _meta(runs_dir, "run-top", inner, authorConfigId=RUN_AUTHOR["authorConfigId"])  # top level only
    _meta(runs_dir, "run-both", RUN_AUTHOR, authorConfigId=RUN_AUTHOR["authorConfigId"])
    _meta(runs_dir, "run-old", inner)  # a runner from before M1
    _meta(runs_dir, "run-forged", {**RUN_AUTHOR, "authorConfigId": "0" * 64})
    _meta(runs_dir, "run-two", RUN_AUTHOR, authorConfigId="1" * 64)
    drafts = [_draft(1, run_id="run-top"), _draft(2, run_id="run-both"), _draft(3, run_id="run-old"),
              _draft(4, run_id="run-forged"), _draft(5, run_id="run-two"), _draft(6, run_id="run-both")]
    drafts[5]["agent"]["authorConfigId"] = "2" * 64
    rows, dropped = draft_rows(drafts, {7: "aws-saa-c03"}, runs_dir=runs_dir, ingest_fn=_ingest,
                               imported_at="2026-09-28T00:00:00Z")
    assert [(row["draftId"], row["authorConfig"].get("authorConfigId")) for row in rows] == [
        (1, RUN_AUTHOR["authorConfigId"]), (2, RUN_AUTHOR["authorConfigId"]), (3, None),
    ]
    text = "\n".join(dropped)
    assert "draft 4: run record" in text and "is not the id of its configuration" in text
    assert "draft 5: run record" in text and "two different authorConfigId values" in text
    assert f"draft 6: agent.authorConfigId '{'2' * 64}' is not its run's author authorConfigId" in text


def test_gate_fails_closed_on_new_facts_rows_without_the_gated_id(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    old = {k: v for k, v in AUTHOR_CONFIG.items() if k != "authorConfigId"}
    _rewrite(spec, lambda row: {**row, "authorConfig": old} if row["id"] == "a-0100" else row)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [
        "1 new-facts row(s) carry no authorConfigId matching their authorConfig (import them with run records of "
        "an author-runner that records the gated authorConfigId, contract M1)"
    ]
    assert report["authored"]["author"]["authorConfigId"] is None
    assert "gated authorConfigId none (the gate fails closed)" in gate.render_markdown(report)


def test_gate_fails_on_more_than_one_gated_id(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    changed = {**AUTHOR_CONFIG, "id": "2222222222222222", "promptSha256": "e" * 64}
    changed["authorConfigId"] = gated_author_config_id(changed)
    _rewrite(spec, lambda row: {**row, "authorConfig": changed} if row["id"] == "a-0130" else row)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    ids = ", ".join(sorted([AUTHOR_CONFIG["authorConfigId"], changed["authorConfigId"]]))
    assert report["failures"] == [
        f"the new-facts rows come from 2 gated author configurations ({ids}); the gate binds one authorConfigId"
    ]
    assert report["authored"]["author"]["authorConfigId"] is None


def test_passing_report_carries_the_one_gated_id(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    assert report["passed"] is True
    assert report["authored"]["author"]["authorConfigId"] == AUTHOR_CONFIG["authorConfigId"]


# --- automation-24: eval drafts stay out of the agent-quality numbers -----------------------------


def _reasons(name: str) -> list[str]:
    source = (REPO_ROOT / "src_C" / "Vpc" / "Review" / "Drafts.cs").read_text(encoding="utf-8")
    match = re.search(rf"{name} = \[([^\]]*)\]", source)
    assert match is not None, f"Drafts.cs no longer declares {name}"
    return re.findall(r'"(\w+)"', match.group(1))


def test_eval_drafts_are_rejected_with_a_non_defect_reason_and_the_eval_tag() -> None:
    assert NEW_FACTS_REJECT_REASON in _reasons("RejectReasons")
    assert NEW_FACTS_REJECT_REASON not in _reasons("DefectReasons")
    text = (EVALS_ROOT / "README.md").read_text(encoding="utf-8")
    start = text.index("### New-facts stratum")
    procedure = text[start:text.index("\n### ", start + 1)]
    step5 = procedure[procedure.index("\n5. "):procedure.index("\n6. ")]
    assert (f'`{{ "reason": "{NEW_FACTS_REJECT_REASON}", "note": "{NEW_FACTS_QUEUE_NOTE}" }}`') in step5
    assert "agentDrafts" in step5 and "starts with `eval:`" in step5 and "D06-fixes.md" in step5

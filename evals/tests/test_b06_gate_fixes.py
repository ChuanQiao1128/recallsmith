"""B06 (R18B fix round 1): the automation profile (contract K1), the authored-v2 new-facts stratum
authored through the production runner path, per-stratum precision, and the rows the jury could not
label (ai-agent-5, ai-agent-4). No model, no network: fake clients, fake ingest, files in tmp_path."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from conftest import FakeLlm, reply, review_json
from test_automation_gate import (
    AUTOMATION,
    authored_records,
    authored_run,
    authored_spec,
    evaluate,
    seeded_run,
    write_lines,
)

from ai_qa import prompts
from dc_evals import automation_gate as gate
from dc_evals.cli import main
from dc_evals.dataset import (
    AUTHORED_V2_NEW_FACTS_SOURCES_PATH,
    AUTHORED_V2_SOURCES_PATH,
    EVALS_ROOT,
    STRATUM_NEW_FACTS,
    DatasetSpec,
    file_sha256,
    load_rows,
    read_jsonl,
)
from dc_evals.drafts_import import RUNNER_AUTHOR_PATH, draft_rows, import_drafts, parse_deck_map
from dc_evals.jury import dataset_rows
from dc_evals.report import read_run
from dc_evals.runner import AUTOMATION_PROMPT_VERSION, SystemPromptClient, profile_prompt, run_eval

AUTOMATION_TEXT = prompts.SYSTEM_PROMPT + "\n\n# Automation\n\nAn unconfirmable claim is source_unsupported (major)."


@pytest.fixture
def automation_prompt(monkeypatch: pytest.MonkeyPatch) -> str:
    """The ai-qa side of contract K1 (lands in a parallel wave): the automation prompt constants."""
    monkeypatch.setattr(prompts, "PROMPT_VERSION_AUTOMATION", AUTOMATION_PROMPT_VERSION, raising=False)
    monkeypatch.setattr(prompts, "SYSTEM_PROMPT_AUTOMATION", AUTOMATION_TEXT, raising=False)
    return AUTOMATION_TEXT


def _rewrite(spec: DatasetSpec, change) -> None:
    rows = [change(row) for row in read_jsonl(spec.path)]
    write_lines(spec.path, rows)


# --- K1: the gate measures the automation profile (ai-agent-5 a) ------------------------------------


def test_gate_refuses_default_profile_runs(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    default = {"promptVersion": prompts.PROMPT_VERSION}
    seeded = seeded_run(tmp_path, **default, profile=None)
    authored_path = authored_run(tmp_path, spec, authored_records(rows), **default, profile=None)
    failures = evaluate(tmp_path, seeded=seeded, authored=authored_path, spec=spec)["failures"]
    for which in ("seeded", "authored"):
        assert f"{which} run: profile 'default' is not 'automation' (dc-evals run --profile automation)" in failures
        assert f"{which} run: promptVersion 'qa-v4' is not the automation prompt version 'qa-v4-auto'" in failures


def test_gate_report_records_the_reviewer_triple_and_profile(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    assert report["passed"] is True
    reviewer = report["reviewer"]
    assert (reviewer["provider"], reviewer["model"], reviewer["promptVersion"]) == (
        "bedrock-converse", "global.openai.gpt-5.5", "qa-v4-auto",
    )
    assert reviewer["profile"] == "automation"
    assert "prompt qa-v4-auto (profile automation)" in gate.render_markdown(report)


def test_gate_refuses_an_installed_automation_prompt_of_another_version(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(prompts, "PROMPT_VERSION_AUTOMATION", "qa-v5-auto", raising=False)
    assert evaluate(tmp_path)["failures"] == [
        "ai_qa PROMPT_VERSION_AUTOMATION 'qa-v5-auto' is not the automation prompt version 'qa-v4-auto'"
    ]


def test_profile_prompt_never_falls_back_to_the_default_prompt(monkeypatch) -> None:
    monkeypatch.delattr(prompts, "SYSTEM_PROMPT_AUTOMATION", raising=False)
    monkeypatch.delattr(prompts, "PROMPT_VERSION_AUTOMATION", raising=False)
    assert profile_prompt("default") == (prompts.PROMPT_VERSION, None)
    with pytest.raises(ValueError, match="no SYSTEM_PROMPT_AUTOMATION"):
        profile_prompt("automation")
    monkeypatch.setattr(prompts, "SYSTEM_PROMPT_AUTOMATION", AUTOMATION_TEXT, raising=False)
    monkeypatch.setattr(prompts, "PROMPT_VERSION_AUTOMATION", "qa-v4", raising=False)
    with pytest.raises(ValueError, match="is 'qa-v4', not 'qa-v4-auto'"):
        profile_prompt("automation")
    with pytest.raises(ValueError, match="unknown profile"):
        profile_prompt("other")


def test_automation_profile_reviews_with_the_automation_prompt(settings, automation_prompt: str) -> None:
    fake = FakeLlm(lambda uid, kwargs: reply(review_json()))
    rows = [{"id": "s-0001", "defect": None, "card": {"stableUid": "u1", "question": "Q?", "explanation": "E."}}]
    version, system = profile_prompt("automation")
    assert version == "qa-v4-auto" and system == automation_prompt
    records = run_eval(rows, client=SystemPromptClient(fake, system), settings=settings, review_date="2026-09-28")
    assert records[0]["status"] == "done"
    assert [block["text"] for block in fake.calls[0]["system"]] == [automation_prompt]
    # a request that does not carry the default prompt is refused, never sent
    with pytest.raises(RuntimeError, match="profile prompt was not applied"):
        SystemPromptClient(fake, system).create(system=[{"type": "text", "text": "other"}], messages=[])


def test_cli_run_with_the_automation_profile(monkeypatch, tmp_path: Path, capsys, automation_prompt: str) -> None:
    fake = FakeLlm(lambda uid, kwargs: reply(review_json()))
    monkeypatch.setattr("ai_qa.providers.make_client", lambda settings, api_key=None: fake)
    out = tmp_path / "reports"
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--profile", "automation", "--limit",
                 "1", "--reps", "1", "--out", str(out)]) == 0
    run_file = next(out.glob("*.jsonl"))
    header, _ = read_run(run_file)
    assert (header["promptVersion"], header["profile"]) == ("qa-v4-auto", "automation")
    assert "qa-v4-auto" in run_file.name
    assert fake.calls[0]["system"][0]["text"] == automation_prompt
    capsys.readouterr()
    # the automation reviewer runs alone
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--profile", "automation",
                 "--second-provider", "bedrock-converse", "--second-model", "mistral.mistral-large-3", "--dry-run",
                 "--out", str(out)]) == 2
    assert "reviews alone" in capsys.readouterr().err
    # a default run's header is unchanged (no profile key)
    out2 = tmp_path / "default"
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--limit", "1", "--reps", "1",
                 "--out", str(out2)]) == 0
    header, _ = read_run(next(out2.glob("*.jsonl")))
    assert header["promptVersion"] == prompts.PROMPT_VERSION and "profile" not in header


def test_cli_run_automation_profile_needs_the_ai_qa_prompt(monkeypatch, tmp_path: Path, capsys) -> None:
    monkeypatch.delattr(prompts, "SYSTEM_PROMPT_AUTOMATION", raising=False)
    assert main(["run", "--provider", "anthropic", "--model", "claude-opus-5", "--profile", "automation",
                 "--dry-run", "--out", str(tmp_path)]) == 2
    assert "no SYSTEM_PROMPT_AUTOMATION" in capsys.readouterr().err


# --- the new-facts stratum and per-stratum precision (ai-agent-5 b, c) -----------------------------


def test_report_has_per_stratum_precision(tmp_path: Path) -> None:
    report = evaluate(tmp_path)
    strata = report["authored"]["strata"]
    assert list(strata) == ["docs", "new-facts"]
    assert (strata["docs"]["rows"], strata["docs"]["wouldAcceptCards"], strata["docs"]["defectiveLabeled"]) == (
        100, 90, 20,
    )
    new = strata[STRATUM_NEW_FACTS]
    assert (new["rows"], new["wouldAccept"], new["wouldAcceptCards"], new["autoAcceptPrecision"]) == (40, 80, 40, 1.0)
    md = gate.render_markdown(report)
    assert "### Per stratum" in md and "| new-facts | 40 | 80 (80) | 40 | 1.0000 |" in md
    assert "not the production path" in md


def test_gate_fails_closed_without_a_new_facts_stratum(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path, new_facts=0)
    failures = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))["failures"]
    assert failures == [
        "authored-v2 has no new-facts rows (dc-evals import-drafts); the gate needs the new-facts stratum"
    ]


def test_gate_fails_closed_below_the_new_facts_minimum_sample(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path, new_facts=29)
    failures = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))["failures"]
    assert failures == [
        "new-facts stratum: 29 distinct would-accept cards, fewer than 30; too few to measure its precision"
    ]


def test_new_facts_stratum_must_meet_the_precision_gate_on_its_own(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)

    def to_new_facts(row: dict[str, Any]) -> dict[str, Any]:
        if row["id"] > "a-0130":  # the ten defective cards
            return {**row, "stratum": "new-facts", "authorPath": RUNNER_AUTHOR_PATH, "runId": "run-x"}
        return row

    _rewrite(spec, to_new_facts)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows, escaped=2)))
    # overall: 260 of 264 would-accept items correct (0.9848) passes; new-facts alone: 80 of 84
    assert report["authored"]["autoAcceptPrecision"] >= 0.97
    assert report["authored"]["strata"]["new-facts"]["autoAcceptPrecision"] == 0.9524
    assert report["failures"] == ["new-facts stratum auto-accept precision 0.9524 < 0.97"]


def test_new_facts_rows_must_come_from_the_runner(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    _rewrite(spec, lambda row: {k: v for k, v in row.items() if k != "authorPath"} if row["id"] == "a-0100" else row)
    failures = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))["failures"]
    assert failures == ["1 new-facts row(s) were not authored by the author-runner"]


def test_dataset_rows_carry_the_stratum() -> None:
    card = {"stableUid": "u"}
    authored = [{"id": "a-0001", "deckSlug": "d", "card": card}, {"id": "n-0001", "stratum": "new-facts",
                                                                   "deckSlug": "d", "card": card}]
    labels = [{"id": i, "scorable": True, "defect": None} for i in ("a-0001", "n-0001")]
    assert [row["stratum"] for row in dataset_rows(authored, labels)] == ["docs", "new-facts"]


def test_new_facts_sources_are_official_announcements() -> None:
    rows = json.loads(AUTHORED_V2_NEW_FACTS_SOURCES_PATH.read_text(encoding="utf-8"))
    assert 15 <= len(rows) <= 20
    assert all(list(row) == ["url", "deckSlug", "topicHint", "title"] for row in rows)
    assert len({row["url"] for row in rows}) == len(rows)
    official = {
        "aws-saa-c03": ("https://aws.amazon.com/about-aws/whats-new/",),
        "claude-ccdv-f": ("https://platform.claude.com/docs/", "https://www.anthropic.com/"),
    }
    text = (EVALS_ROOT.parent / "content" / "decks" / "FORMAT.md").read_text(encoding="utf-8")
    labels = set(re.findall(r"\|\s*`([^`]+)`\s*\|\s*$", text, re.M))
    for row in rows:
        assert row["url"].startswith(official[row["deckSlug"]]) and "#" not in row["url"], row["url"]
        assert row["topicHint"] in labels and row["title"].strip()
    assert {row["deckSlug"] for row in rows} == set(official)
    established = {row["url"] for row in json.loads(AUTHORED_V2_SOURCES_PATH.read_text(encoding="utf-8"))}
    assert not established & {row["url"] for row in rows}
    assert any("release-notes" in row["url"] for row in rows)


# --- import-drafts: the production-path drafts become new-facts rows -------------------------------

QUOTE = "Kinesis Data Streams now assigns partition keys for you when you enable service-managed keys."


def _draft(draft_id: int, *, run_id: str | None = "run-1", quote: str = QUOTE, deck_id: int = 7) -> dict[str, Any]:
    agent = {"name": "author-runner", "model": "claude-opus-5-5", "skillVersion": "abc123", "queueItemId": "q-1"}
    if run_id:
        agent["runId"] = run_id
    card = {"stableUid": f"n{draft_id}", "difficulty": 2, "question": "Q?", "explanation": "E.",
            "source": {"url": "https://aws.amazon.com/about-aws/whats-new/2026/09/kinesis/x", "quote": quote}}
    return {"draftId": draft_id, "deckId": deck_id, "status": "pending", "card": card, "agent": agent}


def _ingest(url: str) -> dict[str, Any]:
    return {"url": url, "chunks": [{"id": "c0001", "text": "Intro."}, {"id": "c0002", "text": f"News. {QUOTE} More."}]}


def test_import_drafts_builds_new_facts_rows(tmp_path: Path, capsys) -> None:
    drafts = write_lines(tmp_path / "drafts.jsonl", [
        _draft(1), _draft(2, run_id=None), _draft(3, quote="A sentence the page does not contain at all, anywhere."),
        _draft(4, deck_id=99), _draft(5),
    ])
    output = write_lines(tmp_path / "authored-v2.jsonl", [
        {"id": "a-0001", "deckSlug": "aws-saa-c03", "card": {}},
        {"id": "n-0001", "stratum": "new-facts", "deckSlug": "aws-saa-c03", "card": {}},
    ])
    seen: list[str] = []

    def ingest(url: str) -> dict[str, Any]:
        seen.append(url)
        return _ingest(url)

    assert import_drafts(drafts_path=drafts, decks={7: "aws-saa-c03"}, output=output, ingest_fn=ingest) == 1
    rows = read_jsonl(output)
    assert [row["id"] for row in rows] == ["a-0001", "n-0001", "n-0002"]
    new = rows[1]
    assert new["stratum"] == "new-facts" and new["authorPath"] == RUNNER_AUTHOR_PATH
    assert (new["runId"], new["draftId"], new["skillVersion"], new["authorModel"]) == (
        "run-1", 1, "abc123", "claude-opus-5-5",
    )
    assert (new["chunkId"], new["deckSlug"]) == ("c0002", "aws-saa-c03") and QUOTE in new["chunkText"]
    assert len(seen) == 1  # one read per page
    err = capsys.readouterr().err
    assert "draft 2: not authored by the author-runner" in err
    assert "draft 3: the quote is not verbatim" in err
    assert "draft 4: deck 99 has no --deck mapping" in err


def test_import_drafts_rows_join_the_jury_and_the_run(tmp_path: Path) -> None:
    rows, dropped = draft_rows([_draft(1)], {7: "aws-saa-c03"}, ingest_fn=_ingest, imported_at="2026-09-28T00:00:00Z")
    assert dropped == []
    authored = write_lines(tmp_path / "authored-v2.jsonl", rows)
    labels = write_lines(tmp_path / "authored-v2.labels.jsonl", [
        {"id": "n-0001", "label": "correct", "excluded": None, "defect": None, "scorable": True}
    ])
    spec = DatasetSpec("authored-v2", "authored-v2", authored, None, (), labels_path=labels)
    assert [(row["id"], row["stratum"]) for row in load_rows(spec)] == [("n-0001", "new-facts")]


def test_cli_import_drafts_arguments(tmp_path: Path, capsys, monkeypatch) -> None:
    assert parse_deck_map(["7=aws-saa-c03", "8=claude-ccdv-f"]) == {7: "aws-saa-c03", 8: "claude-ccdv-f"}
    drafts = write_lines(tmp_path / "drafts.jsonl", [_draft(1)])
    assert main(["import-drafts", "--drafts", str(drafts), "--deck", "seven"]) == 2
    assert "is not <deckId>=<deckSlug>" in capsys.readouterr().err
    assert main(["import-drafts", "--drafts", str(tmp_path / "none.jsonl"), "--deck", "7=aws-saa-c03"]) == 2
    from dc_evals import drafts_import

    monkeypatch.setattr(drafts_import, "ingest", _ingest)
    output = tmp_path / "out.jsonl"
    assert main(["import-drafts", "--drafts", str(drafts), "--deck", "7=aws-saa-c03", "--output", str(output)]) == 0
    assert [row["id"] for row in read_jsonl(output)] == ["n-0001"]


# --- the rows the jury could not label, and the owner sample (ai-agent-4) --------------------------


def _with_excluded(spec: DatasetSpec, tie: int, unsure: int, stratum: str | None = None) -> None:
    """Adds `tie` + `unsure` authored rows the jury excluded (never in the run)."""
    authored, labels = read_jsonl(spec.path), read_jsonl(spec.labels_path)
    for index in range(tie + unsure):
        row_id = f"x-{index + 1:04d}"
        row = {"id": row_id, "deckSlug": "aws-saa-c03", "card": {}}
        if stratum:
            row = {**row, "stratum": stratum, "authorPath": RUNNER_AUTHOR_PATH, "runId": "r"}
        authored.append(row)
        labels.append({"id": row_id, "label": None, "category": None, "excluded": "tie" if index < tie else "all_unsure",
                       "unanimous": False, "defect": None, "scorable": False, "counts": {}, "votes": []})
    write_lines(spec.path, authored)
    write_lines(spec.labels_path, labels)


def test_report_counts_the_rows_the_jury_excluded(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    _with_excluded(spec, tie=3, unsure=2)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["passed"] is True
    authored = report["authored"]
    assert authored["juryExcluded"] == {
        "labelRows": 145, "tie": 3, "allUnsure": 2, "excludedRows": 5, "excludedRate": 0.0345, "notScorable": 0,
    }
    assert authored["strata"]["docs"]["juryExcluded"]["excludedRows"] == 5
    assert authored["strata"]["new-facts"]["juryExcluded"]["excludedRows"] == 0
    # every excluded row counted as reviewed in both reps, accepted and wrong: 260 / (260 + 10)
    assert authored["conservativeAutoAcceptPrecision"] == 0.963
    md = gate.render_markdown(report)
    assert "### Rows the jury could not label" in md and "| all | 145 | 3 | 2 | 0.0345 | <= 0.10 | 0 |" in md
    assert "no human labelled any card" in md and "None: no owner adjudication file" in md


def test_gate_fails_closed_when_the_jury_excluded_too_many_rows(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    _with_excluded(spec, tie=4, unsure=1, stratum="new-facts")
    failures = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))["failures"]
    # 5 of 145 overall passes; 5 of 45 new-facts rows does not
    assert failures == ["new-facts stratum: jury excluded rate 0.1111 (5 of 45 rows: 4 tie, 1 all unsure) > 0.10"]
    other = tmp_path / "overall"
    other.mkdir()
    spec2, rows2 = authored_spec(other)
    _with_excluded(spec2, tie=10, unsure=8)
    failures = evaluate(other, spec=spec2, authored=authored_run(other, spec2, authored_records(rows2)))["failures"]
    assert failures == [
        "jury excluded rate 0.1139 (18 of 158 rows: 10 tie, 8 all unsure) > 0.10",
        "docs stratum: jury excluded rate 0.1525 (18 of 118 rows: 10 tie, 8 all unsure) > 0.10",
    ]


def _owner_file(spec: DatasetSpec, verdicts: list[dict[str, Any]], **overrides: Any) -> Path:
    data = {"format": 1, "dataset": "authored-v2", "datasetSha256": file_sha256(spec.path), "labelSource": "owner",
            "verdicts": verdicts, **overrides}
    path = gate.owner_sample_path(spec)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_owner_sample_is_scored_next_to_the_jury_result(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    _with_excluded(spec, tie=1, unsure=0)
    verdict = {"adjudicator": "owner", "date": "2026-09-28", "note": ""}
    ids = [f"a-{i:04d}" for i in range(121, 131)]  # ten new-facts cards
    _owner_file(spec, [*({"id": i, "verdict": "valid", **verdict} for i in ids),
                       {"id": "a-0001", "verdict": "invalid", **verdict},
                       {"id": "x-0001", "verdict": "valid", **verdict}])
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["passed"] is True  # informational: the owner sample is never a gate by itself
    sample = report["authored"]["ownerSample"]
    assert sample["adjudicated"] == 12 and sample["adjudicatedByStratum"] == {"docs": 2, "new-facts": 10}
    assert sample["juryExcludedAdjudicated"] == 1
    assert (sample["wouldAccept"], sample["wouldAcceptValid"], sample["ownerAutoAcceptPrecision"]) == (22, 20, 0.9091)
    assert (sample["juryLabelled"], sample["juryOwnerAgreement"]) == (11, 0.9091)
    md = gate.render_markdown(report)
    assert "### Owner-adjudicated sample" in md
    assert "| Auto-accept precision | 0.9091 (20 of 22) | 1.0000 |" in md


def test_an_invalid_owner_sample_fails_the_gate(tmp_path: Path) -> None:
    spec, rows = authored_spec(tmp_path)
    path = _owner_file(spec, [{"id": "a-0001", "verdict": "valid", "adjudicator": "owner", "date": "2026-09-28"}],
                       datasetSha256="0" * 64)
    report = evaluate(tmp_path, spec=spec, authored=authored_run(tmp_path, spec, authored_records(rows)))
    assert report["failures"] == [
        f"owner sample {path}: datasetSha256 does not match authored-v2.jsonl; the verdicts are for another file"
    ]
    _owner_file(spec, [{"id": "zz", "verdict": "valid", "adjudicator": "owner", "date": "2026-09-28"}])
    assert evaluate(tmp_path, spec=spec, authored=tmp_path / "authored.jsonl")["failures"] == [
        f"owner sample {path}: 'zz' is not a row of authored-v2"
    ]

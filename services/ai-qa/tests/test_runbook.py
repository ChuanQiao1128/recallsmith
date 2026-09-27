"""The operator runbook carries ai-qa's automation operating steps (G02: cloud-security-resilience-2,
automation-35). ai-qa owns the report's effectiveEffort (contract O1), so this suite pins that the page
the operator follows names it wherever the gate is bound to the reviewer."""

import re
from pathlib import Path

import pytest

RUNBOOK = Path(__file__).resolve().parents[3] / "docs" / "runbooks" / "automation-operations.md"


@pytest.fixture(scope="module")
def runbook() -> str:
    return RUNBOOK.read_text(encoding="utf-8")


def section(text: str, heading: str) -> str:
    """The body of one '## ' section."""
    match = re.search(rf"^## {re.escape(heading)}.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    assert match, f"no section {heading!r}"
    return match.group(1)


def test_step_5_check_names_the_reviewer_effort_and_the_match_flags(runbook) -> None:
    step5 = runbook[runbook.index("5. **Eval gate") : runbook.index("6. **Review the dry run")]
    assert "effective effort `high`" in step5
    assert "AI_EFFORT" in step5 and "effectiveEffort" in step5
    assert "reviewerMatchesGate: true" in step5 and "authorMatchesGate: true" in step5


def test_step_10_says_an_ai_effort_change_needs_a_new_gate(runbook) -> None:
    step10 = runbook[runbook.index("10. **Changed author configuration") : runbook.index("## Upgrading")]
    assert "**Changed reviewer → new gate**" in step10
    assert "AI_EFFORT" in step10 and "REVIEWER_NOT_GATED" in step10


def test_promotion_checklist_binds_the_gate_to_the_reviewer_effort(runbook) -> None:
    checklist = section(runbook, "Promotion checklist")
    assert "reviewer triple" not in runbook
    assert "**and effective effort**" in checklist
    assert "**Reviewer effort = the gated effort**" in checklist
    assert "reviewerMatchesGate: true" in checklist and "ai-qa is deployed at or after R18F" in checklist


def test_upgrade_checklist_covers_rounds_e_to_g(runbook) -> None:
    upgrade = section(runbook, "Upgrading to R18E–R18G")
    for needle in (
        "DRY_RUN=1 services/deploy-python-lambda.sh ai-qa",
        "(cd tools/mcp-server && npm ci && npm run build)",
        "(cd tools/author-runner && npm ci && npm run build)",
        "node tools/author-runner/dist/index.js status",
        "author_config_error",
        "Re-produce any new-facts stratum",
        "reviewerMatchesGate: true",
        "authorMatchesGate: true",
    ):
        assert needle in upgrade, needle
    assert upgrade.index("src_C/deploy.sh") < upgrade.index("deploy-python-lambda.sh ai-qa")


def test_exception_emails_cover_p1_p2_and_the_runner_state_hold(runbook) -> None:
    emails = section(runbook, "Exception emails")
    assert "`runner_stalled` (runner in error; R18G P1)" in emails and "last_error" in emails
    assert "`queue_item_failed` (partial item; R18G P2)" in emails
    assert "clears only when" not in emails
    assert "delete `<log dir>/runner-state.json`" in emails

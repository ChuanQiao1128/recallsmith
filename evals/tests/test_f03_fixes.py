"""F03 (R18F fix round 5): the evals docs and the gate module state the one re-gate rule of
tools/author-runner/README.md, and the gated author fields they name are the ones the code hashes
(automation-35, ai-agent-24). Reads files only; nothing calls a model."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from dc_evals import automation_gate as gate
from dc_evals.drafts_import import gated_author_config_id

REPO = Path(__file__).resolve().parents[2]
EVALS_README = REPO / "evals" / "README.md"
RUNNER_README = REPO / "tools" / "author-runner" / "README.md"

# The sentences of the one re-gate rule, as tools/author-runner/README.md states it.
RULE = "any change of `authorConfigId` needs a new eval gate before the automation auto-accepts in `live` on it."
NO_REGATE = "A Claude Code or runner update alone does not"


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _gated_keys() -> set[str]:
    """The AuthorConfig keys gated_author_config_id reads."""
    read: set[str] = set()

    class Recording(dict[str, Any]):
        def __getitem__(self, key: str) -> Any:
            read.add(key)
            return "x"

    gated_author_config_id(Recording())
    return read


def test_runner_readme_still_states_the_rule_the_evals_docs_copy() -> None:
    runner = _flat(RUNNER_README.read_text(encoding="utf-8"))
    assert RULE in runner
    assert NO_REGATE in runner


def test_evals_readme_states_the_one_regate_rule_without_the_old_one() -> None:
    readme = _flat(EVALS_README.read_text(encoding="utf-8"))
    assert RULE in readme
    assert NO_REGATE in readme
    # The pre-M1 and pre-N4 statements are gone.
    assert "core does not yet compare" not in readme
    assert "does not send its `authorConfig` id" not in readme
    assert "a new `authorConfig` id) requires a new gate" not in readme
    assert "plus the Claude CLI and runner versions; its `id` changes when any of them does" not in readme


def test_evals_readme_names_the_fields_the_code_gates_and_the_tool_surface() -> None:
    readme = _flat(EVALS_README.read_text(encoding="utf-8"))
    match = re.search(r"the SHA-256 of the canonical JSON of \{([^}]*)\}", readme)
    assert match is not None
    named = set(re.findall(r"`([A-Za-z0-9]+)`", match.group(1)))
    assert named == {"argsSha256", "model", "promptSha256", "skillSha256", "skillVersion"}
    # argsSha256 is read from the record's claudeArgsSha256; the other four by their own name.
    assert _gated_keys() == (named - {"argsSha256"}) | {"claudeArgsSha256"}
    # N4: argsSha256 carries the MCP tool surface.
    assert "`argsSha256` is the record's `claudeArgsSha256`, the claude argument list together with the SHA-256 of the MCP tool surface" in readme


def test_evals_readme_lists_what_core_compares_at_a_live_auto_accept() -> None:
    readme = _flat(EVALS_README.read_text(encoding="utf-8"))
    assert "at every live auto-accept core compares" in readme
    for token in ("`AUTHOR_NOT_GATED`", "`REVIEWER_NOT_GATED`", "`effectiveEffort`", "`agent.authorConfigId`"):
        assert token in readme
    # A new-facts run from a runner before N4 carries an authorConfigId no live draft has.
    assert "re-produce" in readme


def test_author_binding_docstring_states_the_one_regate_rule() -> None:
    doc = _flat(gate.author_binding.__doc__ or "")
    assert "CLI/runner version gives a new id and needs a new gate" not in doc
    assert "any change of `authorConfigId` needs a new gate" in doc
    assert NO_REGATE in doc
    assert "tool surface" in doc

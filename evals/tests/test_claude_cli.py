from __future__ import annotations

import json
import subprocess

import pytest

from ai_qa.review import review_card
from ai_qa.settings import load_settings
from dc_evals.claude_cli import ClaudeCliClient, ClaudeCliError, render_prompt


class FakeRunner:
    """Records each call and answers with queued `claude -p --output-format json` results."""

    def __init__(self, results: list[dict], returncode: int = 0) -> None:
        self.results = list(results)
        self.returncode = returncode
        self.calls: list[dict] = []

    def __call__(self, cmd, **kwargs):
        self.calls.append({"cmd": cmd, **kwargs})
        body = self.results.pop(0)
        return subprocess.CompletedProcess(cmd, self.returncode, stdout=json.dumps(body), stderr="")


def cli_result(text: str, **usage) -> dict:
    return {"type": "result", "is_error": False, "result": text, "session_id": "sess-1",
            "usage": {"input_tokens": 3, "output_tokens": 40, "cache_read_input_tokens": 0,
                      "cache_creation_input_tokens": 2600, **usage}}


def settings():
    return load_settings({"AI_PROVIDER": "anthropic", "AI_MODEL": "claude-opus-5", "AI_STRUCTURED_OUTPUTS": "off"})


CARD = {"cardId": 7, "contentSha256": "x", "stableUid": "u-1", "question": "Q?", "explanation": "A.",
        "codeSnippet": None, "codeLanguage": None, "realWorldUsage": None, "topic": "t", "difficulty": 2,
        "mcq": None, "source": None}


def test_claude_cli_runs_the_production_prompt_without_tools_or_mcp() -> None:
    runner = FakeRunner([cli_result('{"findings":[]}')])
    item = review_card(CARD, client=ClaudeCliClient("claude-opus-5", runner=runner), settings=settings(), review_date="2026-09-27")
    assert item["status"] == "done" and item["findings"] == []
    cmd = runner.calls[0]["cmd"]
    assert cmd[:4] == ["claude", "-p", "--model", "claude-opus-5"]
    assert cmd[cmd.index("--tools") + 1] == "" and "--strict-mcp-config" in cmd
    assert cmd[cmd.index("--effort") + 1] == "high"
    from ai_qa.prompts import SYSTEM_PROMPT
    assert cmd[cmd.index("--system-prompt") + 1] == SYSTEM_PROMPT
    assert "<card>" in runner.calls[0]["input"]
    assert item["usage"]["outputTokens"] == 40


def test_claude_cli_repair_turn_quotes_the_rejected_reply() -> None:
    runner = FakeRunner([cli_result("not json"), cli_result('{"findings":[]}')])
    item = review_card(CARD, client=ClaudeCliClient("claude-opus-5", runner=runner), settings=settings(), review_date="2026-09-27")
    assert item["status"] == "done"
    repair_prompt = runner.calls[1]["input"]
    assert "<your_previous_reply>\nnot json\n</your_previous_reply>" in repair_prompt


def test_claude_cli_error_result_becomes_a_client_error() -> None:
    client = ClaudeCliClient("claude-opus-5", runner=FakeRunner([{"is_error": True, "result": "limit"}]))
    with pytest.raises(ClaudeCliError):
        client.messages.create(system="s", messages=[{"role": "user", "content": "hi"}], output_config={"effort": "high"})


def test_claude_cli_refuses_structured_outputs() -> None:
    client = ClaudeCliClient("claude-opus-5", runner=FakeRunner([]))
    with pytest.raises(ClaudeCliError):
        client.messages.create(system="s", messages=[{"role": "user", "content": "hi"}],
                               output_config={"effort": "high", "format": {"type": "json_schema", "schema": {}}})


def test_render_prompt_single_turn_is_verbatim() -> None:
    assert render_prompt([{"role": "user", "content": "exactly this"}]) == "exactly this"


def test_claude_cli_reports_the_model_that_answered() -> None:
    from dc_evals.claude_cli import served_model

    assert served_model({"modelUsage": {"claude-opus-5[1m]": {}}}, "claude-opus-5") == "claude-opus-5"
    assert served_model({"modelUsage": {"claude-haiku-4-5": {}, "claude-opus-5": {}}}, "claude-opus-5") == "claude-opus-5"
    assert served_model({"modelUsage": {"claude-sonnet-5": {}}}, "claude-opus-5") == "claude-sonnet-5"
    assert served_model({}, "claude-opus-5") is None
    runner = FakeRunner([{**cli_result('{"findings":[]}'), "modelUsage": {"claude-opus-5": {}}}])
    response = ClaudeCliClient("claude-opus-5", runner=runner).messages.create(
        system="s", messages=[{"role": "user", "content": "hi"}], output_config={"effort": "high"}
    )
    assert response.model == "claude-opus-5"


def test_claude_cli_maps_a_reported_max_tokens_stop_to_the_production_error() -> None:
    """Z04 (ai-agent-30): a CLI result that says the reply was cut at max_tokens reaches
    ai_qa.review as stop_reason max_tokens, so the item is MAX_TOKENS as on Bedrock, and the
    request's max_tokens reaches the CLI."""
    runner = FakeRunner([{**cli_result('{"findings":['), "stop_reason": "max_tokens"}])
    item = review_card(CARD, client=ClaudeCliClient("claude-opus-5", runner=runner), settings=settings(), review_date="2026-09-27")
    assert (item["status"], item["errorCode"]) == ("error", "MAX_TOKENS")
    from ai_qa.review import MAX_TOKENS

    assert runner.calls[0]["env"]["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] == str(MAX_TOKENS)


def test_claude_cli_maps_a_reported_refusal_to_the_production_outcome() -> None:
    runner = FakeRunner([{**cli_result(""), "stop_reason": "refusal", "stop_details": {"category": "cyber"}}])
    item = review_card(CARD, client=ClaudeCliClient("claude-opus-5", runner=runner), settings=settings(), review_date="2026-09-27")
    assert (item["status"], item["errorCode"]) == ("refused", "REFUSAL")
    # An error result that names the refusal is still a refusal, not a transport failure.
    runner = FakeRunner([{"type": "result", "subtype": "success", "is_error": True, "result": "",
                          "stop_reason": "refusal"}])
    response = ClaudeCliClient("claude-opus-5", runner=runner).messages.create(
        system="s", messages=[{"role": "user", "content": "hi"}], output_config={"effort": "high"}
    )
    assert response.stop_reason == "refusal"


def test_claude_cli_without_a_stop_reason_is_end_turn() -> None:
    response = ClaudeCliClient("claude-opus-5", runner=FakeRunner([cli_result('{"findings":[]}')])).messages.create(
        system="s", messages=[{"role": "user", "content": "hi"}], output_config={"effort": "high"}
    )
    assert response.stop_reason == "end_turn" and response.stop_details is None


def test_claude_cli_error_subtype_becomes_a_distinct_error_code() -> None:
    """Z04 (ai-agent-30): the runner records a CLI error result under its own code, not the
    generic UNEXPECTED."""
    from dc_evals.runner import _review_row

    client = ClaudeCliClient(
        "claude-opus-5",
        runner=FakeRunner([{"type": "result", "subtype": "error_during_execution", "is_error": True}]),
    )
    with pytest.raises(ClaudeCliError) as caught:
        client.messages.create(system="s", messages=[{"role": "user", "content": "hi"}], output_config={"effort": "high"})
    assert caught.value.error_code == "CLI_ERROR_DURING_EXECUTION"
    assert ClaudeCliError("x").error_code == "CLI_ERROR"

    row = {"id": "s-0007", "defect": None, "tier": None, "card": {k: v for k, v in CARD.items() if k not in ("cardId", "contentSha256")}}
    client = ClaudeCliClient(
        "claude-opus-5",
        runner=FakeRunner([{"type": "result", "subtype": "error_max_turns", "is_error": True}]),
    )
    record = _review_row(row, client, settings(), "2026-09-27")
    assert (record["status"], record["errorCode"]) == ("error", "CLI_ERROR_MAX_TURNS")

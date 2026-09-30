"""Local-only transport for `dc-evals run --provider claude-cli`.

Sends the production review request (same SYSTEM_PROMPT, same user turn, same validation and
repair path in ai_qa.review) through the owner's Claude Code CLI (`claude -p`) on this machine.
It exists so the gate can be measured before Bedrock model access is granted. It is never
imported by the Lambda, never used in CI (tests fake the subprocess), and the owner's
subscription never leaves their machine.

Fidelity notes, recorded in every report as provider "claude-cli":
- Structured outputs are off (the Bedrock path: validated plain JSON + one repair turn).
- `claude -p` takes one prompt, so the repair turn is sent as a single user message that quotes
  the rejected reply; the production client sends it as a real assistant/user turn pair.
- Claude Code adds a small amount of its own context; token counts are estimates.
- max_tokens reaches the CLI only as CLAUDE_CODE_MAX_OUTPUT_TOKENS, and `thinking` is not sent
  (effort is). A cut at max_tokens or a refusal becomes stop_reason "max_tokens" / "refusal" (so
  ai_qa.review records MAX_TOKENS / REFUSAL) only when the CLI's JSON result carries that
  stop_reason; a result without one reads as "end_turn". The run file does not say which results
  carried one, so a proxy run cannot show that no card is truncated or refused: the MAX_TOKENS and
  REFUSAL rates are checked on the Bedrock gate run (PROXY_UNOBSERVABLE, echoed in the report).
- The child environment drops PAID_API_ENV (ANTHROPIC_API_KEY and friends), so the CLI can only
  use the owner's subscription login, never paid API credits.
- A CLI error result raises ClaudeCliError with errorCode CLI_<SUBTYPE> (the runner records it)
  instead of one generic error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from types import SimpleNamespace
from typing import Any, Callable

EMPTY_MCP_CONFIG = '{"mcpServers":{}}'
# Removed from every `claude -p` child (contract §10.7): with any of these set, the CLI bills the
# API key or a cloud account instead of the owner's subscription login.
PAID_API_ENV = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
)
# The stop reasons ai_qa.review maps to an outcome; any other reads as "end_turn".
MAPPED_STOP_REASONS = frozenset({"max_tokens", "refusal"})
# What a claude-cli report cannot show (report.build_report puts it under proxyFidelity).
PROXY_UNOBSERVABLE = {
    "outcomes": ["MAX_TOKENS", "REFUSAL"],
    "note": (
        "The claude-cli transport records MAX_TOKENS or REFUSAL only when the CLI's JSON result "
        "carries stop_reason max_tokens or refusal, and the run file does not record whether a result "
        "carried one; zero MAX_TOKENS or REFUSAL errors in a proxy run is not evidence that no card "
        "is truncated at max_tokens or refused. Both rates are checked on the Bedrock gate run."
    ),
}

_UNSAFE_CODE = re.compile(r"[^A-Z0-9]+")


class ClaudeCliError(RuntimeError):
    """The CLI failed or returned an error result. error_code is what the runner records:
    CLI_<SUBTYPE> for an error result that names its subtype, CLI_ERROR otherwise."""

    def __init__(self, message: str, *, subtype: str | None = None) -> None:
        super().__init__(message)
        code = _UNSAFE_CODE.sub("_", subtype.upper()).strip("_") if isinstance(subtype, str) else ""
        self.error_code = f"CLI_{code}" if code and code != "SUCCESS" else "CLI_ERROR"


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


def render_prompt(messages: list[dict[str, Any]]) -> str:
    """One user turn as-is; a multi-turn exchange (the repair turn) as one quoted transcript."""
    if len(messages) == 1:
        return _text_of(messages[0]["content"])
    lines = []
    for message in messages[:-1]:
        tag = "previous_request" if message["role"] == "user" else "your_previous_reply"
        lines.append(f"<{tag}>\n{_text_of(message['content'])}\n</{tag}>")
    lines.append(_text_of(messages[-1]["content"]))
    return "\n\n".join(lines)


class _Messages:
    def __init__(self, client: "ClaudeCliClient") -> None:
        self._client = client

    def create(self, **kwargs: Any) -> SimpleNamespace:
        return self._client.create(**kwargs)


def served_model(data: dict[str, Any], requested: str) -> str | None:
    """The model the CLI result says answered: a modelUsage key (a "[1m]"-style suffix dropped),
    the requested one when it is among them; None when the result names none."""
    usage = data.get("modelUsage")
    if not isinstance(usage, dict) or not usage:
        return None
    names = sorted(str(name).split("[", 1)[0] for name in usage)
    return requested if requested in names else names[0]


class ClaudeCliClient:
    """Duck-types the part of anthropic.Anthropic that ai_qa.review uses: messages.create(...)."""

    def __init__(
        self,
        model: str,
        *,
        binary: str = "claude",
        timeout_s: float = 600.0,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        self.model = model
        self.binary = binary
        self.timeout_s = timeout_s
        self._runner = runner
        self.messages = _Messages(self)

    def command(self, system: str, effort: str | None) -> list[str]:
        cmd = [
            self.binary, "-p",
            "--model", self.model,
            "--system-prompt", system,
            "--output-format", "json",
            "--tools", "",
            "--no-session-persistence",
            "--setting-sources", "",
            "--strict-mcp-config", "--mcp-config", EMPTY_MCP_CONFIG,
        ]
        if effort:
            cmd += ["--effort", effort]
        return cmd

    @staticmethod
    def env(max_tokens: int | None) -> dict[str, str]:
        """The subprocess environment: this process's without PAID_API_ENV (subscription login
        only), plus the request's max_tokens as the CLI's output-token ceiling."""
        env = {name: value for name, value in os.environ.items() if name not in PAID_API_ENV}
        if max_tokens:
            env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(int(max_tokens))
        return env

    def create(
        self,
        *,
        system: Any,
        messages: list[dict[str, Any]],
        output_config: dict[str, Any] | None = None,
        max_tokens: int | None = None,
        **_: Any,
    ) -> SimpleNamespace:
        if output_config and output_config.get("format"):
            raise ClaudeCliError("structured outputs are not available through the CLI; run with them off")
        effort = (output_config or {}).get("effort")
        with tempfile.TemporaryDirectory(prefix="dc-evals-") as cwd:
            proc = self._runner(
                self.command(_text_of(system), effort),
                input=render_prompt(messages),
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
                cwd=cwd,
                env=self.env(max_tokens),
            )
        if proc.returncode != 0:
            raise ClaudeCliError(f"claude exited {proc.returncode}")
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise ClaudeCliError("claude printed no JSON result") from None
        stop_reason = data.get("stop_reason") if data.get("stop_reason") in MAPPED_STOP_REASONS else "end_turn"
        if stop_reason == "end_turn" and (data.get("is_error") or not isinstance(data.get("result"), str)):
            raise ClaudeCliError("claude returned an error result", subtype=data.get("subtype"))
        details = data.get("stop_details")
        usage = data.get("usage") or {}
        return SimpleNamespace(
            model=served_model(data, self.model),
            content=[SimpleNamespace(type="text", text=data.get("result") if isinstance(data.get("result"), str) else "")],
            stop_reason=stop_reason,
            stop_details=details if stop_reason == "refusal" and isinstance(details, dict) else None,
            usage=SimpleNamespace(
                input_tokens=int(usage.get("input_tokens") or 0),
                output_tokens=int(usage.get("output_tokens") or 0),
                cache_read_input_tokens=int(usage.get("cache_read_input_tokens") or 0),
                cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens") or 0),
            ),
            _request_id=data.get("session_id"),
        )

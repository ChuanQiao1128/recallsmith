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
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from types import SimpleNamespace
from typing import Any, Callable

EMPTY_MCP_CONFIG = '{"mcpServers":{}}'


class ClaudeCliError(RuntimeError):
    """The CLI failed or returned an error result."""


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

    def create(self, *, system: Any, messages: list[dict[str, Any]], output_config: dict[str, Any] | None = None, **_: Any) -> SimpleNamespace:
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
            )
        if proc.returncode != 0:
            raise ClaudeCliError(f"claude exited {proc.returncode}")
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise ClaudeCliError("claude printed no JSON result") from None
        if data.get("is_error") or not isinstance(data.get("result"), str):
            raise ClaudeCliError("claude returned an error result")
        usage = data.get("usage") or {}
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=data["result"])],
            stop_reason="end_turn",
            stop_details=None,
            usage=SimpleNamespace(
                input_tokens=int(usage.get("input_tokens") or 0),
                output_tokens=int(usage.get("output_tokens") or 0),
                cache_read_input_tokens=int(usage.get("cache_read_input_tokens") or 0),
                cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens") or 0),
            ),
            _request_id=data.get("session_id"),
        )

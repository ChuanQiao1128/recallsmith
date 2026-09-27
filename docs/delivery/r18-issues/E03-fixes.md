# E03 — Authoring runner round 4 (R18E, wave T): fixes

Issue #487. Scope: `tools/author-runner`, `tools/mcp-server`, `.claude/skills/author-cards`. The
server side of N3 (backoff, `RUNNER_UNAVAILABLE_REPEATED`, refund only without drafts) is src_C's
and is not touched here.

### ai-agent-23

Status: fixed (runner side, N3; the src_C refund/backoff half belongs to the src_C wave)

What changed:

- `tools/author-runner/src/claude.ts:127-248` (`runClaude`): claude's stdout is now a pipe to the
  runner, written to `runs/<runId>.json` as it arrives (the run file is kept). Each chunk goes
  through `initWatch` (`claude.ts:257-290`), which reads the stream-json lines as they arrive and
  judges the first `system`/`init` message with `initProblem` (`claude.ts:393-397`): an
  `apiKeySource` that is missing or not `none`, or a developercards MCP server that is `failed`,
  `needs-auth`, … or missing, or a model message before any init message (other `system` messages,
  such as hook output, may come first). Any of them ends the process group at once through the same
  SIGTERM → grace → SIGKILL → settle path as a timeout (`terminate`), before the first model turn,
  and is reported as `ClaudeRun.initAbort`. The last stdout bytes are drained after `exit` for at
  most `killSettleMs`, so a group member that holds the pipe cannot stall the runner.
- `claude.ts:470-487` (`claudeOutcome`): the login/MCP verdict is checked on **every** outcome.
  First the `initAbort` verdict, then, whenever the stream holds any JSON, the whole stream
  (`claudeUsage` provider signal: no init, wrong `apiKeySource`, cloud-provider model id; then the
  MCP server status). This now runs before the timeout, non-zero exit, `is_error` and usage-limit
  branches, so a timed-out or `is_error` run on an API key is no longer an ordinary item failure, and
  a result text that says "rate limit" on an API-key run is no longer read as a usage limit. A run
  that printed no JSON at all never reached a model turn and still fails on its own terms
  (`timeout`, `exit n`, `claude output is not JSON`).
- `ClaudeOutcome.holdUntilCleared` (`claude.ts:303-307`) marks the non-transient run-level causes:
  claude cannot be started (spawn error, e.g. ENOENT), not on the subscription login, MCP server
  failed or missing.
- `tools/author-runner/src/runner.ts:100-150`: `runner-state.json` holds either the usage-limit state
  `{ limitedUntil, reason }` or a hold `{ holdUntilCleared: true, reason, since, authorId,
  claudeVersion }`. `runner.ts:394-423`: `once` refuses to claim while a hold names the pinned author
  configuration's local `id` and the current `claude --version` (event `runner_held`, error heartbeat
  `RUNNER_UNAVAILABLE: held since … until the owner clears …`, kept completes are still re-sent);
  a hold that names another configuration or CLI version is dropped (`hold_cleared`); the owner
  clears it by deleting the file. `runner.ts:602-619` writes the hold after the item's `complete`.
- `tools/author-runner/src/logs.ts`: events `runner_held`, `hold_cleared`.
- `tools/author-runner/README.md`: steps 4 and 6, log files, events, troubleshooting and the
  subscription check describe the init-time kill, the every-outcome check and the hold.

Sub-point declined: `USAGE_LIMIT_RE` (`claude.ts`) is unchanged. It is now evaluated only after the
login check has passed, and its 1 h fallback hold is about the launchd interval (as the verifier
notes). Narrowing it risks missing the CLI's own limit texts ("resets 3pm"), and the repeated
requeue it can cause is bounded by the src_C side of N3 (backoff, terminal at n ≥ 3).

Tests (fail on the old code, pass now):

- `tests/runner.test.ts` › `run-level hold (N3, ai-agent-23)`:
  - `ends an API-key run at its init message, before the first model turn, and claims nothing until the hold is cleared`
    (fake claude `api_key` with `DC_TEST_FAKE_CLAUDE_STALL_MS=20000`: the run file holds only the init
    line, the fake's pid is dead, one claim/one complete, a hold is written, the next two `once` runs
    send only an error heartbeat and the second item stays queued; deleting the file resumes).
  - `ends a run whose MCP server failed, or whose model turn comes before any init message, and holds`.
  - `clears the hold by itself only when the CLI or the author configuration changes`.
  - `keeps a per-item failure and a usage limit off the hold`.
- `tests/claude.test.ts` › `the provider check on every outcome and at the init message (N3, ai-agent-23)`:
  `holds a timed-out, an error and a failed run whose init message shows another login or a failed MCP server`,
  `keeps per-item failures and usage limits off the hold`,
  `judges the init message as it arrives, across chunk boundaries`.
- `tests/fixtures/fake-claude.mjs`: `DC_TEST_FAKE_CLAUDE_STALL_MS` (first line, then stall) and
  `DC_TEST_FAKE_CLAUDE_VERSION`; output is now flushed before exit, since stdout is a pipe.

Existing assertions updated because the finding makes the old behaviour wrong:

- `tests/runner.test.ts` › `fails a run whose system/init message shows an API key or is missing (ai-agent-14)`:
  the API-key run's `exitCode` is now `null` (it is ended at its init message and has no exit code of
  its own), not `0`.
- `tests/runner.test.ts` › `stops the loop when claude cannot be started and holds the runner (M5, ai-agent-17, N3)`
  (was `… without a usage-limit hold …`): a missing claude now writes a hold instead of no state file.

### ai-agent-24

Status: partially fixed (runner, MCP server, runner README and skill docs fixed; the two evals texts
are outside this issue's paths)

What changed:

- `tools/mcp-server/src/toolSurfaceHash.ts` (new): `ToolSurface`, `canonicalJson` (keys sorted at
  every depth, no spaces) and `toolSurfaceSha256`; node builtins only, so the runner bundles it.
- `tools/mcp-server/src/toolSurface.ts` (new): `listToolSurface()` lists the tools through an MCP
  client exactly as Claude Code sees them: `{ constants: { SOURCE_QUOTE_MIN_CHARS,
  SOURCE_QUOTE_MIN_WORDS }, server: { name, version }, tools: [{ name, description, inputSchema }] }`,
  sorted by name. `src/toolSurfaceMain.ts` prints its canonical JSON.
- `tools/mcp-server/scripts/build.mjs:42-58`: the build writes `dist/tool-surface.json` from the
  built code and removes its helper bundle.
- `tools/mcp-server/src/server.ts:50-52`: `MCP_SERVER_NAME` / `MCP_SERVER_VERSION` are exported and
  used by `McpServer` and the `--help` text (`src/index.ts`); the README says to bump the version
  with any change of what a tool does.
- `tools/author-runner/src/authorConfig.ts:80-106,117-163`: `readAuthorConfig` reads and checks
  `tools/mcp-server/dist/tool-surface.json` (missing or malformed → `AuthorConfigError`, nothing is
  claimed), records `toolSurfaceSha256`, `mcpServerVersion` and `mcpToolNames`, and computes
  `claudeArgsSha256 = sha256(<claude args joined by NUL> NUL <toolSurfaceSha256>)`. That value is the
  gated `argsSha256`, so `authorConfigId` now covers the tool surface. `authorConfigIdOf` uses the
  shared `canonicalJson`.
- `tools/author-runner/src/config.ts:40`: the stale "besides the queue item's own host" comment now
  says the item's host gets no implicit pass (ai-agent-21).
- The one re-gate rule is stated in `tools/author-runner/README.md` (Author configuration),
  `tools/mcp-server/README.md` (Build) and `.claude/skills/author-cards/SKILL.md` (automation bullet):
  any change of `authorConfigId` (model, any skill file, the queue-item prompt, the claude arguments,
  the MCP tool surface) needs a new eval gate before `live`; a Claude Code or runner update, or an MCP
  rebuild with the same tool surface, does not.

Not fixed here: `evals/src/dc_evals/automation_gate.py:588-595` (the `author_binding` docstring) and
`evals/README.md:647-653` still state the older rule (an MCP bundle or CLI/runner version change
needs a new gate). `evals/` is outside this issue's allowed paths (`tools/.*`, `\.claude/.*`,
`docs/delivery/r18-issues/.*`), and E04 does not cover it. It is a follow-up for the evals owner:
replace both with the rule above. No evals code change is needed: `drafts_import.gated_author_config_id`
takes `claudeArgsSha256` as an opaque string, so it recomputes the new ids correctly.

Tests:

- `tools/author-runner/tests/authorConfig.test.ts` ›
  `binds the gated authorConfigId to the MCP tool surface the agent sees (N4, ai-agent-24)`
  (another tool description, input schema, tool list, lint limit or server version is another
  `authorConfigId`; the same surface with other key order is the same id; a missing or malformed
  surface file throws).
- `tools/mcp-server/tests/toolSurface.test.ts`:
  `lists every tool the agent sees, sorted by name, with its description and input schema`,
  `hashes the canonical JSON, so a changed description, schema, limit or version is a new surface`,
  `writes canonical JSON: keys sorted at every depth, no spaces, array order kept`.
- `tools/author-runner/tests/helpers.ts`: the test repo gets a stand-in `tool-surface.json`
  (`TEST_TOOL_SURFACE`).

## Contract

- **N3 (runner side).** The system/init line is read as it arrives from claude's piped stdout. An
  `apiKeySource` other than `none` (or none at all), a developercards MCP server that failed or is
  missing, or a model message before any init message ends the process group before the first model
  turn. The provider signal is checked on every outcome (timeout, `is_error`, non-zero exit,
  success). For the non-transient runner-level causes (wrong provider, MCP server failing or missing,
  claude cannot be started), `runner-state.json` gets the hold described above, in the same file the
  usage-limit path writes. It is cleared only when the author configuration (local `id`) or the
  `claude --version` changes, or when the owner deletes the file. The run is still completed with
  `RUNNER_UNAVAILABLE: …`, so the src_C backoff and `RUNNER_UNAVAILABLE_REPEATED` apply unchanged.
- **N4.** `authorConfigId` hashes the MCP tool surface the agent sees: the sorted tool names with
  their descriptions and input schemas, the MCP server name and version, and the lint limits. It does
  so through `argsSha256` (`claudeArgsSha256`), which keeps the M1 canonical five-key JSON that
  evals recomputes. The README and skill docs state the one rule.

Deviations:

- The tool surface enters the gated id through `claudeArgsSha256`, not as a sixth key. A new key
  would make `evals` `drafts_import.author_config_id_problem` reject every new run record ("not the
  id of its configuration") until evals changes, and evals is out of scope for this issue.
- An MCP server `pending` in the init message is not ended. Claude Code may still be connecting a
  stdio server when it writes init; the audit's fix names "failed or missing", and the existing
  ai-agent-13 assertion keeps `pending` a pass.
- This change gives every configuration a new `authorConfigId`, because `claudeArgsSha256` now
  includes the tool surface. A new eval gate is therefore needed before `live`. Production runs
  `dry_run`, so nothing auto-accepts meanwhile.

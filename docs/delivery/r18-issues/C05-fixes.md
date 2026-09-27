# C05 fixes: authoring runner, fix round 2 (R18C wave T)

Issue #459. Scope: `tools/author-runner` (plus one sentence in `.claude/skills/author-cards/SKILL.md`).
No server, schema or MCP-server change. `npm ci && npm run build && npm test` in
`tools/author-runner`: 10 files, 58 tests, all green.

### ai-agent-13

Status: fixed

- L6 outcomes. `claudeOutcome` (`tools/author-runner/src/claude.ts:284-334`) no longer defaults to
  `done`. A final line `{"outcome":"blocked",…}` (or the L6 spelling `{"result":"blocked","reason":…}`)
  completes the run as `failed` with error `AGENT_BLOCKED: <reason>` (`reason`, else the notes, else
  `no reason given`; one line, at most 300 characters; `claude.ts:327-330`), and the notes still go
  as `summary` (K3). A missing, non-JSON or non-object final line, or one with an unknown outcome, is
  `failed` with `AGENT_NO_RESULT: …` (`claude.ts:319-333`), never a success.
- The prompt (`tools/author-runner/prompts/queue-item.md`, rule 7 and "Final message") adds
  `"blocked"` with a `reason` for a refused or failed tool or an unreadable source, and says that
  `nothing_new` is only for a source that was read and had nothing new. The skill's automation note
  (`.claude/skills/author-cards/SKILL.md:15`) names the same vocabulary.
- A missing MCP bundle is refused: `readAuthorConfig` throws `AuthorConfigError` when
  `tools/mcp-server/dist/index.js` cannot be read (`tools/author-runner/src/authorConfig.ts:59,80-85`);
  `mcpServerSha256` is now always a hash. The run then exits 1 with an `author_config_error` heartbeat
  and claims nothing.
- Also: the stream-json `system`/`init` message (see ai-agent-14) lists the MCP servers; a
  `developercards` server that is missing or not `connected`/`pending` fails the run
  (`claude.ts:266-274`, `the developercards MCP server did not start (failed)`).
- Not done (optional in the finding): failing on a non-empty `permission_denials`. Under
  `--permission-mode dontAsk` a denied `Read` outside the allowlist is routine and the agent carries
  on, so it would fail good runs; a denied DeveloperCards tool is now reported by the agent as
  `blocked`.
- Tests: `claude.test.ts` "never counts a missing or unknown final outcome line as a success (L6
  AGENT_NO_RESULT)", "completes a blocked agent as failed with AGENT_BLOCKED and a one-line capped
  reason (L6)", "fails a run whose developercards MCP server did not start (ai-agent-13)";
  `runner.test.ts` "completes a blocked agent as failed with AGENT_BLOCKED and a missing outcome line
  as AGENT_NO_RESULT (L6, ai-agent-13)", "runs nothing when the MCP server bundle is missing
  (ai-agent-13)"; `authorConfig.test.ts` "refuses a checkout without the MCP server bundle instead of
  running with no DeveloperCards tools (ai-agent-13)"; `prompt.test.ts` "renders every placeholder of
  the queue-item prompt" (L6 vocabulary assertions added).
- Existing assertions updated because the finding makes the old behaviour wrong:
  `claude.test.ts` "maps a claude result to the complete outcome" expected `done` for a result with
  no JSON line and for `{"outcome":"weird"}`; those two cases moved to the AGENT_NO_RESULT test with
  the new expectation. `runner.test.ts` "runs one claimed item end to end" expected
  `mcpServerSha256: null` (the test repo had no bundle); `tests/helpers.ts` `makeHome` now writes a
  stand-in bundle and the assertion expects a SHA-256.

### automation-16

Status: fixed

- `sendComplete` (`tools/author-runner/src/runner.ts:265-289`) sends every `complete` (item runs and
  releases of items not run) up to `COMPLETE_ATTEMPTS = 3` times (`runner.ts:38`) with a doubling,
  jittered backoff (2 s then 4 s, each 50–150 %). A client error (`isPermanentCompleteFailure`,
  `runner.ts:96`: any 4xx except 401/408/429, for example 409 `RUN_NOT_RUNNING`) is not retried.
  When every attempt fails with a retryable error, the request, with the agent's notes as `summary`,
  is written to `<logDir>/pending-complete/<runId>.json` (0600, `{ savedAt, itemId, request }`) and
  logged `complete_pending`.
- `replayPending` (`runner.ts:292-326`) runs at the start of the next launch, right after the first
  heartbeat and before any claim (also when the mode is `off`, `runner.ts:333`). Each kept request is
  re-sent once as is; the server applies it or answers `replayed: true` (RunnerRoutes complete is
  replay-safe), and the file is deleted (`complete_replayed`). A client error deletes it; a retryable
  error keeps it for the next launch and makes the run's final heartbeat `error`. Kept files older
  than 30 days are pruned with the run files (`runner.ts:228`).
- The lock budget (ai-agent-16) includes one minute per item for the claim, the complete and its
  retries.
- Tests: `runner.test.ts` "retries a failed complete, keeps it with the notes, and replays it before
  the next claim (automation-16)" (first launch: 503, dropped connection, 500; second launch: routes
  `heartbeat(running)`, `complete` (the identical body), `claim`, `heartbeat(idle)`), "keeps a kept
  complete after another transient failure and drops one the server refuses for good
  (automation-16)", "does not retry a complete the server refuses for good (automation-16)".

### ai-agent-14

Status: fixed

- `claudeArgs` now passes `--output-format stream-json --verbose` (`tools/author-runner/src/claude.ts:21-22`).
  `readClaudeStream` (`claude.ts:201`) reads the first `system`/`init` message and the last `result`
  message from the JSON lines. `claudeUsage` takes the cost and `modelUsage` from the result and
  `apiKeySource` from the init message, and fails closed (`claude.ts:246-255`): no init message, no
  `apiKeySource`, or any value other than `none` (`SUBSCRIPTION_API_KEY_SOURCE`, `claude.ts:230`) is
  a `providerSignal`, so `claudeOutcome` fails the run with `claude did not run on the subscription
  login: …`. The Bedrock/Vertex model-id check stays as a further check.
- Source of the field: the installed Claude Code CLI's own schema for the init message
  (`subtype: "init"`, `apiKeySource`, `mcp_servers: [{ name, status }]`) describes `apiKeySource`
  as one of `ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key` (a Console API key stored by
  /login), or `none` (no API key in use, e.g. the claude.ai OAuth login), and says stream-json
  output in print mode needs `--verbose`. This was read from the local binary without running it.
- The test fake (`tests/fixtures/fake-claude.mjs`) now answers in stream-json like the CLI (init,
  assistant, result; stream-json without `--verbose` is refused) with modes `api_key` and `no_init`.
- README: the "Subscription check" note (formerly README.md:199-200), the intro, the troubleshooting
  row and the log description are corrected.
- Tests: `claude.test.ts` "reads apiKeySource from the system/init message and fails closed unless
  it is none (ai-agent-14)" (subscription vs `/login managed key`, `ANTHROPIC_API_KEY`,
  `apiKeyHelper`, `user`, no init, no field, a field on the result only), "reads the cost and the
  provider signal from the claude stream (ai-agent-10)"; `runner.test.ts` "fails a run whose
  system/init message shows an API key or is missing (ai-agent-14)".
- Existing assertions updated because the finding makes the old behaviour wrong: "builds exactly the
  contract CLAUDE_ARGS" (the argument list now has `stream-json` and `--verbose`), and the
  ai-agent-10 usage test, which fed `apiKeySource` on the result object (the reading this finding
  shows the CLI never produces) and now feeds stream-json. The `claudeArgs` change also changes
  `claudeArgsSha256` and therefore the author configuration `id`, as intended.

### ai-agent-16

Status: fixed

- `lockStaleMs(config)` (`tools/author-runner/src/lock.ts:16`) = `maxItems x (itemTimeoutMs +
  killGraceMs + killSettleMs + 1 min) + 30 min`: the longest a run of that configuration can hold
  the lock (default 3 items of 45 min: about 170 min; the maximum 5 x 120 min: about 638 min). The
  fixed `LOCK_STALE_MS` of 3 h is gone. A lock whose pid is dead is still taken over at once; a live
  holder only after `lockStaleMs` (`lock.ts:47-51`), which only guards against a reused pid.
  `acquireLock(file, staleMs, now)` takes the value, and `runOnce` passes `lockStaleMs(config)`
  (`runner.ts`).
- Tests: `lock.test.ts` "derives the staleness of a live lock from the longest configured run, not
  a fixed 3 hours (ai-agent-16)" (5 x 120 min: a live lock 3 h 1 min old is held; exactly at the
  boundary it is held; 1 ms past it is taken over), and "refuses a held lock and takes over a stale
  one" (updated to pass the staleness; its live-but-too-old case now uses the configured value).

## Contract

- **L6** (runner side, implemented): final line `{"outcome":"blocked",…}` or `{"result":"blocked","reason":…}`
  → `complete` with outcome `failed`, error `AGENT_BLOCKED: <reason>` (one line, reason capped at 300
  characters, so the error stays under the 500-character `complete` limit), notes as `summary`. A
  missing/unparseable final line or an unknown outcome → `failed` with `AGENT_NO_RESULT: …`. The
  prompt teaches the `outcome` key (consistent with `done`/`nothing_new`) plus `reason`; the parser
  accepts both spellings. The server API is unchanged; the 'action needed' email for AGENT_BLOCKED
  is the server wave's side and is not touched here.
- **K3** (unchanged, kept): notes still travel as `summary`, now also on blocked runs and on replayed
  completes.
- L1–L5 are not touched by this issue.

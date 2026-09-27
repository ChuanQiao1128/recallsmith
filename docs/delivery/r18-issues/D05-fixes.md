# D05 — Authoring runner, fix round 3 (R18D, wave T)

Issue #474. Scope: `tools/author-runner`, `tools/mcp-server`, `.claude/settings.json`. Every fix
has a test that fails on the base (`delivery/r18d-t` @ 240e0a3) and passes now.

## Findings

### ai-agent-17
Status: fixed (runner side of M5; the server side is src_C, another wave)

- `tools/author-runner/src/claude.ts:312` `resultDetail`: a failed run's error now carries the last
  result message's `subtype` and the first 300 characters of `result` on one line. A non-zero exit
  reads the stream-json result message first and falls back to stderr (then `exit N`). `is_error`
  gives `claude result is_error: <subtype>: <text>` in place of the constant.
- `claude.ts:304-330`, `:342-356`: `RUNNER_UNAVAILABLE`, `USAGE_LIMIT_RE`
  (`/usage limit|limit reached|rate.?limit|resets? /i`, checked against the result text and stderr
  of a failed run) and `usageLimitResetAt` (the `|<epoch>` suffix or an ISO timestamp). Run-level
  causes are: spawn error, not on the subscription login (`providerSignal`), the MCP server missing
  or not started, and a usage or rate limit. They produce
  `RUNNER_UNAVAILABLE: <one line, ≤ 400 chars>` with `runnerUnavailable: true`, plus `usageLimit`
  for a limit. `ClaudeOutcome` gained `runnerUnavailable` and `usageLimit`.
- `tools/author-runner/src/runner.ts:554`: after the `complete` of a run-level failure the loop
  breaks, so no further claim is made and no other item is charged an attempt. Items are claimed one
  at a time right before their run (ai-agent-2), so no other claims are outstanding to release. A
  usage limit writes `<logDir>/runner-state.json` `{ limitedUntil, reason }`; `limitedUntil`
  (`runner.ts:120`) is the parsed reset time when it lies in the future and within 8 days, else
  now + 1 h.
- `runner.ts:364`: while `limitedUntil` is in the future, `once` re-sends kept completes, sends an
  `error` heartbeat (`RUNNER_UNAVAILABLE: usage limit until …`) and exits 0 without claiming. It
  deletes an expired state file. New log events are `runner_unavailable` and `usage_limited`
  (`src/logs.ts`).
- The fake claude has a new `usage_limit` mode (`tests/fixtures/fake-claude.mjs`).
- Tests:
  - `runner.test.ts`: "stops the loop on a usage limit: one attempt, no second claim, no claim before the reset (M5, ai-agent-17)", "holds a usage limit without a named reset for one hour, and a named one only when plausible", "stops the loop when claude cannot be started, without a usage-limit hold (M5, ai-agent-17)"
  - `claude.test.ts` › "run-level failures and the CLI error text (M5, ai-agent-17)" (3 tests)
- Existing assertions updated because M5 makes the old values wrong:
  - `claude.test.ts` and `runner.test.ts`: the errors for claude not starting, not being on the
    subscription, and the MCP server not starting now carry the `RUNNER_UNAVAILABLE: ` prefix.
  - The `is_error` error now names the subtype and text instead of the bare `claude result is_error`.
  - The `toEqual` outcome objects include the two new fields.

### ai-agent-3
Status: partially fixed (runner and MCP-server side of M1 done; storing it and routing to
`AUTHOR_NOT_GATED` are src_C and migration 036, and copying it into the gate report is evals, all
outside this issue's paths)

- `tools/author-runner/src/authorConfig.ts:108` `authorConfigIdOf`: `authorConfigId` is the lowercase
  hex SHA-256 of the canonical JSON (sorted keys, no spaces) of
  `{argsSha256, model, promptSha256, skillSha256, skillVersion}`, where `argsSha256` is the existing
  `claudeArgsSha256`. It does not include `claudeVersion`, `runnerVersion` or the MCP bundle hash, so
  a Claude Code auto-update no longer changes the gated identity. `DISABLE_AUTOUPDATER` therefore does
  not need to pass the env allowlist. The local 16-hex `id` stays the full fingerprint and is still
  logged on `item_start`.
- `runner.ts:471`, `:482`, `:535`: `authorConfigId` is recorded at the top level of
  `runs/<runId>.meta.json`, and also inside `authorConfig`, for the evals import. It reaches the MCP
  server as `DC_AUTOMATION_AUTHOR_CONFIG_ID`.
- `tools/mcp-server/src/server.ts:86-107`, `:310-322`: `automationAuthorFrom` reads it (one printable
  token, ≤ 128 chars). Inside a run `submit_draft` adds it to the `agent` block as `authorConfigId`,
  and only from the runner's environment: the tool-call `agent` schema stays
  `{ model, skillVersion }` (strict), so the model cannot claim an identity.
- The README rule now reads "a new `authorConfigId` needs a new eval gate"
  (`tools/author-runner/README.md`, Author configuration).
- Tests:
  - `authorConfig.test.ts`: "computes the gated authorConfigId from the canonical JSON of the five M1 fields, without the CLI or runner version (M1)"
  - `runner.test.ts`: "records the gated authorConfigId in the run meta and passes it to the MCP server (M1, ai-agent-3)"
  - `mcp-server/tests/automationRun.test.ts`: "sends the runner-pinned model and skill version instead of what the model claims" (now also expects `authorConfigId`), "sends no authorConfigId when the runner set none, and never takes one from the model (M1)", "reads only printable single-token values"

### ai-agent-18
Status: fixed

- `tools/author-runner/src/claude.ts:103` `killGroup`: EPERM, which macOS returns for a
  zombie-only group, is treated like ESRCH and returns `false` (the group can no longer be
  signalled). Other errors are still rethrown to direct callers.
- `claude.ts:124`: inside `runClaude`, every group signal from the `'exit'` listener, the timeout
  timer and the grace timer goes through a total wrapper. A throw counts as "gone" and the run still
  reaches `finish()`, then `complete`, the final heartbeat and the lock release.
- Tests:
  - `runner.test.ts`: "settles a timed-out run and releases the lock when the group probe throws EPERM (ai-agent-18)", which covers both the `'exit'`-listener probe and the grace-timer probe
  - `claude.test.ts`: "answers false for a group that is gone (ESRCH) or holds only zombies (EPERM on macOS)"

### ai-agent-21
Status: fixed

- `tools/author-runner/src/runner.ts:200` `runSourceHosts(configured)`: the queue item's own host is
  no longer added. The run's `read_source` allowlist is exactly `DC_RUNNER_SOURCE_HOSTS`, lowercased
  and deduplicated. This follows the issue's specific direction (the item host gets no implicit pass), which is
  stricter than the audit's suggestion of an exception for manual items; see Deviations. An item on
  another host gets `SOURCE_HOST_NOT_ALLOWED` and the agent reports `blocked`.
- `tools/author-runner/prompts/queue-item.md` step 3 says so.
- `.claude/settings.json` denies `Read(./**/.env*)`, `Read(./**/*.tfstate*)`, `Read(./**/*.tfvars)`
  and `Read(./**/*.pem)`. The run loads these through `--setting-sources project`.
- READMEs updated: `tools/author-runner/README.md` (config table, security notes) and
  `tools/mcp-server/README.md`.
- Tests:
  - `runner.test.ts`: "gives the queue item host no implicit pass to read_source (ai-agent-21)"
  - `settings.test.ts`: "denies secret-shaped files of the checkout in the project settings the run loads", "tells the agent that the queue item host has no implicit pass"
- Updated assertion: "runs one claimed item end to end against the loopback API" no longer expects
  `docs.example.com` (the item host) in `DC_AUTOMATION_SOURCE_HOSTS`. That was the behaviour this
  finding removes.

### automation-16
Status: partially fixed (runner side done; the server accepting a notes-only complete for an
`abandoned` run is src_C, another wave)

- `tools/author-runner/src/runner.ts:418`: `replayPending()` now also runs before every later claim
  of the same run (`n > 0`), not only at the next launch. A complete kept after item 1 is therefore
  re-sent while its run is still within its lease, before item 2 is claimed.
- Tests:
  - `runner.test.ts`: "re-sends a kept complete before the next claim of the same run (automation-16)"
- The two existing next-launch replay tests now run with `maxItems: 1`. They still pin the replay at
  the next launch; with the default three items the new in-run replay would happen first. No
  assertion was weakened.

### ai-agent-22
Status: fixed

- `tools/author-runner/src/cli.ts:27-30`: USAGE shows the real default
  (`${DEFAULT_RUNNER_MODEL}` = `claude-opus-5-5`), says that floating aliases are refused, and lists
  `DC_RUNNER_SOURCE_HOSTS` with its default taken from `DEFAULT_AUTOMATION_SOURCE_HOSTS`.
- `tools/author-runner/scripts/install.sh:59`, `:69` and
  `launchd/app.developercards.author-runner.plist.template:19-24`: the plist's
  `EnvironmentVariables` now carry `DC_REPO_ROOT` and `DC_TOKEN_FILE` with the values `install.sh`
  checked (the defaults when unset). A non-default token file that passed the install check is
  therefore the one every hourly run uses. The token path is refused if it contains a newline or a
  control character, like the other rendered values.
- Tests:
  - `cli.test.ts`: "prints the usage with the model default the config uses and every DC_RUNNER_* variable it reads"
  - `install.test.ts`: "renders the launchd plist in DRY_RUN without writing anything" (new assertions for both keys)

## Contract

- **M5 (runner side):** a run-level failure completes the current run with
  `error = "RUNNER_UNAVAILABLE: <one line>"` (≤ 500 chars as sent) and stops the claim loop. There are
  no remaining claims to release, because the runner claims `max: 1` right before each run. A usage
  limit also holds later launches until `limitedUntil`. A per-item failure carries
  `<subtype>: <first 300 chars of result, one line>`. `AGENT_BLOCKED:` and `AGENT_NO_RESULT:` are
  unchanged (L6). The server's handling of `RUNNER_UNAVAILABLE` (requeue without charging an
  attempt, the `runner_unavailable` email) belongs to the src_C wave.
- **M1 (runner and MCP side):** `authorConfigId` is computed as specified, recorded in the run meta
  (top-level and in `authorConfig`), passed to the MCP server as `DC_AUTOMATION_AUTHOR_CONFIG_ID`,
  and sent as `agent.authorConfigId` (string, ≤ 128 chars) on `POST /api/v1/authoring/drafts`. No
  route, table or existing env key was renamed. The one new env key is internal: runner to MCP
  server.

## Deviations

- ai-agent-21: I followed the issue's direction ("the queue item's own host must pass the same
  allowlist rule as every other host") and gave no exception for `manual` items. To have an
  owner-queued page on a new host read, the owner adds that host to `DC_RUNNER_SOURCE_HOSTS`.
- ai-agent-3: I kept `claudeVersion` in the local record and `id` instead of allowing
  `DISABLE_AUTOUPDATER`. The gated `authorConfigId` no longer depends on it.

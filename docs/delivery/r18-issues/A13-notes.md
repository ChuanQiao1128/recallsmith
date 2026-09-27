# A13 — `tools/author-runner`: local authoring runner (#418)

Nothing here was run for real: no `claude`, no `launchctl`, no real token file, no network beyond
loopback. The tests use a loopback fake API, a temp `HOME` and `tests/fixtures/fake-claude.mjs`;
`scripts/install.sh` was only run with `DRY_RUN=1`.

## Contract-only dependency on A02

The server side of the three runner routes (`POST /api/v1/authoring/automation/runner/heartbeat`,
`…/claim`, `…/complete`) is A02 in wave S and does not exist on this branch. The client follows the
A00 §8.5 request and response bodies key for key (`src/api.ts`) and is tested against a loopback
fake that answers with the same envelopes. The first real run happens after the release merge and
the owner's install (A00 §19.2 step 9).

## Route discovery

`src/api.ts` spells each call `api.request('POST', '/api/v1/authoring/automation/runner/<name>', body)`
so that `infra/scripts/check-agent-routes.py` (`MCP_CALL_RE`) can discover them. Today that script
scans only `tools/mcp-server/src`; it sees the runner only after A10 (wave P) extends it to
`tools/author-runner/src/**/*.ts` and the waves meet in the release merge. `tests/api.test.ts`
applies the same regex to `src/` and expects exactly the three POST routes. The runner lives outside
`tools/mcp-server/src`, so `AgentClientPolicyTests.Allows_ExactlyTheMcpServerEndpoints` is untouched.

## Decisions this issue adds to A00 §11

- **Exit codes.** `0` done (also lock held, mode `off`, nothing claimed; failed items are reported
  through `complete`, not the exit code), `1` API error on the first heartbeat or the claim, or an
  unexpected error (after a best-effort `error` heartbeat), `2` usage or `ConfigError`
  (`config_error` logged), `3` login required (`login_required` logged; no further API call).
  A login failure is a `ToolFailure` whose message starts with the MCP server's `LOGIN_HINT` or with
  `HTTP 401`; it counts on the claim as well as on the first heartbeat.
- **`last-run.json`.** `<logDir>/last-run.json` = `{ runId, itemId, outcome, finishedAt, durationMs }`
  of the last item run, written after each `complete`. Heartbeats take `lastRunId`, `lastRunAt`
  (= `finishedAt`) and `lastRunOutcome` from it; `lastError` is only set on an `error` heartbeat.
- **`lease_short`.** An item whose `leaseExpiresAt` is earlier than now + the item timeout is not
  started (the server requeues it when the lease lapses); it does not make the final heartbeat `error`.
- **`bad_item` validation.** Before any value is used in a path or a prompt: `runId` is a uuid,
  `itemId` a positive integer, `deckSlug` matches `^[a-z0-9][a-z0-9-]*$`, `url` starts with
  `https://`, and `leaseExpiresAt` parses as a date. An invalid item is logged `bad_item` (no raw
  value in the log) and not run; its lease lapses.
- **`claudeVersion`.** First line of `<claudeBin> --version` (spawnSync, 10 s, scrubbed env), cut
  to 80 characters, `null` on any failure; once per `once` run, never by `status`.
- **`status` output.** Exactly one JSON line `{ runnerId, loginExpiresAt, loginExpiresInDays,
  tokenFile: "present"|"missing", lastLocalRun }`; `loginExpiresInDays` rounded to one decimal or
  `null`; `lastLocalRun` is `last-run.json` or `null`. No network call, no claude call, never the
  token file path or content.
- **Timeout.** SIGTERM to the process group (`-pid`) at `itemTimeoutMs`; if any member of the group
  is still alive after `killGraceMs`, SIGKILL to the group; `ESRCH` is ignored. The outcome is
  `failed` / `timeout` with `exitCode: null`.
- **Result reading.** Exit 0 with `is_error: false` ⇒ the last non-empty line of `result` parsed as
  JSON gives `outcome` (`done` | `nothing_new`, anything else ⇒ `done`) and `summary` (`notes`,
  ≤ 2000); `is_error` not `false` ⇒ `claude result is_error`; unparsable stdout ⇒
  `claude output is not JSON`; other exits ⇒ the first 500 characters of stderr with newlines as
  spaces, or `exit <code>`; a spawn error ⇒ `claude could not be started: <code>`.
- **Final heartbeat.** `error` with `lastError` (≤ 500) when an item failed or a `complete` failed,
  else `idle`. A failed heartbeat during or after the items is logged `heartbeat_failed` only.
- **Config.** `DC_RUNNER_MODEL` empty ⇒ default `opus`. `DC_API_BASE`/`DC_TOKEN_FILE`/`DC_REPO_ROOT`
  go through the MCP server's `loadConfig` with the runner's `HOME`; its errors become `ConfigError`.
  The token file default therefore follows `HOME` (temp HOME in tests and checks).
- **Code layout.** `src/cli.ts` holds `main` and the usage text (imported by `tests/status.test.ts`);
  `src/index.ts` only calls it, so importing the CLI in a test never starts a run. The prompt
  renderer is `src/prompt.ts`.

## Install script details

- The plist is rendered with `sed` using the `\001` control character as the delimiter (a path
  holding it, or a newline, is refused); values are XML-escaped (`&`, `<`, `>`) and then escaped
  for the sed replacement.
- `PATH` in the plist is the directories of `node`, `claude` and `uv` (deduplicated, in that order)
  followed by `/usr/bin:/bin`.

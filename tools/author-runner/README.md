# DeveloperCards author runner

A small Node CLI that the owner's Mac runs once an hour under launchd. Each run claims items from
the DeveloperCards authoring queue, drafts **new** cards for each item with headless Claude Code
(`claude -p` + the DeveloperCards MCP server + the `author-cards` skill), and reports every outcome
back to the API. Contract: A00 §11 (R18A).

What it is:

- **Local only.** It runs on the owner's Mac, never in the cloud.
- **The owner's Claude subscription.** Claude Code uses the owner's own Claude login. The runner
  passes `claude` only an allowlist of variables (see Security notes), so no API key, provider
  switch or cloud credential reaches it, and a run whose `system`/`init` message does not show the
  subscription login (`apiKeySource: "none"`) or whose result shows a cloud provider model is
  reported as failed.
- **Drafts only.** Claude submits drafts through the MCP server's `submit_draft`. What happens to a
  draft (human review, AI QA, auto-accept, publish) is decided by the server, never by the runner.
- **No runtime dependency.** `dist/index.js` is one esbuild bundle that includes the MCP server's
  API client, config loader and token refresh (`tools/mcp-server/src/{api,config,auth/tokens}.ts`).

What it is not: it is not a server, it holds no cloud credential, it never edits deck files, and it
calls exactly three API routes:

| Route | When |
|---|---|
| `POST /api/v1/authoring/automation/runner/heartbeat` | start of a run, every 5 minutes while claude runs, end of a run |
| `POST /api/v1/authoring/automation/runner/claim` | before each item, one item per claim (up to `DC_RUNNER_MAX_ITEMS` claims per run) |
| `POST /api/v1/authoring/automation/runner/complete` | once per claude run, and once per claimed item that is not run (released as `failed`) |

## One run (`once`)

1. Take the lock `~/Library/Application Support/DeveloperCards/author-runner.lock` (a run that
   finds it held exits 0; a lock whose process is gone is taken over, and a lock of a live process only
   once it is older than the longest run the configuration allows: `DC_RUNNER_MAX_ITEMS` x
   (`DC_RUNNER_ITEM_TIMEOUT_MINUTES` + 1.6 min) + 30 min).
2. Delete files older than 30 days in `<log dir>/runs/` and `<log dir>/pending-complete/`.
3. Work out `loginExpiresAt` from the stored id token and read `claude --version`.
4. Pin the author configuration (see Author configuration). A checkout it cannot pin (no
   `.claude/skills/author-cards/SKILL.md` with a `Skill version:` line, or no built
   `tools/mcp-server/dist/index.js` and `dist/tool-surface.json`) logs `author_config_error`,
   sends an `error` heartbeat and exits 1 without claiming. While `<log dir>/runner-state.json` holds
   a `limitedUntil` in the future (a usage limit, see step 6), the run only re-sends kept `complete`s,
   sends an `error` heartbeat (`RUNNER_UNAVAILABLE: usage limit until …`, event `usage_limited`) and
   exits 0 without claiming; a past `limitedUntil` is deleted. While it holds a hold (N3,
   `holdUntilCleared: true`, see step 6) whose `authorId` and `claudeVersion` are the pinned
   configuration's `id` and the current `claude --version`, the run does the same with
   `RUNNER_UNAVAILABLE: held since … until the owner clears …` (event `runner_held`); a hold that
   names another configuration or CLI version (the owner changed either) is deleted (`hold_cleared`).
5. `heartbeat` (`running`). A login failure exits 3. Then re-send every kept `complete` in
   `<log dir>/pending-complete/` (see step 6) once, before any claim; one the server applies (or
   answers `replayed: true`) or refuses with a client error (for example 409 `RUN_NOT_RUNNING` after
   the lease lapsed) is deleted, any other failure keeps it for the next run. An effective mode of
   `off` then sends `idle` (or `error` when a re-send failed) and exits 0.
6. Up to `DC_RUNNER_MAX_ITEMS` times: `claim` **one** item (`max: 1`), right before its run, so every
   item gets a lease that starts when its claude run starts. Nothing claimed: stop (`idle`, exit 0 when
   it is the first claim). Check the item's fields and that its lease covers a full claude run; an
   item that fails either check is released at once with `complete` (`failed`, `not run: …`) instead
   of staying claimed until its lease lapses, and a short lease ends the run. Otherwise write
   `runs/<runId>.mcp.json`, `runs/<runId>.prompt.md` and `runs/<runId>.meta.json`, run claude (stdout,
   `--output-format stream-json --verbose`, piped through the runner into `runs/<runId>.json`, stderr to
   `runs/<runId>.stderr.log`), then `complete` with the outcome and write `last-run.json`. Every
   `complete` is tried up to 3 times with a jittered backoff (about 2 s, then 4 s) unless the server
   refuses it with a client error; when all attempts fail, the request with the agent's notes is kept
   in `<log dir>/pending-complete/<runId>.json` (`complete_pending`) and re-sent before the next
   claim of the same run (automation-16), while its run is still within its lease, and again by the
   next launch if that fails too.
   A failure that affects every item (M5: claude cannot be started, it did not run on the
   subscription login, the developercards MCP server did not start, or a usage or rate limit in the
   CLI's result text or stderr) completes the run as `failed` with the error
   `RUNNER_UNAVAILABLE: <one line>` and ends the loop (`runner_unavailable`): nothing more is claimed,
   so no other item is charged an attempt. A usage limit also writes `<log dir>/runner-state.json`
   (`{ limitedUntil, reason }`: the reset time the CLI named, else one hour later). A cause that does
   not go away by itself (N3: claude cannot be started, it did not run on the subscription login, or
   the developercards MCP server failed or is missing) writes a hold there instead,
   `{ holdUntilCleared: true, reason, since, authorId, claudeVersion }` (event `runner_held`), so no
   later hourly run claims, re-authors or bills anything until the owner fixes the cause and deletes
   the file (or changes the author configuration or the CLI). The login and the MCP server are
   judged when claude's `system`/`init` message arrives: one that shows another `apiKeySource` than
   `none`, a developercards server that `failed` or is missing, or a model message before any init
   message ends claude's process group at once (SIGTERM, then SIGKILL after the grace period), before
   the first model turn; the same check runs again on every outcome (a timeout, an `is_error` result,
   a non-zero exit, a success). Any other failed
   run carries the CLI's result subtype and the first 300 characters of its result text on one line
   (stderr when there is no result message), and the loop goes on with the next item.
7. Final `heartbeat`: `idle`, or `error` with the last error when a run failed, an item was not run
   or `complete` failed.

## Owner install (once, on the Mac)

From the repository root, after the release (A00 §19.2 step 9):

```bash
(cd tools/mcp-server && npm ci && npm run build)
(cd tools/author-runner && npm ci && npm run build)
node tools/mcp-server/dist/index.js login
tools/author-runner/scripts/install.sh
node tools/author-runner/dist/index.js status
```

`install.sh` checks node ≥ 22.18, that `claude` and `uv` are on `PATH` (it never runs `claude`),
that both `dist/index.js` files exist and that the token file exists (it never reads it). It then
renders `launchd/app.developercards.author-runner.plist.template` into
`~/Library/LaunchAgents/app.developercards.author-runner.plist`, lints it with `plutil -lint` and
loads it with `launchctl bootstrap`. The job runs `once` every hour (`StartInterval` 3600, not at
load, background priority); a sleeping Mac simply misses runs, and an item whose lease lapses goes
back to the queue on the server.

`DRY_RUN=1 tools/author-runner/scripts/install.sh` runs every check and prints the rendered plist,
and nothing else, on stdout; it writes nothing and loads nothing. The plist sets `DC_REPO_ROOT` and
`DC_TOKEN_FILE` to the values `install.sh` checked (its own checkout and the default token file
unless they are set when it runs), so a non-default token file checked at install time is the one
every hourly run uses. Set any other `DC_*` variable in the plist by hand after installing.

## Uninstall

```bash
tools/author-runner/scripts/uninstall.sh
```

Unloads the job (`launchctl bootout`, "not loaded" is fine) and removes the plist. `DRY_RUN=1`
prints what it would do and changes nothing. Logs under `~/Library/Logs/DeveloperCards/` are kept.

## Commands

| Command | What it does |
|---|---|
| `node tools/author-runner/dist/index.js once` | one run (above) |
| `node tools/author-runner/dist/index.js status` | prints one JSON object `{ runnerId, loginExpiresAt, loginExpiresInDays, tokenFile: "present"\|"missing", lastLocalRun }`; no network call, no claude call |
| `node tools/author-runner/dist/index.js --help` | usage |

## Configuration

Every variable is optional.

| Variable | Default | Notes |
|---|---|---|
| `DC_RUNNER_ID` | the hostname, lowercased, other characters → `-`, ≤ 64 (else `mac`) | must match `^[a-z0-9][a-z0-9-]{0,63}$` |
| `DC_RUNNER_MAX_ITEMS` | `3` | items run per run (one claim each), 1..5 |
| `DC_RUNNER_LEASE_MINUTES` | `90` | claim lease of one item, 15..240; must be at least `DC_RUNNER_ITEM_TIMEOUT_MINUTES` + 1 |
| `DC_RUNNER_ITEM_TIMEOUT_MINUTES` | `45` | claude time limit per item, 5..120 |
| `DC_RUNNER_MODEL` | `claude-opus-5-5` | `claude --model`; a full model id (no whitespace, ≤ 100 characters); a floating alias such as `opus`, `sonnet`, `haiku`, `default` or `opusplan` is refused |
| `DC_RUNNER_SOURCE_HOSTS` | `docs.aws.amazon.com,aws.amazon.com,platform.claude.com,docs.claude.com,docs.anthropic.com,www.anthropic.com` | the only hosts `read_source` may fetch in a run (comma list of host names); the queue item's own host gets no implicit pass, so a feed item on a host not listed here ends `AGENT_BLOCKED` |
| `DC_RUNNER_CLAUDE_BIN` | `claude` | the Claude Code executable (on `PATH` by default) |
| `DC_RUNNER_LOG_DIR` | `~/Library/Logs/DeveloperCards` | `runs/` and `last-run.json` |
| `DC_API_BASE` | `https://api.developercards.app` | as in the MCP server (https, or http only for loopback) |
| `DC_TOKEN_FILE` | `~/.config/developercards/mcp-tokens.json` | the MCP server's token file |
| `DC_REPO_ROOT` | three levels above `dist/index.js` | the checkout claude runs in |

An invalid value logs `config_error` naming the variable and its range, and exits 2.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the run finished (also: the lock was held, the mode is `off`, or nothing was claimed); failed items are reported to the server, not in the exit code |
| 1 | an API error on the first heartbeat or a claim, an author configuration that cannot be pinned, or an unexpected error |
| 2 | usage or configuration error |
| 3 | login required: run `node tools/mcp-server/dist/index.js login` |

## Logs

- `~/Library/Logs/DeveloperCards/author-runner.log` (launchd stdout and stderr): one compact JSON
  object per line, `{ ts, level, event, runnerId, runId?, itemId?, outcome?, durationMs?, authorConfigId?, costUsd?, replayed?, error? }`.
  Events: `start`, `locked`, `config_error`, `login_required`, `mode_off`, `claimed`, `no_items`,
  `item_start` (with `authorConfigId`), `item_done` (with `costUsd`, the CLI's `total_cost_usd`
  estimate), `lease_short`, `bad_item`, `author_config_error`, `heartbeat_failed`, `complete_failed`,
  `complete_pending` (a `complete` kept for the next run), `complete_replayed` (a kept `complete`
  re-sent; `replayed: true` when the server had already applied it), `runner_unavailable` (a
  run-level failure ended the loop), `usage_limited` (a usage limit holds the runner until the time in
  `error`), `runner_held` (a run-level hold was written, or holds this run), `hold_cleared` (a hold of
  another author configuration or CLI version was dropped), `api_error`, `finish`,
  `unexpected_error`. For example `grep '"event":"login_required"'`.
- `~/Library/Logs/DeveloperCards/runs/<runId>.{mcp.json,prompt.md,meta.json,json,stderr.log}`: the
  MCP config, the prompt, the run record (`{ runId, itemId, startedAt, finishedAt, outcome,
  authorConfigId, authorConfig, usage: { totalCostUsd, models, apiKeySource } }`), claude's stream-json output (one
  message per line: `system`/`init`, the conversation, `result`) and its
  stderr for one item. Files older than **30 days** are deleted at the start of every run.
- `~/Library/Logs/DeveloperCards/pending-complete/<runId>.json`: `{ savedAt, itemId, request }`, a
  `complete` request (with the notes as `summary`) that could not be sent; re-sent before the next
  claim or by the next run.
- `~/Library/Logs/DeveloperCards/runner-state.json`: `{ limitedUntil, reason }` after a usage limit;
  no run claims before `limitedUntil`. Delete it to retry earlier. `{ holdUntilCleared: true, reason,
  since, authorId, claudeVersion }` after a run-level cause that does not go away by itself (N3); no
  run claims until the owner deletes it or the author configuration or the CLI changes.
- `~/Library/Logs/DeveloperCards/last-run.json`: `{ runId, itemId, outcome, finishedAt, durationMs }`
  of the last item; `status` shows it and heartbeats report it.

No log line or file ever holds a token or the token file's content.

## Login lifetime (30 days)

The runner uses the MCP server's login. The console-dev refresh token lasts **30 days from sign-in**,
so every heartbeat reports `loginExpiresAt` = the id token's `auth_time` (else `iat`) + 30 days, and
`status` shows `loginExpiresInDays`. The server warns by email: `runner_login_expiring` before the
login runs out, and `runner_stalled` when no heartbeat arrives (an expired login, a Mac that is off,
a broken launchd job). Sign in again with `node tools/mcp-server/dist/index.js login`; no reinstall
is needed.

## Troubleshooting

| Symptom | Check |
|---|---|
| `login_required`, exit 3 | `status` shows `tokenFile: "missing"` or an expired `loginExpiresAt`: run `login` |
| `locked` on every run | another run is still going; a lock of a dead process, or one older than the longest configured run, is taken over automatically |
| `mode_off` / `no_items` | the server's automation mode is `off`, or the queue has nothing due; nothing to do |
| `lease_short` | the server granted a lease that ends before `DC_RUNNER_ITEM_TIMEOUT_MINUTES` would; the item is released at once (`complete` `failed`, so the server retries it with its backoff) and the run stops; check the server's lease limit |
| `bad_item` | the server sent an item with an invalid run id, item id, deck slug or non-https URL; it is not run and is released at once (`complete` `failed`) unless its run id itself is invalid |
| `author_config_error` | `.claude/skills/author-cards/SKILL.md` is missing or has no `Skill version:` line in `DC_REPO_ROOT`, or `tools/mcp-server/dist/index.js` or `dist/tool-surface.json` is not built |
| `item_done` with `failed` | the error names the CLI result subtype and text; read `runs/<runId>.stderr.log` and `runs/<runId>.json` |
| `RUNNER_UNAVAILABLE: …` / `runner_unavailable` | a cause that affects every item ended the run after one item; the server requeues that item with its backoff (N3). `claude could not be started: ENOENT` means `claude` is not on the job's `PATH` (reinstall after moving it) |
| `runner_held` / `RUNNER_UNAVAILABLE: held since …` | an earlier run hit a cause that does not go away by itself (no `claude`, not on the subscription login, MCP server failed); fix it, then delete `runner-state.json` (a Claude Code update or a changed author configuration also drops the hold) |
| `usage_limited` | the Claude subscription's usage or rate limit was hit; no run claims before `limitedUntil` in `runner-state.json` (delete the file to retry earlier) |
| `timeout` | claude ran longer than the item timeout; its process group got SIGTERM, then SIGKILL 30 s later, and the run is settled at most 5 s after that even if a member of the group lingers |
| `claude did not run on the subscription login` | claude's `system`/`init` message had no `apiKeySource` or one other than `none` (for example `/login managed key`: a Console API key saved by `/login`), or its result named a Bedrock/Vertex model id; sign `claude` in with the Claude subscription (`/login`, claude.ai account) |
| `AGENT_BLOCKED: …` | the agent could not do the task (a tool was refused or failed, the source could not be read) and said why; the run is `failed`, so the server retries the item; read the reason and `runs/<runId>.json` |
| `AGENT_NO_RESULT: …` | the agent's final message did not end with a valid outcome JSON line; the run is `failed`, never counted as done |
| `the developercards MCP server did not start` | the `system`/`init` message showed the MCP server `failed` or missing; rebuild `tools/mcp-server` and check `runs/<runId>.stderr.log` |
| nothing in the log | `launchctl print gui/$(id -u)/app.developercards.author-runner`, then reinstall |

## Author configuration

Auto-accept precision depends on the author as well as on the reviewer, so every run pins and
records the author configuration it used (`src/authorConfig.ts`), read from the checkout when the
run starts:

- `model`: `DC_RUNNER_MODEL`, a full model id (a floating alias is refused at config load);
- `skillVersion`: parsed from the `Skill version:` line of `.claude/skills/author-cards/SKILL.md`
  and rendered into the prompt (never a literal in the prompt);
- `skillSha256` (every file of the skill directory), `promptSha256` (`prompts/queue-item.md`),
  `claudeArgsSha256` (the claude argument list together with `toolSurfaceSha256`, N4),
  `toolSurfaceSha256` (the SHA-256 of the canonical JSON of `tools/mcp-server/dist/tool-surface.json`:
  the tool names, descriptions and input schemas the agent sees, the lint limits and the MCP server
  version), `mcpServerVersion`, `mcpToolNames` (sorted), `mcpServerSha256`
  (`tools/mcp-server/dist/index.js`; a checkout without it or without `tool-surface.json` runs
  nothing, `author_config_error`), `claudeVersion` and `runnerVersion`;
- `id`: the first 16 hex characters of the SHA-256 of all of the above (a local fingerprint);
- `authorConfigId` (M1): the lowercase hex SHA-256 of the canonical JSON (sorted keys, no spaces) of
  `{ argsSha256, model, promptSha256, skillSha256, skillVersion }` (`argsSha256` is
  `claudeArgsSha256`, so it covers the MCP tool surface, N4). It leaves out the Claude Code and runner
  versions, so a routine Claude Code auto-update does not change it.

The job runs in the owner's working tree, so a branch switch, an uncommitted skill edit or a rebuilt
MCP server changes `id`. The runner passes the model, skill version and `authorConfigId` to the MCP
server (`DC_AUTOMATION_AUTHOR_MODEL`, `DC_AUTOMATION_SKILL_VERSION`,
`DC_AUTOMATION_AUTHOR_CONFIG_ID`), which sends them in every draft's `agent` block instead of what
the model claims. The full configuration and `authorConfigId` are in `runs/<runId>.meta.json`, and
the local `id` is on the `item_start` log line. The eval gate copies `authorConfigId` from the run
records of its new-facts runs, and a live auto-accept requires the draft's `agent.authorConfigId`
to equal the gate's (else `AUTHOR_NOT_GATED`, M1).

**The one re-gate rule: any change of `authorConfigId` needs a new eval gate before the automation
auto-accepts in `live` on it.** That is a change of the model, any skill file, the queue-item prompt,
the claude arguments, or the MCP tool surface (a tool name, description or input schema, a lint
limit, or the MCP server version). A Claude Code or runner update alone does not; neither does a
rebuild of the MCP server that leaves its tool surface as it was (it changes only the local `id`).

## Agent notes

The prompt tells the agent to put anything the owner should act on, above all an existing card that
looks wrong, in the `notes` of its final JSON line. The runner sends those notes (trimmed, at most
2000 characters, `null` when blank) as `summary` in `complete`; the owner reads them on the console
Runs tab and in the automation email.

## Final outcome line (L6)

The agent ends with `{"outcome":"done"|"nothing_new"|"blocked","submitted":n,"reason":…,"notes":…}`.
`done` and `nothing_new` complete the run as such. `blocked` (also spelled
`{"result":"blocked","reason":…}`) means the agent could not do the task, for example a refused or
failed tool or an unreadable source: the run completes as `failed` with error
`AGENT_BLOCKED: <reason>` (one line, at most 300 characters) and the notes as `summary`. A final
message without a valid outcome line completes as `failed` with `AGENT_NO_RESULT: …`, never as a
success. The server API is unchanged.

## Security notes

- **Environment allowlist.** The `claude` child gets only `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`,
  `TMPDIR`, `LANG`, `TERM`, `TZ`, `CLAUDE_CONFIG_DIR`, `LC_*` and `DC_*` from the runner's
  environment. As a second check, `ANTHROPIC_*`, `CLAUDE_CODE_USE_*` and `AWS_*` are dropped even
  if the allowlist grows. So no API key, provider switch (Bedrock, Vertex, Foundry, …), custom header
  or proxy reaches it, also on a manual `once` run from a shell.
- **Subscription check.** Claude Code reports where its credential came from as `apiKeySource` in the
  `system`/`init` message of `--output-format stream-json --verbose` (not in the result message);
  `none` means no API key is in use (the claude.ai subscription login). The runner reads that message
  as it arrives (N3) and ends the process group before the first model turn when it has no
  `apiKeySource` or any other value (`ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, …), or
  when a model message comes first. On every outcome it checks again, and a `modelUsage` model id of
  a cloud provider (`anthropic.` segment, ARN or `@version`) in the result fails the run too
  (`claude did not run on the subscription login: …`); each of these holds the runner until the owner
  clears it.
  This catches a Console API key that `/login` stored in the keychain, which the environment
  allowlist cannot remove. The CLI's cost estimate and model ids are
  recorded in `runs/<runId>.meta.json`.
- **Tool allowlist.** `--tools Read,Task,Agent,Skill` and `--allowedTools` listing the four
  DeveloperCards MCP tools (`read_source`, `find_similar_cards`, `lint_card`, `submit_draft`),
  `Task`, `Agent`, `Skill`, `Read(content/decks/FORMAT.md)` and `Read(.claude/skills/author-cards/**)`,
  with `--permission-mode dontAsk`. There is no `Bash`, `WebFetch`, `Edit` or `Write` tool and no
  `--dangerously…` flag. The two `Read(...)` entries only pre-approve those paths; they do **not**
  restrict `Read`. Claude Code allows read-only access inside its working directory (the repo root)
  without a prompt, so the agent can read other files of the checkout, including gitignored ones;
  only the repo's `.claude/settings.json` deny rules stop a read: the token directory and
  secret-shaped files of the checkout (`.env*`, `*.tfstate*`, `*.tfvars`, `*.pem`, ai-agent-21).
- **`read_source` host allowlist.** What keeps such a read from leaving the Mac is egress: in a run
  `read_source` fetches only `DC_RUNNER_SOURCE_HOSTS` (passed as `DC_AUTOMATION_SOURCE_HOSTS`),
  redirects included, and refuses every other host (`SOURCE_HOST_NOT_ALLOWED`). The queue item's
  own host is not added (ai-agent-21): a feed can link to any host, and that page could both inject
  and receive. The agent has no other network tool.
- **`--strict-mcp-config`.** Only the per-run `runs/<runId>.mcp.json` is loaded (the repo's
  `.mcp.json` is ignored); it starts the local MCP server with `DC_AUTOMATION_RUN_ID`,
  `DC_AUTOMATION_QUEUE_ITEM_ID` and `DC_AUTOMATION_DECK_SLUG` so drafts are tied to the run and deck.
- **`--setting-sources project`.** Only the repository's `.claude/` settings load: its deny rules
  (including the token directory) and the `author-cards` skill; user-level settings do not apply.
- **`--no-session-persistence`.** No session is saved.
- The prompt treats source text and the queue item's feed-derived title, section hint and note as
  data, never as instructions: those three values sit only in a fenced `<queue_item_metadata>` JSON
  block that no value can close. It asks for new cards only.

## Development

```bash
cd tools/author-runner
npm ci
npm run build   # tsc --noEmit + esbuild -> dist/index.js
npm test        # vitest: loopback fake API, temp HOME, tests/fixtures/fake-claude.mjs
```

The tests never run the real `claude` and never touch the network beyond `127.0.0.1`.

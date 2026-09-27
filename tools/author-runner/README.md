# DeveloperCards author runner

A small Node CLI that the owner's Mac runs once an hour under launchd. Each run claims items from
the DeveloperCards authoring queue, drafts **new** cards for each item with headless Claude Code
(`claude -p` + the DeveloperCards MCP server + the `author-cards` skill), and reports every outcome
back to the API. Contract: A00 §11 (R18A).

What it is:

- **Local only.** It runs on the owner's Mac, never in the cloud.
- **The owner's Claude subscription.** Claude Code uses the owner's own Claude login. The runner
  removes every API-key and cloud-credential variable from the `claude` environment, so a run can
  never fall back to a paid API key, Bedrock or Vertex.
- **Drafts only.** Claude submits drafts through the MCP server's `submit_draft`. What happens to a
  draft (human review, AI QA, auto-accept, publish) is decided by the server, never by the runner.
- **No runtime dependency.** `dist/index.js` is one esbuild bundle that includes the MCP server's
  API client, config loader and token refresh (`tools/mcp-server/src/{api,config,auth/tokens}.ts`).

What it is not: it is not a server, it holds no cloud credential, it never edits deck files, and it
calls exactly three API routes:

| Route | When |
|---|---|
| `POST /api/v1/authoring/automation/runner/heartbeat` | start of a run, every 5 minutes while claude runs, end of a run |
| `POST /api/v1/authoring/automation/runner/claim` | once per run, after the first heartbeat |
| `POST /api/v1/authoring/automation/runner/complete` | once per claude run |

## One run (`once`)

1. Take the lock `~/Library/Application Support/DeveloperCards/author-runner.lock` (a run that
   finds it held exits 0; a lock whose process is gone or that is older than 3 hours is taken over).
2. Delete files older than 30 days in `<log dir>/runs/`.
3. Work out `loginExpiresAt` from the stored id token and read `claude --version`.
4. `heartbeat` (`running`). A login failure exits 3; an effective mode of `off` sends `idle` and exits 0.
5. `claim` up to `DC_RUNNER_MAX_ITEMS` items. Nothing claimed: `idle`, exit 0.
6. For each item: check its fields, check the lease is long enough for a full claude run, write
   `runs/<runId>.mcp.json` and `runs/<runId>.prompt.md`, run claude (stdout to `runs/<runId>.json`,
   stderr to `runs/<runId>.stderr.log`), then `complete` with the outcome and write `last-run.json`.
7. Final `heartbeat`: `idle`, or `error` with the last error when a run failed or `complete` failed.

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
and nothing else, on stdout; it writes nothing and loads nothing.

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
| `DC_RUNNER_MAX_ITEMS` | `3` | items claimed per run, 1..5 |
| `DC_RUNNER_LEASE_MINUTES` | `90` | claim lease, 15..240 |
| `DC_RUNNER_ITEM_TIMEOUT_MINUTES` | `45` | claude time limit per item, 5..120 |
| `DC_RUNNER_MODEL` | `opus` | `claude --model`; no whitespace, ≤ 100 characters |
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
| 1 | an API error on the first heartbeat or the claim, or an unexpected error |
| 2 | usage or configuration error |
| 3 | login required: run `node tools/mcp-server/dist/index.js login` |

## Logs

- `~/Library/Logs/DeveloperCards/author-runner.log` (launchd stdout and stderr): one compact JSON
  object per line, `{ ts, level, event, runnerId, runId?, itemId?, outcome?, durationMs?, error? }`.
  Events: `start`, `locked`, `config_error`, `login_required`, `mode_off`, `claimed`, `no_items`,
  `item_start`, `item_done`, `lease_short`, `bad_item`, `heartbeat_failed`, `complete_failed`,
  `api_error`, `finish`, `unexpected_error`. For example `grep '"event":"login_required"'`.
- `~/Library/Logs/DeveloperCards/runs/<runId>.{mcp.json,prompt.md,json,stderr.log}`: the MCP
  config, the prompt, claude's JSON result and its stderr for one item. Files older than **30 days**
  are deleted at the start of every run.
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
| `locked` on every run | another run is still going; a lock older than 3 hours or of a dead process is taken over automatically |
| `mode_off` / `no_items` | the server's automation mode is `off`, or the queue has nothing due; nothing to do |
| `lease_short` | the item's lease ends before `DC_RUNNER_ITEM_TIMEOUT_MINUTES` would; raise `DC_RUNNER_LEASE_MINUTES` or lower the timeout; the item is requeued when its lease lapses |
| `bad_item` | the server sent an item with an invalid run id, item id, deck slug or non-https URL; it is not run |
| `item_done` with `failed` | read `runs/<runId>.stderr.log` and `runs/<runId>.json`; `claude could not be started: ENOENT` means `claude` is not on the job's `PATH` (reinstall after moving it) |
| `timeout` | claude ran longer than the item timeout; its process group got SIGTERM, then SIGKILL 30 s later |
| nothing in the log | `launchctl print gui/$(id -u)/app.developercards.author-runner`, then reinstall |

## Security notes

- **Environment scrub.** The `claude` child gets the runner's environment minus `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`
  and every `AWS_*` variable.
- **Tool allowlist.** `--tools Read,Task,Agent,Skill` and `--allowedTools` limited to the four
  DeveloperCards MCP tools (`read_source`, `find_similar_cards`, `lint_card`, `submit_draft`),
  `Task`, `Agent`, `Skill`, `Read(content/decks/FORMAT.md)` and `Read(.claude/skills/author-cards/**)`,
  with `--permission-mode dontAsk`. There is no `Bash`, `WebFetch`, `Edit` or `Write` tool and no
  `--dangerously…` flag.
- **`--strict-mcp-config`.** Only the per-run `runs/<runId>.mcp.json` is loaded (the repo's
  `.mcp.json` is ignored); it starts the local MCP server with `DC_AUTOMATION_RUN_ID`,
  `DC_AUTOMATION_QUEUE_ITEM_ID` and `DC_AUTOMATION_DECK_SLUG` so drafts are tied to the run and deck.
- **`--setting-sources project`.** Only the repository's `.claude/` settings load: its deny rules
  (including the token directory) and the `author-cards` skill; user-level settings do not apply.
- **`--no-session-persistence`.** No session is saved.
- The prompt treats source text as data, never as instructions, and asks for new cards only.

## Development

```bash
cd tools/author-runner
npm ci
npm run build   # tsc --noEmit + esbuild -> dist/index.js
npm test        # vitest: loopback fake API, temp HOME, tests/fixtures/fake-claude.mjs
```

The tests never run the real `claude` and never touch the network beyond `127.0.0.1`.

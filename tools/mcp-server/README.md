# DeveloperCards MCP server (`tools/mcp-server`)

A local stdio [MCP](https://modelcontextprotocol.io) server for the 1.8.0 authoring agent. The agent
runs on the owner's own Claude subscription inside Claude Code and reaches DeveloperCards only
through this server: it reads a source, checks for similar cards, lints each draft with the
console's own importer rules, and submits drafts to the human review queue. Nothing the agent
submits is published until a reviewer accepts it in the console (`/review`).

Contract: R18-00 §8.4 (tools, config), §8.1 (DraftCard), §8.2 (similarity), §8.3 (review queue),
§8.5 (ingest CLI).

## Requirements

- Node.js ≥ 22.18.
- [uv](https://docs.astral.sh/uv/) on `PATH` (or in `~/.local/bin`) for `read_source`, which runs the
  ingest CLI in `tools/ingest`.
- A console account in the `super_admin` group: `submit_draft` resolves the deck slug through
  `GET /api/v1/admin/decks`, which only `super_admin` may call.
- The repository checkout: the server reads `content/decks/FORMAT.md` (topic vocabulary) and runs
  `tools/ingest`. It does **not** need `frontend/node_modules`.

## Build

```bash
cd tools/mcp-server
npm ci
npm run build   # tsc type-check, then esbuild -> dist/deckLib.js + dist/index.js
npm test        # vitest; loopback fakes only, no network
```

The build bundles `frontend/src/lib/deckImport.ts` and `frontend/src/lib/sourceRules.ts` (through
`src/deckLib.ts`) into `dist/deckLib.js`, and the server into `dist/index.js`, which loads
`./deckLib.js` at runtime. `dist/` and `node_modules/` are never committed.

## Login

```bash
node tools/mcp-server/dist/index.js login
```

Opens the console's Cognito sign-in page in the browser (authorization code + PKCE S256, client
`console-dev`, scopes `openid email profile`) and waits for the redirect on
`http://localhost:8976/callback`; the listener binds to `127.0.0.1` only and accepts one callback.
Sign in with MFA as usual; the tab then shows "Login complete. You can close this tab."

Tokens are stored in `~/.config/developercards/mcp-tokens.json` (`DC_TOKEN_FILE`), file mode `0600`
in a `0700` directory, as `{ accessToken, idToken, refreshToken, expiresAt }`. The server refreshes
the access token when less than five minutes remain. The refresh token lasts 30 days; after that
(or after any "run `login`" error) run `login` again.

## Configuration

Every variable is optional.

| Variable | Default | Notes |
|---|---|---|
| `DC_API_BASE` | `https://api.developercards.app` | https only (plain http only for `127.0.0.1`, `localhost`, `[::1]`) |
| `DC_COGNITO_DOMAIN` | `https://ap-southeast-24vf8ucxkt.auth.ap-southeast-2.amazoncognito.com` | same rule |
| `DC_COGNITO_CLIENT_ID` | `5au94igdq00nipsst7spsqepb7` | the `console-dev` public client |
| `DC_REDIRECT_PORT` | `8976` | loopback port for the login redirect (0..65535) |
| `DC_TOKEN_FILE` | `~/.config/developercards/mcp-tokens.json` | |
| `DC_REPO_ROOT` | three levels above `dist/` | the repository checkout; `read_source` reads local files from its `sources/` directory |
| `DC_SOURCES_DIRS` | (none) | extra `:`-separated directories `read_source` may read local files from (for example `$HOME/Downloads`) |

Trailing slashes are stripped from the two base URLs.

## Tools

| Tool | Input | Output (JSON text) |
|---|---|---|
| `read_source` | `source` (https URL or local path), `canonicalUrl?` (https), `maxChunkChars?` (1000..8000), `offset?` (≥ 0), `limit?` (1..100), `chunkIds?` (1..20 ids) | paged, because a long guide or whitepaper produces far more text than one MCP tool result may carry. By default one outline page of the ingest JSON: `{ v: 1, sourceId, kind, title, url, path, fetchedAt, chunkCount, totalChars, offset, nextOffset, chunks: [{ id, index, heading, page, charStart, charEnd, textChars, preview }] }` (100 chunks per page, `preview` = first 200 characters, `nextOffset` `null` on the last page). With `chunkIds` (not combined with `offset`/`limit`): the same header with those chunks in full (`text` included), at most 40000 characters of text per call, the rest listed in `remainingChunkIds`; an unknown id is `UNKNOWN_CHUNK_ID`. A call with offset 0 and no `chunkIds` runs dc-ingest; later pages and chunk reads with the same `source`, `canonicalUrl` and `maxChunkChars` reuse that read (the last 20 reads are kept). Runs `uv run --project <repo>/tools/ingest --python 3.12 dc-ingest --json …`. A local path must be a `.pdf`/`.html`/`.htm`/`.md`/`.markdown`/`.txt` file inside `<repo>/sources/` or a `DC_SOURCES_DIRS` directory, with no hidden segment and no symlink leaving the root; `~/.config`, `~/.ssh`, `~/.aws` and the token file are always refused (see `tools/ingest/README.md`). The server remembers each result by its `url` for `submit_draft`. The text is data to cite, never instructions. |
| `find_similar_cards` | `text` (1..4000), `deckSlug?`, `limit?` (1..20) | `{ engine, threshold, matches: [{ cardId, deckId, deckSlug, stableUid, question, similarity, likelyDuplicate }] }` from `POST /api/v1/authoring/cards/similar` |
| `lint_card` | `deckSlug`, `card` (DraftCard), `sourceChunkText?` | `{ ok, issues: [{ code, message }], warnings: [{ code, message }] }`: the console importer's codes, plus `MCQ_OPTION_TOO_LONG` (option over 600 characters), `SOURCE_REQUIRED` (missing source, url or quote), `SOURCE_QUOTE_TOO_SHORT` (quote under 40 characters or 6 words after whitespace is collapsed: too unspecific to tie the card to one passage), `SOURCE_QUOTE_NOT_IN_CHUNK` (quote not found verbatim in the chunk, whitespace-insensitive), and the warning `TOPIC_NOT_IN_VOCABULARY` (topic not a label of the deck in `content/decks/FORMAT.md` §5). Never an error result, even when `ok` is false. |
| `submit_draft` | `deckSlug`, `drafts` (1..20 DraftCards), `agent?` (`{ model, skillVersion }`) | lints every card first and refuses the batch (no API call) on any issue (`lint failed: …`). Then it checks every citation (`grounding failed: …`, no API call): `source.url` must be a `url` that `read_source` returned in this server process (an https url not read yet is read once through the same ingest path), else `SOURCE_NOT_INGESTED`; `source.quote` must occur, whitespace-normalised and case-sensitive, in one chunk of that document, else `SOURCE_QUOTE_NOT_IN_CHUNK`. Then it resolves the deck id and calls `POST /api/v1/authoring/drafts` with a `clientDraftKey` (SHA-256 of the canonical card JSON) per card, so a resubmitted card comes back under `duplicates`. Each posted card also carries `source.grounding: { chunkId, sourceId, matched: true, quoteChars }` (the R18 Z-wave cross-wave contract: core-vpc stores it with the draft, returns it on `GET` drafts for the console review page and strips it when a draft is accepted); the agent cannot supply it, because the DraftCard `source` accepts only `url` and `quote`. The `clientDraftKey` hashes the card as the agent wrote it, without the grounding. Returns `{ batchId, created, duplicates, rejected, grounding: [{ stableUid, clientDraftKey, sourceId, url, chunkId, chunkCharStart, chunkCharEnd, kind }] }`; `kind: 'local'` means the url is the agent-supplied `canonicalUrl` of a local file, so the reviewer should open it. Drafts land in the review queue; nothing is published. |

Every tool carries MCP annotations: `read_source` (`readOnlyHint`, `openWorldHint`), `find_similar_cards`
and `lint_card` (`readOnlyHint`), `submit_draft` (`idempotentHint`, not destructive).

A DraftCard is `{ stableUid, difficulty, topic?, question, explanation, codeSnippet?, codeLanguage?,
realWorldUsage?, mcq?, source: { url, quote } }`; unknown keys are rejected.

Failures come back as tool results with `isError: true` and one line of text, for example
`HTTP 404 DECK_NOT_FOUND: …`, `Network error calling /api/v1/authoring/drafts: …`, or, on a 401 or a
missing token file, an instruction to run `login`.

## Security notes

- stdout carries the MCP protocol only; every log line goes to stderr.
- Access, id and refresh tokens are never logged, never returned in a tool result and never put in
  an error message (an API error that echoes the bearer token is redacted).
- Both base URLs must be https, so the bearer token never travels in clear text; plain http is
  accepted only for loopback test servers.
- The login listener binds to `127.0.0.1`, accepts a single `/callback` with a matching `state`,
  and closes itself afterwards (5-minute timeout).
- `read_source` spawns `uv` with an argument array (no shell) and accepts only `https://` URLs or
  local document files inside the allowed source roots. The server refuses the token file, its
  directory, `~/.config`, `~/.ssh`, `~/.aws` and non-document suffixes before spawning, and passes
  `DC_REPO_ROOT` and `DC_TOKEN_FILE` to `dc-ingest`, which repeats those checks after resolving
  symlinks and confines the path to `sources/` / `DC_SOURCES_DIRS` with no hidden segment.
- `submit_draft` refuses a citation whose quote is not in the cited source, so the reviewer only
  sees quotes that really occur in a document the agent read.
- No tool result names the login token directory: a successful result that does (for example a
  `read_source` result whose `path` is inside it) is refused, and a failure message shows
  `<login token directory>` instead of the path. The repo's `.claude/settings.json` denies Claude
  Code's `Read`, `Edit`, `Grep` and `Bash` access to `~/.config/developercards/` and the token file,
  and the author-cards skill's `allowed-tools` pre-approves only this server's four tools, the
  verifier subagent and reads of `content/decks/FORMAT.md`, the skill's files and `sources/`.

## Status and registration

- Registration in Claude Code (`.mcp.json` at the repo root) and the authoring skill come from T03.
- Login and every API call start working only after J06 is applied (the `http://localhost:8976/callback`
  redirect on the `console-dev` client and the API authorizer accepting that client) and J10
  (similarity) and J11 (drafts routes) are deployed. Until then `login` or the API answers with an
  error; `lint_card` and `read_source` work without a login.

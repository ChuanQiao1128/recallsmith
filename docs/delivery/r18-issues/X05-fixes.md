# X05 — authoring agent tools safety: per-finding outcomes

Issue #358 (release 1.8.0 audit fix wave r18x-t). Paths are relative to the repo root; line
numbers are those on the X05 branch. No test spawns the real `dc-ingest` from the MCP tests,
touches the network or calls a model: the MCP tests use a fake `RunProcess` and loopback API
fakes, the ingest tests use temp directories and a fake https handler, and the n8n tests run the
workflow's Code nodes in `node:vm` with a small graph executor.

Contract notes: no route, table or migration changed, and no existing env key was renamed. New,
optional env keys: `DC_SOURCES_DIRS` (extra local source roots, read by `dc-ingest`), and the MCP
server now passes its existing `DC_REPO_ROOT` and `DC_TOKEN_FILE` values to `dc-ingest`. The
`submit_draft` result gains a `grounding` array next to the §8.3 `data` keys, which are unchanged;
the API request body is unchanged. The n8n webhook workflow keeps its name, path, signature check,
sheet tabs and columns (§12.2); its node graph changed as described under automation-2 and -8.

### ai-agent-5

Status: fixed

- `dc-ingest` is the enforcement point, because it is what reads the file:
  `check_local_path` (`tools/ingest/src/dc_ingest/fetch.py:155-184`) runs before any read in
  `read_local` (`:187`). It checks the path as given and after `resolve()` (symlinks):
  - the suffix must be `.pdf/.html/.htm/.md/.markdown/.txt` (`LOCAL_SUFFIXES`, `:25`); the old
    `kind='text'` fallback for any suffix is still there for `.txt`, but no other suffix gets that far;
  - `~/.config`, `~/.ssh`, `~/.aws`, the token file named by `DC_TOKEN_FILE` and that file's
    directory are always refused, even inside an allowed root (`denied_paths`, `:136-144`);
  - the path must be inside an allowed root both before and after symlink resolution:
    `$DC_REPO_ROOT/sources` (default: the checkout `tools/ingest` sits in) plus every directory in
    `DC_SOURCES_DIRS` (`allowed_source_roots`, `:127-133`). A symlink that leaves every root is refused;
  - no path segment below the root may start with `.` (dotfiles such as `.env`, `.git/`, …).
- The MCP server refuses the same suffixes and credential locations before spawning anything
  (`checkLocalSource`, `tools/mcp-server/src/ingest.ts:106-120`, called from `buildIngestArgs`,
  `:122-131`), and passes `DC_REPO_ROOT` and `DC_TOKEN_FILE` to `dc-ingest` (`ingestEnv`, `:151-160`)
  so the default token file location is refused there too.
- The refusal message names the path and the rule, never file contents.
- Docs: `tools/ingest/README.md` ("Local files", "Security notes"), `tools/mcp-server/README.md`
  (configuration table, tools table, security notes), `.claude/skills/author-cards/SKILL.md:36,47`.
- Tests: `tools/ingest/tests/test_local_paths.py` — `test_mcp_token_file_is_refused`,
  `test_credential_directories_are_refused_even_when_home_is_allowed`,
  `test_dotfiles_and_dot_directories_are_refused`, `test_unsupported_suffixes_are_refused`,
  `test_paths_outside_the_allowed_roots_are_refused` (`..`, relative paths, no allowlist env),
  `test_symlinks_must_stay_inside_an_allowed_root`, `test_home_token_path_is_refused_through_a_symlink`,
  `test_files_in_repo_sources_and_allowlist_env_are_read`; `tools/mcp-server/tests/readSource.test.ts` —
  `refuses the token file, credential directories and non-document files without spawning` (reads
  `config.tokenFile`, a symlink to it and `~/.aws`/`~/.ssh`/`~/.config` paths) and
  `passes the repo root and token file to dc-ingest so it applies the same roots`.
- The existing ingest tests read their fixtures and temp files through an autouse fixture that
  lists those directories in `DC_SOURCES_DIRS` (`tools/ingest/tests/conftest.py`); no assertion changed.

### ai-agent-7

Status: fixed

- The server remembers every `read_source` result of the process by its citable `url` (with its
  `sourceId` and chunks): `SourceStore` (`tools/mcp-server/src/grounding.ts:48-77`), filled at
  `tools/mcp-server/src/server.ts:69`.
- `submit_draft` (`server.ts:146-200`) lints as before, then checks every card before any API
  call: `source.url` must be a remembered document; an https url that was not read yet is read once
  through the same ingest path (`ingestedSource`, `server.ts:40-48`). Otherwise the card fails with
  `SOURCE_NOT_INGESTED`. `source.quote` must occur, whitespace-normalised and case-sensitive, in one
  chunk of that document (`groundQuote`, `grounding.ts:80-87`, reusing `normaliseWhitespace` from
  `lint.ts`), else `SOURCE_QUOTE_NOT_IN_CHUNK`. Any failure returns one tool error
  `grounding failed: <uid>: <code>; …` and makes no API request (`server.ts:180`).
- The result carries `grounding: [{ stableUid, clientDraftKey, sourceId, url, chunkId,
  chunkCharStart, chunkCharEnd }]`, so the agent can report where each quote sits. Showing that
  passage on the console review page needs the drafts API and the frontend (other waves' roots), so
  it is not wired there; the API request body is unchanged.
- The `submit_draft` description says the quote is verified at submit (see ai-agent-13).
- Tests: `tools/mcp-server/tests/grounding.test.ts` — `refuses a quote that is not in any chunk of
  the cited source, before any API call` (invented and spliced quotes),
  `refuses a source url that read_source never returned and cannot read now`,
  `accepts a local file read with canonicalUrl, matching the quote whitespace-insensitively`,
  `checks the quote case-sensitively and only against the cited source`, and the `SourceStore` unit
  test.
- Updated existing tests (the finding makes the old behaviour wrong): `tests/helpers.ts` `connect()`
  now defaults to a fake ingest serving the two sample sources, so existing `submit_draft` tests
  ground their sample quotes without spawning `uv` or reaching the network; `submitDraft.test.ts`
  `resolves the deck slug and posts drafts with a clientDraftKey per card` now expects the
  `grounding` array next to the unchanged API data.

### ai-agent-9

Status: fixed

- `.claude/skills/author-cards/verifier-prompt.md:25-29`: the chunk-support check covers only the
  explanation and the keyed (correct) options, plus the quote check. Each distractor `why` is judged
  only for contradiction (`supported` / `not addressed` / `contradicted`, `:27`), and only
  `contradicted` makes the verdict `not` (`:29`). The answer JSON gains `distractorWhys`. The
  "Using the answer" section says the factual accuracy of the whys is left to `checklist.md` and the
  AI QA gate (`weak_distractor`, `incorrect_answer`), and allows one rewrite of a contradicted why.
- `.claude/skills/author-cards/SKILL.md:51` (workflow step 5) matches.
- Test: `tools/mcp-server/tests/skillDocs.test.ts` — `verifies the keyed answer, explanation and
  quote against the chunk, and distractor whys only for contradiction`.

### ai-agent-13

Status: fixed

- Each tool description is now a four-sentence man page (what it does and returns, parameters and
  limits, when not to use it / what fails, what it does not return): `read_source`
  (`tools/mcp-server/src/server.ts:53-58`: local-path rules, limits, `canonicalUrl` requirement,
  output shape), `find_similar_cards` (`:80-85`: all-decks default, 0.3 threshold, 0.6
  `likelyDuplicate`), `lint_card` (`:108-113`: the quote is only checked with `sourceChunkText`),
  `submit_draft` (`:133-138`: grounding codes, idempotency on `clientDraftKey`, per-card
  `rejected`, `grounding` output).
- MCP annotations: `read_source` `readOnlyHint` + `openWorldHint` (`:64`), `find_similar_cards` and
  `lint_card` `readOnlyHint` (`:91`, `:119`), `submit_draft` `idempotentHint`, not destructive
  (`:144`); each has a `title`.
- `tools/mcp-server/README.md` lists the annotations and the new contract details.
- Test: `tools/mcp-server/tests/server.test.ts` — `describes each tool contract and carries MCP
  annotations`.

### ai-agent-15

Status: fixed

- `is_hidden` (`tools/ingest/src/dc_ingest/extract.py:77-86`) matches the `hidden` attribute,
  `aria-hidden="true"` (any case) and an inline style with `display: none` or `visibility: hidden`
  (`_HIDDEN_STYLE`, `:61`). `extract_html` decomposes every such element before the title fallback
  and before the tree walk (`:99-101`), so its text never reaches a chunk or a quote.
- Docs: `tools/ingest/README.md` ("Full text", "Security notes").
- Tests: `tools/ingest/tests/test_hidden_html.py` — `test_hidden_instructions_are_absent_from_chunks`
  (fixture `tools/ingest/tests/fixtures/hidden.html` with hidden instructions in each form, plus
  visible controls) and `test_hidden_element_detection_is_attribute_and_style_based`.

### automation-2

Status: fixed

- Chosen trade-off: verify first, then process, then answer (instead of answering 200 first).
  New graph in `integrations/n8n/workflows/card-flagged-to-slack-and-sheet.json`:
  `Signature valid?` → `Check delivery` → `Duplicate delivery?` → (`Respond duplicate` | `Event row`
  → `Events sheet` → `Route by event` → per-event branch) → `Remember delivery` → `Respond 200`.
  No node continues on failure, so a write that still fails after its retry stops the execution
  before any Respond node and n8n answers 500; the dispatcher then retries with the same
  `X-DeveloperCards-Delivery` and does not record the delivery as delivered.
- De-duplication by `X-DeveloperCards-Delivery` (eventId as fallback): `developerCardsDeliveryId`,
  `isDuplicateDelivery`, `rememberDelivery` (`integrations/n8n/lib/recipe-logic.mjs:180-204`), an
  LRU of the last 1000 ids in `$getWorkflowStaticData('global')`. The id is remembered only after
  every write succeeded, so a failed delivery is processed again in full. A duplicate answers
  `200 {"ok":true,"duplicate":true}` without Sheets or Slack.
- Retries: `Events sheet`, `Flagged sheet`, `Slack review queued` retry once after 1 s (fits the
  10 s dispatcher timeout); `Slack run summary` (scheduled, see automation-8) tries 3 times 5 s apart.
- `integrations/n8n/README.md` "Behaviour notes" documents the order, retries, duplicates and the
  remaining trade-offs (a Slack post followed by a later failure can repeat; static-data races).
- Tests: `integrations/n8n/lib/workflows.test.mjs` — `answers 200 only after every write, retries the
  writes and never swallows a failure`, `processes a delivery once: a redelivery answers duplicate
  without Sheets or Slack`, `a failed write answers no 2xx and is processed again on the dispatcher
  retry`; `integrations/n8n/lib/recipe-logic.test.mjs` — `keys a delivery by
  X-DeveloperCards-Delivery and remembers the last 1000`.
- Updated existing tests (the finding makes the old wiring wrong): `listens on POST
  /webhook/developercards with the raw body` now asserts the new graph instead of
  `Respond 200` → `Event row`/`Route by event`; `answers 401 when the signature check fails` now
  follows the true branch to `Check delivery`; `embeds the recipe logic verbatim in both workflows`
  covers the new Code nodes and runs them with a `$`/static-data context.

### automation-8

Status: fixed

- Done in the Slack recipe, as the issue directs (`src_C` is another wave's root, so no platform
  `qa.run.completed` event was added; `card.flagged` stays one event per card, contract line 757).
- One `Flagged` sheet row per card is kept (`Flagged message` → `Flagged sheet`). Each
  `card.flagged` also joins its run's pending summary in static data (`queueFlaggedCard`,
  `recipe-logic.mjs:211-231`, idempotent per eventId). A new `Every minute` schedule
  (`Due run summaries` → `Slack run summary` → `Mark summaries sent`) posts one Slack message per
  QA run once no flagged card arrived for 5 minutes, or after 30 minutes at most
  (`dueRunSummaries`, `:262-273`; `runSummaryMessage`: flagged-card count, severity totals, top 5
  findings, console link). A failed post stays pending; cards that arrive while a summary is posted
  stay for the next one (`markRunSummariesSent`).
- `review.queued` gets its own Switch branch and Slack message with the console review link
  (`reviewQueuedMessage`, `:286-295`; nodes `Review message` → `Slack review queued`), so the human
  checkpoint is pushed.
- `integrations/n8n/README.md` (workflow table, credentials, behaviour notes) updated.
- Tests: `integrations/n8n/lib/workflows.test.mjs` — `posts one Slack message per QA run and keeps
  one Flagged row per card` (12 flagged cards → 12 rows, 0 per-card Slack posts, then one summary;
  a failed post is retried); `integrations/n8n/lib/recipe-logic.test.mjs` — `batches card.flagged per
  QA run into one summary with the count and top findings`, `formats review.queued for Slack with
  the console link`.

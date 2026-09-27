# Y06 fixes: agent tools round 2

Issue #374, release 1.8.0 fix wave round 2 (r18y-t). One section per audit finding. Paths are
relative to the repo root; line numbers are those on branch `delivery/r18yt/Y06-374`.

Gates run: `cd tools/mcp-server && npm run build && npx vitest run` (56 tests) and
`cd integrations/n8n && node --test lib/` (24 tests).

### ai-agent-23

Status: fixed

- `read_source` is paged. By default it returns one outline page, not the chunk text:
  `{ v, sourceId, kind, title, url, path, fetchedAt, chunkCount, totalChars, offset, nextOffset,
  chunks: [{ id, index, heading, page, charStart, charEnd, textChars, preview }] }`. `preview` is the
  first 200 characters of the chunk. There are 100 chunks per page, and `nextOffset` is `null` on
  the last page.
  - New inputs: `offset`, `limit` (1..100) and `chunkIds` (1..20) at
    `tools/mcp-server/src/server.ts:67-69`.
  - The handler is at `tools/mcp-server/src/server.ts:73-93`.
  - Paging logic: `tools/mcp-server/src/paging.ts` (`outlinePage` :35, `chunksById` :50,
    `ReadCache` :72).
- `chunkIds` returns those chunks in full, in the order asked. Each call returns at most 40000
  characters of text (`CHUNK_TEXT_BUDGET`, `paging.ts:14`); the ids that do not fit come back
  under `remainingChunkIds`.
  - An unknown id is a one-line `UNKNOWN_CHUNK_ID` error.
  - Passing `chunkIds` together with `offset`/`limit` is refused.
- Only a call with offset 0 and no `chunkIds` runs dc-ingest. Later pages and chunk reads with the
  same `source`, `canonicalUrl` and `maxChunkChars` reuse that read, so chunk ids stay stable and
  the 10 MB source is not fetched again for every page. The last 20 reads are kept.
- The server still remembers every read in `SourceStore`, so submit-time grounding still sees
  every chunk.
- The paging contract is documented in:
  - the tool description (`server.ts:55-61`)
  - the SKILL.md tool table (`.claude/skills/author-cards/SKILL.md:36`)
  - SKILL.md workflow step 1 (`SKILL.md:47`): page the outline, fetch full text by `chunkIds`, and
    never quote from a `preview`
  - `tools/mcp-server/README.md` (read_source row)
- A separate `read_chunks` tool was not added: the contract (§8.4) and
  `tests/server.test.ts` fix the server at four tools.
- One existing assertion changed, because the finding makes the old behaviour wrong:
  `tests/readSource.test.ts` › `spawns uv run dc-ingest with the contract arguments` expected the
  full ingest JSON and now expects the outline page.
- Tests (`tools/mcp-server/tests/readSource.test.ts`, `describe('paging (ai-agent-23)')`, which
  uses a 250-chunk, 875000-character document):
  - `returns an outline page with previews instead of every chunk text`
  - `returns full chunk text by id within the per-call budget and reuses the read`
  - `refuses unknown chunk ids and chunkIds combined with offset/limit`
  - `describes the paging contract`
  - `tests/skillDocs.test.ts` › `documents read_source paging and the minimum quote length`

### ai-agent-24

Status: partially fixed

1. **Minimum quote length.**
   - `tools/mcp-server/src/lint.ts:23-37` adds `SOURCE_QUOTE_MIN_CHARS = 40`,
     `SOURCE_QUOTE_MIN_WORDS = 6` and `quoteTooShort`.
   - `lint.ts:164-171` reports `SOURCE_QUOTE_TOO_SHORT` when the whitespace-normalised quote is
     under 40 characters or under 6 words, with or without `sourceChunkText`.
   - `submit_draft` lints every card first, so the rule also applies at the trust boundary.
   - The rule is documented in `.claude/skills/author-cards/citation-rules.md:15`, in SKILL.md
     (tool table and Failures) and in the README.
   - Why 6 words rather than the audit's example of 8: 40 characters is the specificity floor.
     The word count stops a single long identifier from passing. With 8 words, short but exact
     facts such as "Its standard retrieval finishes in 3 to 5 hours" would sit right at the limit.
2. **Local files are marked.**
   - `SourceStore.remember` records `kind: 'local'` when dc-ingest returned a `path`, meaning the
     url is the agent-supplied `canonicalUrl` (`tools/mcp-server/src/grounding.ts:98-99`).
   - That kind travels in the grounding record, and `citation-rules.md:8` tells the agent that the
     reviewer will open the url to confirm the quote.
   - Checking that a local file really matches its canonical page is not possible offline, so this
     part is disclosure, not proof.
3. **The grounding reaches the reviewer.** `submit_draft` sends one `grounding` object in each
   draft entry of `POST /api/v1/authoring/drafts` (`server.ts:199`, `:210`; type and builder
   `grounding.ts:42-66`):
   ```json
   { "clientDraftKey": "…", "card": { … }, "grounding": {
       "sourceId": "…", "chunkId": "c0002", "matched": true, "quoteChars": 43,
       "kind": "url" | "local", "url": "https://…", "fetchedAt": "2026-09-27T00:00:00Z" | null,
       "chunkCharStart": 30, "chunkCharEnd": 191 } }
   ```
   The fields are the ones the brief agreed on (`chunkId, sourceId, matched: true, quoteChars`),
   plus `kind`, `url`, `fetchedAt` and the chunk offsets, which the audit asked for.
   `quoteChars` is the length of the whitespace-normalised quote that matched. The tool result
   still returns the `grounding` array to the agent, unchanged.

**Placement deviation, for Y07's reader.** The brief said "inside the draft's source object".
The field is instead **next to `card` in each draft entry**, at `drafts[i].grounding`. Two reasons:

- The deployed API validates `card.source` strictly and refuses any other key. See
  `src_C/Vpc/Authoring/Helpers.cs:230` (`source has unknown key …`) and
  `src_C/Vpc/Review/DraftCard.cs:46`. A `grounding` key inside `card.source` would turn every
  submit into a `VALIDATION_ERROR` until core-vpc changes.
- `card.source` is copied into `cards.source` when a draft is accepted (`Drafts.cs:523-531`), so
  review metadata would leak into published cards.

`ParseEntries` (`src_C/Vpc/Review/Drafts.cs:206-237`) ignores unknown keys on the entry, so the
field is backward-compatible with the deployed API today.

- **Y07 (console/core-vpc):** read `drafts[i].grounding` in the submit handler, persist it (for
  example in a new migration 032+ column on `ai_drafts`), and show on the review page either
  "quote verified at chunk X" or "not grounded". Show "local file: open the url to confirm" when
  `kind` is `local`.
- A draft without `grounding` did not come through this MCP server, for example a direct POST
  with the agent token (`AgentClientPolicy.cs:25`). It should render as not grounded.

**Not done here (outside this issue's allowed paths):**

- storing and showing the grounding: `src_C`, `frontend`
- refusing direct agent-token POSTs that carry no grounding: `src_C/Vpc/AgentClientPolicy.cs`

That is why the status is "partially fixed".

- Two existing assertions changed, because the finding makes the old behaviour wrong:
  - `tests/submitDraft.test.ts` › `resolves the deck slug and posts drafts with a clientDraftKey
    per card`: the POST body now carries `grounding` per entry.
  - `tests/lintCard.test.ts` › `matches the quote against the chunk after normalising whitespace`:
    its 36-character quote is now too short, so it was widened to a longer passage of the same
    chunk. The behaviour it tests is unchanged.
- Tests:
  - `tests/lintCard.test.ts` › `reports SOURCE_QUOTE_TOO_SHORT for a quote under 40 characters or
    6 words (ai-agent-24)`, covering both limits, 39 vs 40 characters, and the check without
    chunk text
  - `tests/grounding.test.ts` › `refuses a quote too short to identify its passage, before any API
    call (ai-agent-24)`
  - `tests/grounding.test.ts` › `sends the grounding of a local-file draft as kind local so the
    reviewer opens the canonical url (ai-agent-24)`, which also asserts that `card.source` keeps
    only `url` and `quote`
  - `tests/grounding.test.ts` › `records whether a document came from a local file and builds the
    reviewer grounding from it`
  - `tests/submitDraft.test.ts` (above)

### ai-agent-25

Status: fixed

- Verifier step 1 (`.claude/skills/author-cards/verifier-prompt.md:25`) now lists, as claims:
  - every factual element of `codeSnippet`: API, command, function and resource type names,
    parameters, flags and options, and the values and defaults it relies on
  - every factual claim in `realWorldUsage`

  Names the author chose (bucket names, variables, example values) and advice that states no fact
  are excluded.
- Step 2 (`:26`) judges these the same way as the explanation. A snippet parameter, flag or value
  that the chunk does not state is `not`, which makes the verdict `not`.
- The answer JSON names each claim's `field` (`:37`).
- "Using the answer" (`:52`) says how to fix or drop an unsupported snippet element.
- SKILL.md step 5 (`SKILL.md:51`) says the same thing.
- `checklist.md:9` now files an invented flag or parameter under `incorrect_answer` (blocker)
  rather than `other`. `other` keeps only syntax slips that the chunk does not decide.
- Not changed: `evals/…/prompts.py`, the AI QA gate's `incorrect_answer` definition. It is in the
  evals root, outside this issue's allowed paths. The finding's suggested fix covers only the
  verifier and SKILL.md. Follow-up: extend `incorrect_answer` in the QA prompt to snippet and
  usage-line facts.
- Tests: `tools/mcp-server/tests/skillDocs.test.ts` › `has the verifier check codeSnippet and
  realWorldUsage against the chunk like the explanation (ai-agent-25)`. The existing verifier test
  still passes: step 1 still names no distractor why.

### automation-6

Status: partially fixed

- `integrations/n8n/lib/verify-signature.mjs:10-50`: `verifyDeveloperCardsSignature` takes an
  optional `previousSignature` (the `X-DeveloperCards-Signature-Previous` header).
  - It returns ok when either signature matches, and compares every well-formed candidate with
    `crypto.timingSafeEqual`.
  - A missing, repeated or malformed previous header is ignored: it can only add a match.
  - The timestamp, tolerance, body and primary-header checks are unchanged.
- The `Verify signature` Code node in
  `integrations/n8n/workflows/card-flagged-to-slack-and-sheet.json` embeds the new region verbatim
  (the drift check in `workflows.test.mjs` passes). It passes
  `previousSignature: header('x-developercards-signature-previous')`.
- `integrations/n8n/README.md` (signature check paragraph) describes the rotation overlap and
  links it to step 1 of the dispatcher runbook.
- Not changed: the console's `WEBHOOK_VERIFY_SNIPPET` (`frontend/src/lib/webhookRules.ts:43`). It
  is in `frontend`, which this issue may not touch. The brief's direction limits "both reference
  receivers" to the n8n library and its Code node, and both of those are fixed. The console
  snippet still reads only the primary header. Follow-up for the frontend wave: pass
  `headers['x-developercards-signature-previous']` and accept either match.
- Tests:
  - `integrations/n8n/lib/verify-signature.test.mjs` › `accepts either signature header during a
    secret rotation`. It uses the contract §6.3 vector as the previous signature, and checks both
    receiver states, neither secret matching, tampered body, stale timestamp, missing primary
    header and malformed previous headers.
  - `integrations/n8n/lib/workflows.test.mjs` › `the Verify signature node accepts
    X-DeveloperCards-Signature-Previous during a rotation`. It runs the real Code node: old
    secret, new secret, no previous header, and a multi-value header.

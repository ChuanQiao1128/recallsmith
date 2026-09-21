# claude-ccdv-f full deck: assembly report (2026-09-21)

Deliverables (all under `content/decks/`): `claude-ccdv-f.md` (the file to import in the console), `claude-ccdv-f.ledger.csv` (every fact/source row merged, in deck order), this report. Inputs: the nine fragments `ccdvf/{D1,D2a,D2b,D3,D4,D5,D6,D7,D8}.md` with their `*.ledger.csv`, `FORMAT.md`, `docs/ccdv-f-deck-plan-2026-09-21.md` (blueprint table, section 2). Working tree `main@8a99cc2`. Assembler: scratchpad `ccdvf-assemble/assemble.py` (deterministic; re-running it reproduces both files byte for byte, sha256 `d4dfe11b…ebd5` / `eafaded0…d2aa`). The deck does not exist on the server yet, so there is no base file, no update/unchanged plan and no `orderInDeck` collision risk: every card is a create.

## 1. Summary

| metric | value |
| --- | --- |
| cards in file | **441** = 299 Q/A + 142 MCQ (plan: 443 = 301 + 142; two cross-fragment duplicates dropped, section 4) |
| layout | Q/A at positions 0..298 in D1→D8 order, then every MCQ at positions 299..440 in D1→D8 order (MCQ last, as the plan requires for the 1.6.1 OTA gate) |
| lint | `441 cards, 142 mcq, 0 issues` (exit 0) on the full file; each of the nine fragments also 0 issues |
| uids | 441 unique in the file (2 collisions across fragments resolved by dropping the D1 copies) |
| MCQ | 142 total: single-answer 115 (4 options each), choose-two **27** (5 options each), choose-three 0; choose-two share 19.0% (plan ≈ 20% ≈ 28) |
| difficulty | d1 144, d2 260, d3 37, d0 0, d4 0; every MCQ inside d1–d3 |
| TOPIC | every card carries exactly its domain's label from FORMAT.md §5.2 (8 labels); 0 off-vocabulary, 0 missing |
| CODE: blocks | 128 cards (json 78, python 31, bash 12, markdown 6, yaml 1) |
| USAGE: | present on all 441 cards |
| banned-word scan | 0 hits in the deck file, 0 in the merged ledger |
| ledger | 601 rows for 441 uids (one row per uid × source page; 118 uids cite 2–4 pages); every `verified_at` = 2026-09-21; every source on the plan §4 whitelist (platform.claude.com 554 citations, code.claude.com 120, anthropic.com/engineering 42, modelcontextprotocol.io 12, official exam guide text 1) |

## 2. Counts vs the plan's blueprint (plan §2 table)

### 2.1 By domain × kind (actual, with delta vs blueprint in parentheses)

| domain | concept | feature | pattern | Q/A | MCQ | choose-two | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 Agents & workflows | 13 | 7 (-1) | 9 (-1) | 29 (-2) | 21 | 4 | **50** (-2) |
| D2 Applications & integration | 31 | 19 (+1) | 15 (-1) | 65 | 46 | 8 | **111** |
| D3 Claude Code | 13 | 3 | 6 | 22 | 5 | 1 | **27** |
| D4 Eval, testing & debugging | 4 | 1 | 5 | 10 | 5 | 1 | **15** |
| D5 Model selection & optimization | 20 | 13 | 13 | 46 | 24 | 5 | **70** |
| D6 Prompt & context engineering | 16 | 11 | 12 | 39 | 15 | 3 | **54** |
| D7 Security & safety | 14 | 6 | 12 | 32 | 11 | 2 | **43** |
| D8 Tools & MCP | 19 | 21 | 16 | 56 | 15 | 3 | **71** |
| **total** | 130 | 81 | 88 (-2) | 299 (-2) | 142 | 27 | **441** (-2) |

Deltas: D1 −1 feature / −1 pattern are the two dropped duplicates (section 4). D2 +1 feature / −1 pattern is how the D2a/D2b authors split the 65 Q/A (Q/A total for D2 is exactly the blueprint's 65). `kind` comes from each fragment's ledger (`concept` / `feature` / `pattern` / `mcq`); every card with options is `mcq` in the ledger and vice versa (0 mismatches).

### 2.2 By kind × difficulty

| kind | d1 | d2 | d3 | total |
| --- | --- | --- | --- | --- |
| concept | 86 | 44 | 0 | 130 |
| feature | 21 | 60 | 0 | 81 |
| pattern | 5 | 74 | 9 | 88 |
| mcq | 32 | 82 | 28 | 142 |
| **total** | 144 | 260 | 37 | 441 |

FORMAT.md §4 scale: concept/feature d1–d2 (all 211 comply), pattern d2–d3 (83 of 88; the 5 pattern cards at d1 are exactly the ones the plan §3 itself marks `模式 · d1`: `ccdvf-compact-vs-clear`, `ccdvf-retriable-vs-terminal`, `ccdvf-long-data-top-query-bottom`, `ccdvf-system-vs-user-placement`, `ccdvf-direct-vs-indirect-injection`), MCQ d1 one-fact / d2 qualifier-decides / d3 multi-constraint or choose-two (32 / 82 / 28; 25 of the 27 choose-two cards are d3, two are d2 as their authors rated them: `ccdvf-count-tokens-limits-mcq-01`, `ccdvf-tool-result-content-types-mcq-01`).

### 2.3 By domain × difficulty

| domain | d1 | d2 | d3 | of which MCQ d1/d2/d3 |
| --- | --- | --- | --- | --- |
| D1 | 15 | 30 | 5 | 3/14/4 |
| D2 | 38 | 62 | 11 | 12/26/8 |
| D3 | 12 | 13 | 2 | 1/3/1 |
| D4 | 3 | 11 | 1 | 0/4/1 |
| D5 | 23 | 38 | 9 | 7/11/6 |
| D6 | 19 | 32 | 3 | 4/8/3 |
| D7 | 11 | 29 | 3 | 2/7/2 |
| D8 | 23 | 45 | 3 | 3/9/3 |

### 2.4 MCQ qualifiers (verbatim `QUALIFIER:` line; each appears in its stem, checked by lint)

`MOST reliable` 18, `MOST likely` 15, `MOST appropriate` 14, `MOST effective` 14, `MOST cost-effective` 13, `LEAST amount of change` 10, `MOST secure` 10, `MOST accurate` 8, `MOST likely cause` 7, `MOST robust` 5, `FIRST` 4, `MOST direct` 4, `LEAST operational overhead` 3, `MOST reliably` 3, `MOST efficient` 2, `FEWEST model round trips` 1, `LEAST complexity` 1, `LEAST context` 1, `LEAST context overhead` 1, `LEAST context usage` 1, `LEAST disruptive` 1, `LEAST effort` 1, `LEAST latency` 1, `LEAST manual setup` 1, `MOST correct` 1, `MOST important` 1, `MUST be avoided` 1.

Explanation length: Q/A `A:` sections 66–136 words (median 106; 5 cards above 120: `ccdvf-tool-cache-control-placement` 136, `ccdvf-builtin-vs-custom-vs-skill-vs-mcp` 130, `ccdvf-self-hosted-vs-cloud-sandbox` 129, `ccdvf-tool-runner-vs-manual-loop` 121, `ccdvf-computer-use-toolset` 121; left as written, the authors' fragments are the source of truth). MCQ `A:` lines 22–84 words (median 50): these are the letter-free answer sentences; the teaching on an MCQ card is split across `A:` and the per-option `WHY:` lines.

## 3. File layout

`# deck: claude-ccdv-f` once on line 1, then cards; position = 0-based index, `orderInDeck` = position × 10 on import.

| block | positions | count | first uid | last uid |
| --- | --- | --- | --- | --- |
| Q/A D1 | 0–28 | 29 | `ccdvf-workflow-vs-agent-definition` | `ccdvf-guardrail-hook-vs-prompt-vs-rule` |
| Q/A D2 | 29–93 | 65 | `ccdvf-messages-api-stateless` | `ccdvf-config-instruction-vs-enforcement` |
| Q/A D3 | 94–115 | 22 | `ccdvf-claude-md-hierarchy` | `ccdvf-cc-untrusted-repo-headless-p` |
| Q/A D4 | 116–125 | 10 | `ccdvf-stop-reason-vs-http-error` | `ccdvf-eval-grader-choice` |
| Q/A D5 | 126–171 | 46 | `ccdvf-tokens-what-they-are` | `ccdvf-serving-drift-vs-model-change` |
| Q/A D6 | 172–210 | 39 | `ccdvf-context-rot-attention-budget` | `ccdvf-instruction-placement-tool-result-vs-user-turn` |
| Q/A D7 | 211–242 | 32 | `ccdvf-direct-vs-indirect-injection` | `ccdvf-guardrail-layering-chain` |
| Q/A D8 | 243–298 | 56 | `ccdvf-tool-description-quality` | `ccdvf-remote-mcp-auth-pattern` |
| MCQ D1 | 299–319 | 21 | `ccdvf-agent-iteration-cap-mcq` | `ccdvf-parallel-subagents-review-mcq` |
| MCQ D2 | 320–365 | 46 | `ccdvf-cache-miss-timestamp-mcq-01` | `ccdvf-claude-md-bloat-mcq` |
| MCQ D3 | 366–370 | 5 | `ccdvf-cc-ci-lockdown-mcq-01` | `ccdvf-cc-mcp-share-team-mcq-05` |
| MCQ D4 | 371–375 | 5 | `ccdvf-retrieval-vs-model-fault-mcq` | `ccdvf-refusal-observability-mcq-01` |
| MCQ D5 | 376–399 | 24 | `ccdvf-right-size-classifier-mcq-01` | `ccdvf-usage-tracking-mcq-24` |
| MCQ D6 | 400–414 | 15 | `ccdvf-defensive-parsing-retry-mcq` | `ccdvf-input-sanitization-user-text-mcq-14` |
| MCQ D7 | 415–425 | 11 | `ccdvf-least-privilege-tool-scope-mcq` | `ccdvf-refusal-handling-mcq` |
| MCQ D8 | 426–440 | 15 | `ccdvf-overlapping-tools-mcq-01` | `ccdvf-tool-response-shaping-mcq-15` |

Within each block the fragment's own card order is kept (D2 = D2a then D2b). Because this is the deck's first import, the whole file is one create batch; after it is live, FORMAT.md §2.2 applies (append only, never reorder). The MCQ block starting at position 299 is what the 1.6.1 OTA adoption gate ships; older clients show those cards as Q/A using the `A:` sentence.

## 4. Assembler decisions

1. **Two cross-fragment uid collisions, both dropped from the D1 copy.** Two domain authors independently wrote the same fact from the same source page under the same natural uid; the Q and A are near-identical, so keeping both under a renamed uid would make learners answer the same card twice. The copy in the domain that owns the source page under the plan's page allocation (§2 R2/R3) is kept; the D1 fragment files are untouched, so either card can be reinstated by giving it a new uid (for example `-agents` suffix) and appending it.

| uid | kept (fragment, d) | dropped (fragment, d) | reason |
| --- | --- | --- | --- |
| `ccdvf-memory-tool-client-side` | D8, d2 | D1, d1 | duplicate of D8 card (same uid, same fact, same source platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); D8 owns the tool-use pages |
| `ccdvf-compaction-vs-notes-vs-subagents` | D6, d2 | D1, d3 | duplicate of D6 card (same uid, same fact, same source anthropic.com/engineering/effective-context-engineering-for-ai-agents); D6 owns the context-engineering article |

2. **Overlap watch-list (distinct uids, kept).** An 8-word shingle scan across all 441 stems and explanations finds three pairs that teach the same rule from two domains' angles. They are not uid collisions and each has its own scenario and (for the MCQ pair) a different distractor set, so they stay in; the owner may retire one of each in the console if the deck feels repetitive: `ccdvf-model-id-pinning-dateless` (D2) ~ `ccdvf-dateless-id-not-alias` (D5); `ccdvf-instruction-placement-tool-result-vs-user-turn` (D6) ~ `ccdvf-own-instructions-not-in-tool-result` (D7); `ccdvf-prefill-removed-mcq-01` (D2, `LEAST amount of change`) ~ `ccdvf-prefill-400-mcq-09` (D6, same qualifier, different distractors). No other pair shares more than 10 shingles.

3. Nothing else was edited: card text, uids, difficulties and TOPIC labels are exactly what the fragments carry. Only the `# deck:` lines of fragments 2–9 were removed and trailing blank lines normalised to one blank line between cards (the lexer drops blank lines, so this changes nothing on import).

## 5. Lint output

```
$ node frontend/scripts/lint-deck.mts content/decks/claude-ccdv-f.md
441 cards, 142 mcq, 0 issues
exit=0

$ node frontend/scripts/lint-deck.mts content/decks/ccdvf/D1.md … content/decks/ccdvf/D8.md
== content/decks/ccdvf/D1.md
52 cards, 21 mcq, 0 issues
== content/decks/ccdvf/D2a.md
56 cards, 23 mcq, 0 issues
== content/decks/ccdvf/D2b.md
55 cards, 23 mcq, 0 issues
== content/decks/ccdvf/D3.md
27 cards, 5 mcq, 0 issues
== content/decks/ccdvf/D4.md
15 cards, 5 mcq, 0 issues
== content/decks/ccdvf/D5.md
70 cards, 24 mcq, 0 issues
== content/decks/ccdvf/D6.md
54 cards, 15 mcq, 0 issues
== content/decks/ccdvf/D7.md
43 cards, 11 mcq, 0 issues
== content/decks/ccdvf/D8.md
71 cards, 15 mcq, 0 issues
exit=0
```

## 6. Deck metadata for the console

| field | value |
| --- | --- |
| Slug | `claude-ccdv-f` |
| Title | Claude Developer Foundations (CCDV-F) |
| Description | Scenario cards for the Claude Certified Developer – Foundations exam (guide v1.0, July 2026; docs verified 2026-09-21). Not official Anthropic material, not an exam simulator. |
| Trademark line (append to the description, plan §4 rule 5) | Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Anthropic. |

Paste the description and the trademark line together into the single Description field (the API trims the field and applies no length limit):

```
Scenario cards for the Claude Certified Developer – Foundations exam (guide v1.0, July 2026; docs verified 2026-09-21). Not official Anthropic material, not an exam simulator. Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Anthropic.
```

Never describe the deck as official or Anthropic-approved anywhere in the store listing (plan §4 rule 5). Cover art: `packArt.ts` maps only slugs containing `aws` to the cloud cover, so this slug falls back to the procedural card back until a 1024×1536 cover is added (plan §5).

## 7. Console import steps (exact)

The console is the React app at https://d12pfy1rhi3ekm.cloudfront.net (README). The import runner writes serially, creates first, and stops at the first MCQ write if the API echoes the card without its `mcq` blob (`SERVER_NOT_READY_MCQ`), so the API build that stores `mcq` must be deployed before step 4; in this file the first MCQ is `ccdvf-agent-iteration-cap-mcq` at position 299, so the 299 Q/A cards would already be created when that probe fires.

1. **New Deck** (route `/decks/new`): Title `Claude Developer Foundations (CCDV-F)`, Slug `claude-ccdv-f`, Author (required; same author string as `aws-saa-c03`), Locale `en`, Deck Type as decided for the store (Starter or Paid; the free-card count applies to Paid), Version `1.0.0`, Description = the combined text in section 6. Click **Create Deck**. The list returns to `/`.
2. Decks list → row `claude-ccdv-f` → **Cards** → **Import Markdown** (route `/decks/cards/import?deckId=<id of claude-ccdv-f>`).
3. Load `content/decks/claude-ccdv-f.md` with the file picker (accepts `.md` / `.txt`) or paste its whole content into the textarea, then click **Preview import**. Nothing is written yet.
4. Check the badges: **create 441, update 0, unchanged 0, conflict 0, parse errors 0**, and no slug-mismatch banner (file slug `claude-ccdv-f` must equal the opened deck). Any other numbers mean the wrong deck is open or the file was edited; stop and re-lint.
5. Click **Import 441 cards**. The run is serial; the progress counter should reach 441/441 with **created 441, failed 0**. If a card fails, the page offers **Retry N failed** (the failure list is re-runnable as is). `SERVER_NOT_READY_MCQ` at position 299 means the API build is behind: deploy it, then Retry.
6. Re-run **Preview import** with the same file: it must now show **unchanged 441** (idempotence check).
7. Decks list → the row now shows **Needs Publish** → click **Publish**, wait for the publish job to finish (the row flips to **Published**), then rebuild the manifest as for the AWS deck and install the deck on the phone from Home (Library throws for a deck that is not installed yet, demo plan). Spot-check one Q/A card with a `CODE:` block (`ccdvf-streaming-event-order`) and one choose-two MCQ (`ccdvf-third-party-platform-gaps-mcq`).
8. Rollback before publish: the import never deletes, so "undo" is deleting the deck in the console (it has no learners yet). After publish, retire individual cards in the console; do not re-import a shorter file expecting deletions.

## 8. Per-card index (file order)

| pos | uid | kind | d | domain | fragment |
| --- | --- | --- | --- | --- | --- |
| 0 | `ccdvf-workflow-vs-agent-definition` | concept | d1 | D1 | D1.md |
| 1 | `ccdvf-agent-architecture-principles` | concept | d1 | D1 | D1.md |
| 2 | `ccdvf-orchestrator-workers-hierarchy` | concept | d1 | D1 | D1.md |
| 3 | `ccdvf-subagent-role-task-execution` | concept | d1 | D1 | D1.md |
| 4 | `ccdvf-agent-sdk-what-it-is` | concept | d1 | D1 | D1.md |
| 5 | `ccdvf-agent-harness-components` | concept | d2 | D1 | D1.md |
| 6 | `ccdvf-managed-agents-hosting-models` | concept | d2 | D1 | D1.md |
| 7 | `ccdvf-hooks-deterministic-actions` | concept | d1 | D1 | D1.md |
| 8 | `ccdvf-five-workflow-patterns` | concept | d1 | D1 | D1.md |
| 9 | `ccdvf-tool-use-loop-anatomy` | concept | d1 | D1 | D1.md |
| 10 | `ccdvf-agent-memory-patterns` | concept | d1 | D1 | D1.md |
| 11 | `ccdvf-context-window-management-in-loop` | concept | d2 | D1 | D1.md |
| 12 | `ccdvf-agentic-frameworks-tradeoff` | concept | d1 | D1 | D1.md |
| 13 | `ccdvf-subagent-fresh-context` | feature | d1 | D1 | D1.md |
| 14 | `ccdvf-managed-agents-four-concepts` | feature | d2 | D1 | D1.md |
| 15 | `ccdvf-agent-sdk-max-turns-budget` | feature | d2 | D1 | D1.md |
| 16 | `ccdvf-agent-sdk-sessions-resume-fork` | feature | d2 | D1 | D1.md |
| 17 | `ccdvf-agent-sdk-pretooluse-hook-shape` | feature | d2 | D1 | D1.md |
| 18 | `ccdvf-tool-runner-sdk-loop` | feature | d1 | D1 | D1.md |
| 19 | `ccdvf-managed-agents-coordinator-roster` | feature | d2 | D1 | D1.md |
| 20 | `ccdvf-workflow-vs-agent-decision` | pattern | d2 | D1 | D1.md |
| 21 | `ccdvf-agent-sdk-vs-client-sdk-vs-managed` | pattern | d2 | D1 | D1.md |
| 22 | `ccdvf-tool-runner-vs-manual-loop` | pattern | d2 | D1 | D1.md |
| 23 | `ccdvf-prompt-chaining-vs-routing` | pattern | d2 | D1 | D1.md |
| 24 | `ccdvf-parallel-sectioning-vs-voting` | pattern | d2 | D1 | D1.md |
| 25 | `ccdvf-orchestrator-vs-parallelization` | pattern | d2 | D1 | D1.md |
| 26 | `ccdvf-evaluator-optimizer-when` | pattern | d2 | D1 | D1.md |
| 27 | `ccdvf-self-hosted-vs-cloud-sandbox` | pattern | d2 | D1 | D1.md |
| 28 | `ccdvf-guardrail-hook-vs-prompt-vs-rule` | pattern | d3 | D1 | D1.md |
| 29 | `ccdvf-messages-api-stateless` | concept | d1 | D2 | D2a.md |
| 30 | `ccdvf-message-content-blocks` | concept | d1 | D2 | D2a.md |
| 31 | `ccdvf-usage-input-token-fields` | concept | d2 | D2 | D2a.md |
| 32 | `ccdvf-streaming-when-required` | concept | d1 | D2 | D2a.md |
| 33 | `ccdvf-input-json-delta-accumulation` | concept | d2 | D2 | D2a.md |
| 34 | `ccdvf-tool-use-block-anatomy` | concept | d1 | D2 | D2a.md |
| 35 | `ccdvf-image-source-types` | concept | d1 | D2 | D2a.md |
| 36 | `ccdvf-image-token-cost-patches` | concept | d2 | D2 | D2a.md |
| 37 | `ccdvf-pdf-processing-model` | concept | d1 | D2 | D2a.md |
| 38 | `ccdvf-thinking-blocks-and-signature` | concept | d1 | D2 | D2a.md |
| 39 | `ccdvf-redacted-thinking-block` | concept | d2 | D2 | D2a.md |
| 40 | `ccdvf-cache-control-breakpoint-semantics` | concept | d1 | D2 | D2a.md |
| 41 | `ccdvf-cache-lookback-window` | concept | d2 | D2 | D2a.md |
| 42 | `ccdvf-context-window-accounting` | concept | d1 | D2 | D2a.md |
| 43 | `ccdvf-sampling-params-removed` | concept | d1 | D2 | D2a.md |
| 44 | `ccdvf-streaming-event-order` | feature | d2 | D2 | D2a.md |
| 45 | `ccdvf-tool-result-first-rule` | feature | d2 | D2 | D2a.md |
| 46 | `ccdvf-automatic-caching-top-level` | feature | d2 | D2 | D2a.md |
| 47 | `ccdvf-cache-prewarm-max-tokens-zero` | feature | d2 | D2 | D2a.md |
| 48 | `ccdvf-image-request-limits` | feature | d1 | D2 | D2a.md |
| 49 | `ccdvf-pdf-request-limits` | feature | d1 | D2 | D2a.md |
| 50 | `ccdvf-files-api-lifecycle` | feature | d2 | D2 | D2a.md |
| 51 | `ccdvf-thinking-display-modes` | feature | d2 | D2 | D2a.md |
| 52 | `ccdvf-thinking-tokens-usage-field` | feature | d2 | D2 | D2a.md |
| 53 | `ccdvf-server-tool-auto-cache-breakpoint` | feature | d2 | D2 | D2a.md |
| 54 | `ccdvf-request-size-limits` | feature | d1 | D2 | D2a.md |
| 55 | `ccdvf-prompt-cache-prefix-hierarchy` | pattern | d2 | D2 | D2a.md |
| 56 | `ccdvf-cache-breakpoint-on-static-not-varying` | pattern | d2 | D2 | D2a.md |
| 57 | `ccdvf-thinking-block-preservation-by-model` | pattern | d2 | D2 | D2a.md |
| 58 | `ccdvf-parallel-tool-results-single-message` | pattern | d2 | D2 | D2a.md |
| 59 | `ccdvf-thinking-replay-in-tool-loop` | pattern | d2 | D2 | D2a.md |
| 60 | `ccdvf-stream-interruption-recovery` | pattern | d2 | D2 | D2a.md |
| 61 | `ccdvf-eager-input-streaming-guarded-parse` | pattern | d3 | D2 | D2a.md |
| 62 | `ccdvf-batch-async-lifecycle` | concept | d1 | D2 | D2b.md |
| 63 | `ccdvf-batch-custom-id-matching` | concept | d1 | D2 | D2b.md |
| 64 | `ccdvf-batch-result-types` | concept | d1 | D2 | D2b.md |
| 65 | `ccdvf-batch-cancel-and-retention` | concept | d1 | D2 | D2b.md |
| 66 | `ccdvf-files-create-once-use-many` | concept | d1 | D2 | D2b.md |
| 67 | `ccdvf-files-workspace-scope` | concept | d2 | D2 | D2b.md |
| 68 | `ccdvf-files-download-rule` | concept | d1 | D2 | D2b.md |
| 69 | `ccdvf-data-conversation-history-resend` | concept | d1 | D2 | D2b.md |
| 70 | `ccdvf-data-source-types` | concept | d1 | D2 | D2b.md |
| 71 | `ccdvf-platform-operator-matrix` | concept | d2 | D2 | D2b.md |
| 72 | `ccdvf-model-id-pinning-dateless` | concept | d2 | D2 | D2b.md |
| 73 | `ccdvf-model-alias-vs-id-by-platform` | concept | d1 | D2 | D2b.md |
| 74 | `ccdvf-model-lifecycle-states` | concept | d1 | D2 | D2b.md |
| 75 | `ccdvf-claude-md-context-not-enforcement` | concept | d1 | D2 | D2b.md |
| 76 | `ccdvf-claude-md-scope-levels` | concept | d1 | D2 | D2b.md |
| 77 | `ccdvf-settings-file-scopes` | concept | d1 | D2 | D2b.md |
| 78 | `ccdvf-batch-limits-numbers` | feature | d2 | D2 | D2b.md |
| 79 | `ccdvf-batch-unsupported-params` | feature | d2 | D2 | D2b.md |
| 80 | `ccdvf-files-limits-expiration` | feature | d2 | D2 | D2b.md |
| 81 | `ccdvf-bedrock-messages-endpoint` | feature | d2 | D2 | D2b.md |
| 82 | `ccdvf-vertex-request-differences` | feature | d2 | D2 | D2b.md |
| 83 | `ccdvf-foundry-deployment-and-auth` | feature | d2 | D2 | D2b.md |
| 84 | `ccdvf-settings-precedence` | feature | d2 | D2 | D2b.md |
| 85 | `ccdvf-plugin-dependency-version-constraints` | feature | d2 | D2 | D2b.md |
| 86 | `ccdvf-batch-cache-seed-1h` | pattern | d2 | D2 | D2b.md |
| 87 | `ccdvf-batch-error-triage` | pattern | d2 | D2 | D2b.md |
| 88 | `ccdvf-files-vs-base64-vs-url` | pattern | d2 | D2 | D2b.md |
| 89 | `ccdvf-aws-bedrock-vs-claude-platform` | pattern | d3 | D2 | D2b.md |
| 90 | `ccdvf-foundry-hosting-option-choice` | pattern | d2 | D2 | D2b.md |
| 91 | `ccdvf-model-upgrade-as-release` | pattern | d2 | D2 | D2b.md |
| 92 | `ccdvf-claude-code-model-pin-third-party` | pattern | d2 | D2 | D2b.md |
| 93 | `ccdvf-config-instruction-vs-enforcement` | pattern | d3 | D2 | D2b.md |
| 94 | `ccdvf-claude-md-hierarchy` | feature | d1 | D3 | D3.md |
| 95 | `ccdvf-cc-init-repository` | concept | d1 | D3 | D3.md |
| 96 | `ccdvf-cc-rules-path-scoped` | concept | d1 | D3 | D3.md |
| 97 | `ccdvf-cc-skills-progressive-disclosure` | concept | d1 | D3 | D3.md |
| 98 | `ccdvf-cc-custom-slash-command-arguments` | concept | d1 | D3 | D3.md |
| 99 | `ccdvf-cc-subagent-definition-file` | concept | d1 | D3 | D3.md |
| 100 | `ccdvf-cc-agent-memory-scopes` | concept | d2 | D3 | D3.md |
| 101 | `ccdvf-cc-auto-memory-vs-claude-md` | concept | d1 | D3 | D3.md |
| 102 | `ccdvf-cc-session-resume-transcripts` | concept | d1 | D3 | D3.md |
| 103 | `ccdvf-cc-builtin-slash-commands` | concept | d1 | D3 | D3.md |
| 104 | `ccdvf-cc-streaming-input-mode` | concept | d2 | D3 | D3.md |
| 105 | `ccdvf-cc-auto-mode-classifier` | concept | d2 | D3 | D3.md |
| 106 | `ccdvf-permission-modes` | concept | d2 | D3 | D3.md |
| 107 | `ccdvf-cc-settings-json-permission-rules` | concept | d2 | D3 | D3.md |
| 108 | `ccdvf-headless-p-output-json` | feature | d1 | D3 | D3.md |
| 109 | `ccdvf-mcp-config-scopes` | feature | d2 | D3 | D3.md |
| 110 | `ccdvf-rule-skill-command-agent-choice` | pattern | d2 | D3 | D3.md |
| 111 | `ccdvf-compact-vs-clear` | pattern | d1 | D3 | D3.md |
| 112 | `ccdvf-cc-hook-vs-claude-md-enforcement` | pattern | d2 | D3 | D3.md |
| 113 | `ccdvf-cc-local-vs-shared-settings` | pattern | d2 | D3 | D3.md |
| 114 | `ccdvf-cc-skill-fork-vs-inline` | pattern | d2 | D3 | D3.md |
| 115 | `ccdvf-cc-untrusted-repo-headless-p` | pattern | d3 | D3 | D3.md |
| 116 | `ccdvf-stop-reason-vs-http-error` | concept | d1 | D4 | D4.md |
| 117 | `ccdvf-tool-error-is-error-recovery` | concept | d1 | D4 | D4.md |
| 118 | `ccdvf-transcript-failure-modes` | concept | d2 | D4 | D4.md |
| 119 | `ccdvf-schema-valid-but-wrong` | concept | d2 | D4 | D4.md |
| 120 | `ccdvf-http-error-taxonomy` | feature | d2 | D4 | D4.md |
| 121 | `ccdvf-retriable-vs-terminal` | pattern | d1 | D4 | D4.md |
| 122 | `ccdvf-stop-reason-playbook` | pattern | d2 | D4 | D4.md |
| 123 | `ccdvf-stream-error-after-200` | pattern | d2 | D4 | D4.md |
| 124 | `ccdvf-integration-vs-model-fault` | pattern | d2 | D4 | D4.md |
| 125 | `ccdvf-eval-grader-choice` | pattern | d2 | D4 | D4.md |
| 126 | `ccdvf-tokens-what-they-are` | concept | d1 | D5 | D5.md |
| 127 | `ccdvf-context-window-working-memory` | concept | d1 | D5 | D5.md |
| 128 | `ccdvf-sampling-parameters-removed` | concept | d2 | D5 | D5.md |
| 129 | `ccdvf-non-determinism-temperature-zero` | concept | d1 | D5 | D5.md |
| 130 | `ccdvf-next-token-generation-pretraining` | concept | d1 | D5 | D5.md |
| 131 | `ccdvf-cache-min-prefix-by-model` | concept | d2 | D5 | D5.md |
| 132 | `ccdvf-extended-thinking-budget-tokens` | concept | d2 | D5 | D5.md |
| 133 | `ccdvf-adaptive-thinking-concept` | concept | d1 | D5 | D5.md |
| 134 | `ccdvf-effort-is-behavioral-signal` | concept | d2 | D5 | D5.md |
| 135 | `ccdvf-zero-one-multi-shot` | concept | d1 | D5 | D5.md |
| 136 | `ccdvf-sdk-wraps-rest` | concept | d1 | D5 | D5.md |
| 137 | `ccdvf-sse-not-websockets` | concept | d2 | D5 | D5.md |
| 138 | `ccdvf-opus-sonnet-haiku-use-cases` | concept | d1 | D5 | D5.md |
| 139 | `ccdvf-adaptive-thinking-support-by-model` | concept | d2 | D5 | D5.md |
| 140 | `ccdvf-quality-latency-cost-triangle` | concept | d1 | D5 | D5.md |
| 141 | `ccdvf-breaking-behavior-changes-releases` | concept | d2 | D5 | D5.md |
| 142 | `ccdvf-usage-object-fields` | concept | d2 | D5 | D5.md |
| 143 | `ccdvf-cost-model-per-request-formula` | concept | d2 | D5 | D5.md |
| 144 | `ccdvf-prompt-caching-concept` | concept | d1 | D5 | D5.md |
| 145 | `ccdvf-cache-checkpointing-breakpoints` | concept | d2 | D5 | D5.md |
| 146 | `ccdvf-model-lineup-price-context` | feature | d1 | D5 | D5.md |
| 147 | `ccdvf-pricing-multipliers-table` | feature | d1 | D5 | D5.md |
| 148 | `ccdvf-choosing-a-model-two-approaches` | feature | d1 | D5 | D5.md |
| 149 | `ccdvf-dateless-id-not-alias` | feature | d2 | D5 | D5.md |
| 150 | `ccdvf-model-deprecation-lifecycle` | feature | d1 | D5 | D5.md |
| 151 | `ccdvf-effort-levels` | feature | d2 | D5 | D5.md |
| 152 | `ccdvf-fast-mode-scope` | feature | d2 | D5 | D5.md |
| 153 | `ccdvf-thinking-display-omitted-default` | feature | d2 | D5 | D5.md |
| 154 | `ccdvf-context-window-overflow-behavior` | feature | d2 | D5 | D5.md |
| 155 | `ccdvf-token-counting-endpoint` | feature | d1 | D5 | D5.md |
| 156 | `ccdvf-optimizing-cost-lever-order` | feature | d2 | D5 | D5.md |
| 157 | `ccdvf-batch-api-limits` | feature | d1 | D5 | D5.md |
| 158 | `ccdvf-cache-aware-itpm` | feature | d2 | D5 | D5.md |
| 159 | `ccdvf-adaptive-vs-manual-thinking` | pattern | d2 | D5 | D5.md |
| 160 | `ccdvf-cache-ttl-5m-vs-1h` | pattern | d2 | D5 | D5.md |
| 161 | `ccdvf-cost-per-completed-task` | pattern | d2 | D5 | D5.md |
| 162 | `ccdvf-effort-vs-model-switch` | pattern | d2 | D5 | D5.md |
| 163 | `ccdvf-max-tokens-vs-effort-vs-task-budget` | pattern | d3 | D5 | D5.md |
| 164 | `ccdvf-rerun-failures-higher-effort` | pattern | d2 | D5 | D5.md |
| 165 | `ccdvf-thinking-vs-caching-effort-change` | pattern | d2 | D5 | D5.md |
| 166 | `ccdvf-batch-plus-cache-stacking` | pattern | d2 | D5 | D5.md |
| 167 | `ccdvf-advisor-vs-orchestrator` | pattern | d3 | D5 | D5.md |
| 168 | `ccdvf-disable-thinking-vs-low-effort` | pattern | d2 | D5 | D5.md |
| 169 | `ccdvf-shorter-output-vs-lower-effort` | pattern | d2 | D5 | D5.md |
| 170 | `ccdvf-migration-eval-first` | pattern | d2 | D5 | D5.md |
| 171 | `ccdvf-serving-drift-vs-model-change` | pattern | d3 | D5 | D5.md |
| 172 | `ccdvf-context-rot-attention-budget` | concept | d1 | D6 | D6.md |
| 173 | `ccdvf-context-window-what-counts` | concept | d1 | D6 | D6.md |
| 174 | `ccdvf-tool-output-pruning` | concept | d1 | D6 | D6.md |
| 175 | `ccdvf-subagent-context-isolation` | concept | d1 | D6 | D6.md |
| 176 | `ccdvf-context-drift-vs-bloat` | concept | d2 | D6 | D6.md |
| 177 | `ccdvf-just-in-time-context` | concept | d2 | D6 | D6.md |
| 178 | `ccdvf-instruction-clarity-golden-rule` | concept | d1 | D6 | D6.md |
| 179 | `ccdvf-explain-why-behind-instructions` | concept | d1 | D6 | D6.md |
| 180 | `ccdvf-few-shot-3-to-5` | concept | d1 | D6 | D6.md |
| 181 | `ccdvf-xml-tags-structure` | concept | d1 | D6 | D6.md |
| 182 | `ccdvf-role-prompt-system-param` | concept | d1 | D6 | D6.md |
| 183 | `ccdvf-right-altitude-system-prompt` | concept | d2 | D6 | D6.md |
| 184 | `ccdvf-skepticism-confident-output` | concept | d1 | D6 | D6.md |
| 185 | `ccdvf-response-validation-layers` | concept | d2 | D6 | D6.md |
| 186 | `ccdvf-input-sanitization-delimiters` | concept | d2 | D6 | D6.md |
| 187 | `ccdvf-prompt-engineering-prerequisites` | concept | d1 | D6 | D6.md |
| 188 | `ccdvf-structured-outputs-schema-rules` | feature | d2 | D6 | D6.md |
| 189 | `ccdvf-structured-outputs-invalid-cases` | feature | d2 | D6 | D6.md |
| 190 | `ccdvf-structured-outputs-grammar-cache-limits` | feature | d2 | D6 | D6.md |
| 191 | `ccdvf-server-side-compaction` | feature | d2 | D6 | D6.md |
| 192 | `ccdvf-context-editing-clear-tool-uses` | feature | d2 | D6 | D6.md |
| 193 | `ccdvf-thinking-block-clearing` | feature | d2 | D6 | D6.md |
| 194 | `ccdvf-context-awareness-token-budget` | feature | d1 | D6 | D6.md |
| 195 | `ccdvf-mid-conversation-system-message` | feature | d2 | D6 | D6.md |
| 196 | `ccdvf-turn-scoped-system-message` | feature | d2 | D6 | D6.md |
| 197 | `ccdvf-memory-tool-notes` | feature | d2 | D6 | D6.md |
| 198 | `ccdvf-prefill-removed-4-6` | feature | d1 | D6 | D6.md |
| 199 | `ccdvf-long-data-top-query-bottom` | pattern | d1 | D6 | D6.md |
| 200 | `ccdvf-compaction-vs-context-editing` | pattern | d2 | D6 | D6.md |
| 201 | `ccdvf-system-vs-user-placement` | pattern | d1 | D6 | D6.md |
| 202 | `ccdvf-positive-vs-negative-instructions` | pattern | d2 | D6 | D6.md |
| 203 | `ccdvf-compaction-vs-notes-vs-subagents` | pattern | d2 | D6 | D6.md |
| 204 | `ccdvf-fresh-context-vs-compact` | pattern | d2 | D6 | D6.md |
| 205 | `ccdvf-top-level-system-vs-mid-conversation` | pattern | d2 | D6 | D6.md |
| 206 | `ccdvf-structured-outputs-vs-prompted-json` | pattern | d2 | D6 | D6.md |
| 207 | `ccdvf-tool-context-four-approaches` | pattern | d2 | D6 | D6.md |
| 208 | `ccdvf-prompt-chaining-vs-single-call` | pattern | d2 | D6 | D6.md |
| 209 | `ccdvf-iterative-refinement-loop` | pattern | d2 | D6 | D6.md |
| 210 | `ccdvf-instruction-placement-tool-result-vs-user-turn` | pattern | d2 | D6 | D6.md |
| 211 | `ccdvf-direct-vs-indirect-injection` | pattern | d1 | D7 | D7.md |
| 212 | `ccdvf-untrusted-content-in-tool-result` | pattern | d2 | D7 | D7.md |
| 213 | `ccdvf-hook-exit-code-2-blocks` | feature | d2 | D7 | D7.md |
| 214 | `ccdvf-api-key-vs-wif-vs-app-attest` | pattern | d2 | D7 | D7.md |
| 215 | `ccdvf-workspace-isolation` | feature | d1 | D7 | D7.md |
| 216 | `ccdvf-web-fetch-exfiltration` | concept | d2 | D7 | D7.md |
| 217 | `ccdvf-zdr-eligibility` | concept | d2 | D7 | D7.md |
| 218 | `ccdvf-harmlessness-screen-haiku` | concept | d1 | D7 | D7.md |
| 219 | `ccdvf-repeat-offender-response` | concept | d1 | D7 | D7.md |
| 220 | `ccdvf-prompt-leak-tradeoff` | concept | d2 | D7 | D7.md |
| 221 | `ccdvf-phi-hipaa-vs-zdr` | concept | d2 | D7 | D7.md |
| 222 | `ccdvf-streaming-refusal-200` | concept | d2 | D7 | D7.md |
| 223 | `ccdvf-permission-rules-not-model` | concept | d1 | D7 | D7.md |
| 224 | `ccdvf-identity-backed-keys` | concept | d2 | D7 | D7.md |
| 225 | `ccdvf-key-expiration-presets` | concept | d1 | D7 | D7.md |
| 226 | `ccdvf-admin-key-scope` | concept | d1 | D7 | D7.md |
| 227 | `ccdvf-access-monitoring-signals` | concept | d2 | D7 | D7.md |
| 228 | `ccdvf-computer-use-injection-classifier` | concept | d2 | D7 | D7.md |
| 229 | `ccdvf-skills-trusted-sources` | concept | d1 | D7 | D7.md |
| 230 | `ccdvf-bash-sandbox-os-enforcement` | feature | d2 | D7 | D7.md |
| 231 | `ccdvf-read-deny-sensitive-files` | feature | d1 | D7 | D7.md |
| 232 | `ccdvf-wif-three-resources` | feature | d2 | D7 | D7.md |
| 233 | `ccdvf-mcp-toolset-denylist` | feature | d2 | D7 | D7.md |
| 234 | `ccdvf-hook-vs-claude-md-enforcement` | pattern | d2 | D7 | D7.md |
| 235 | `ccdvf-permission-deny-vs-sandbox` | pattern | d2 | D7 | D7.md |
| 236 | `ccdvf-screen-tool-output-before-use` | pattern | d2 | D7 | D7.md |
| 237 | `ccdvf-own-instructions-not-in-tool-result` | pattern | d2 | D7 | D7.md |
| 238 | `ccdvf-skip-permissions-isolated-only` | pattern | d2 | D7 | D7.md |
| 239 | `ccdvf-least-privilege-agent-access` | pattern | d2 | D7 | D7.md |
| 240 | `ccdvf-hook-vs-permission-rule-precedence` | pattern | d2 | D7 | D7.md |
| 241 | `ccdvf-reset-vs-retry-after-refusal` | pattern | d2 | D7 | D7.md |
| 242 | `ccdvf-guardrail-layering-chain` | pattern | d3 | D7 | D7.md |
| 243 | `ccdvf-tool-description-quality` | concept | d1 | D8 | D8.md |
| 244 | `ccdvf-tool-use-contract` | concept | d1 | D8 | D8.md |
| 245 | `ccdvf-tool-definition-fields` | concept | d1 | D8 | D8.md |
| 246 | `ccdvf-mcp-tools-resources-prompts` | concept | d1 | D8 | D8.md |
| 247 | `ccdvf-mcp-host-client-server` | concept | d1 | D8 | D8.md |
| 248 | `ccdvf-mcp-two-layers-jsonrpc` | concept | d1 | D8 | D8.md |
| 249 | `ccdvf-mcp-discovery-and-calls` | concept | d2 | D8 | D8.md |
| 250 | `ccdvf-when-not-to-use-tools` | concept | d1 | D8 | D8.md |
| 251 | `ccdvf-anthropic-schema-tools-trained-in` | concept | d1 | D8 | D8.md |
| 252 | `ccdvf-tool-consolidation-principle` | concept | d1 | D8 | D8.md |
| 253 | `ccdvf-tool-namespacing` | concept | d1 | D8 | D8.md |
| 254 | `ccdvf-high-signal-tool-responses` | concept | d1 | D8 | D8.md |
| 255 | `ccdvf-tool-error-messages-as-interface` | concept | d1 | D8 | D8.md |
| 256 | `ccdvf-skill-progressive-disclosure` | concept | d1 | D8 | D8.md |
| 257 | `ccdvf-skill-md-required-fields` | concept | d2 | D8 | D8.md |
| 258 | `ccdvf-server-tool-use-block` | concept | d1 | D8 | D8.md |
| 259 | `ccdvf-agent-sdk-inprocess-mcp` | concept | d2 | D8 | D8.md |
| 260 | `ccdvf-mcp-tool-naming-claude-code` | concept | d1 | D8 | D8.md |
| 261 | `ccdvf-parallel-tool-calls-execution` | concept | d1 | D8 | D8.md |
| 262 | `ccdvf-tool-choice-modes` | feature | d2 | D8 | D8.md |
| 263 | `ccdvf-tool-search-threshold` | feature | d2 | D8 | D8.md |
| 264 | `ccdvf-strict-tool-use` | feature | d2 | D8 | D8.md |
| 265 | `ccdvf-tool-result-block-shape` | feature | d2 | D8 | D8.md |
| 266 | `ccdvf-disable-parallel-tool-use` | feature | d1 | D8 | D8.md |
| 267 | `ccdvf-web-search-tool-params` | feature | d2 | D8 | D8.md |
| 268 | `ccdvf-web-fetch-url-validation` | feature | d2 | D8 | D8.md |
| 269 | `ccdvf-code-execution-tool-facts` | feature | d2 | D8 | D8.md |
| 270 | `ccdvf-programmatic-tool-calling` | feature | d2 | D8 | D8.md |
| 271 | `ccdvf-mcp-connector-request-shape` | feature | d2 | D8 | D8.md |
| 272 | `ccdvf-mcp-toolset-allowlist-denylist` | feature | d2 | D8 | D8.md |
| 273 | `ccdvf-claude-mcp-add-transports` | feature | d1 | D8 | D8.md |
| 274 | `ccdvf-mcp-output-token-limit` | feature | d2 | D8 | D8.md |
| 275 | `ccdvf-bash-tool-client-session` | feature | d1 | D8 | D8.md |
| 276 | `ccdvf-text-editor-tool-commands` | feature | d1 | D8 | D8.md |
| 277 | `ccdvf-memory-tool-client-side` | feature | d2 | D8 | D8.md |
| 278 | `ccdvf-computer-use-toolset` | feature | d2 | D8 | D8.md |
| 279 | `ccdvf-tool-cache-control-placement` | feature | d2 | D8 | D8.md |
| 280 | `ccdvf-server-tools-mixed-turn` | feature | d2 | D8 | D8.md |
| 281 | `ccdvf-tool-use-system-prompt-overhead` | feature | d2 | D8 | D8.md |
| 282 | `ccdvf-skills-api-mechanics` | feature | d2 | D8 | D8.md |
| 283 | `ccdvf-client-vs-server-tools` | pattern | d2 | D8 | D8.md |
| 284 | `ccdvf-builtin-vs-custom-vs-skill-vs-mcp` | pattern | d2 | D8 | D8.md |
| 285 | `ccdvf-stdio-vs-streamable-http` | pattern | d2 | D8 | D8.md |
| 286 | `ccdvf-mcp-connector-vs-own-client` | pattern | d2 | D8 | D8.md |
| 287 | `ccdvf-defer-loading-which-tools` | pattern | d2 | D8 | D8.md |
| 288 | `ccdvf-programmatic-vs-direct-calling` | pattern | d2 | D8 | D8.md |
| 289 | `ccdvf-fix-selection-vs-fix-inputs` | pattern | d2 | D8 | D8.md |
| 290 | `ccdvf-parallel-run-strategy` | pattern | d2 | D8 | D8.md |
| 291 | `ccdvf-approval-pattern-enforced-vs-prompted` | pattern | d2 | D8 | D8.md |
| 292 | `ccdvf-agentic-harness-dispatch` | pattern | d2 | D8 | D8.md |
| 293 | `ccdvf-web-search-vs-web-fetch` | pattern | d2 | D8 | D8.md |
| 294 | `ccdvf-code-execution-vs-bash-tool` | pattern | d2 | D8 | D8.md |
| 295 | `ccdvf-mcp-resources-vs-tools-for-data` | pattern | d2 | D8 | D8.md |
| 296 | `ccdvf-mcp-server-output-shaping` | pattern | d2 | D8 | D8.md |
| 297 | `ccdvf-tool-versioning-strategy` | pattern | d2 | D8 | D8.md |
| 298 | `ccdvf-remote-mcp-auth-pattern` | pattern | d2 | D8 | D8.md |
| 299 | `ccdvf-agent-iteration-cap-mcq` | mcq | d2 | D1 | D1.md |
| 300 | `ccdvf-fixed-pipeline-not-agent-mcq` | mcq | d1 | D1 | D1.md |
| 301 | `ccdvf-context-flood-subagent-mcq` | mcq | d2 | D1 | D1.md |
| 302 | `ccdvf-subagent-no-history-mcq` | mcq | d2 | D1 | D1.md |
| 303 | `ccdvf-agent-sdk-language-mcq` | mcq | d1 | D1 | D1.md |
| 304 | `ccdvf-block-env-write-hook-mcq` | mcq | d2 | D1 | D1.md |
| 305 | `ccdvf-managed-vs-sdk-hosting-mcq` | mcq | d2 | D1 | D1.md |
| 306 | `ccdvf-self-hosted-sandbox-mcq` | mcq | d2 | D1 | D1.md |
| 307 | `ccdvf-orchestrator-workers-mcq` | mcq | d2 | D1 | D1.md |
| 308 | `ccdvf-routing-cost-mcq` | mcq | d2 | D1 | D1.md |
| 309 | `ccdvf-max-turns-result-mcq` | mcq | d3 | D1 | D1.md |
| 310 | `ccdvf-tool-result-ordering-loop-mcq` | mcq | d2 | D1 | D1.md |
| 311 | `ccdvf-framework-debug-mcq` | mcq | d2 | D1 | D1.md |
| 312 | `ccdvf-memory-across-sessions-mcq` | mcq | d2 | D1 | D1.md |
| 313 | `ccdvf-subagent-budget-cap-mcq` | mcq | d3 | D1 | D1.md |
| 314 | `ccdvf-long-session-compaction-mcq` | mcq | d3 | D1 | D1.md |
| 315 | `ccdvf-multiagent-roster-mcq` | mcq | d2 | D1 | D1.md |
| 316 | `ccdvf-hook-vs-canusetool-mcq` | mcq | d2 | D1 | D1.md |
| 317 | `ccdvf-resume-vs-fork-mcq` | mcq | d1 | D1 | D1.md |
| 318 | `ccdvf-agent-prod-guardrails-mcq` | mcq | d3 | D1 | D1.md |
| 319 | `ccdvf-parallel-subagents-review-mcq` | mcq | d2 | D1 | D1.md |
| 320 | `ccdvf-cache-miss-timestamp-mcq-01` | mcq | d2 | D2 | D2a.md |
| 321 | `ccdvf-streaming-usage-cumulative-mcq-01` | mcq | d1 | D2 | D2a.md |
| 322 | `ccdvf-tool-result-400-mcq-01` | mcq | d1 | D2 | D2a.md |
| 323 | `ccdvf-empty-end-turn-after-tool-result-mcq-01` | mcq | d2 | D2 | D2a.md |
| 324 | `ccdvf-pdf-page-limit-mcq-01` | mcq | d2 | D2 | D2a.md |
| 325 | `ccdvf-image-payload-growth-mcq-01` | mcq | d2 | D2 | D2a.md |
| 326 | `ccdvf-thinking-stream-signature-mcq-01` | mcq | d2 | D2 | D2a.md |
| 327 | `ccdvf-files-tenant-isolation-mcq-01` | mcq | d2 | D2 | D2a.md |
| 328 | `ccdvf-cache-lookback-second-breakpoint-mcq-01` | mcq | d3 | D2 | D2a.md |
| 329 | `ccdvf-image-history-resend-mcq-01` | mcq | d2 | D2 | D2a.md |
| 330 | `ccdvf-conversation-memory-mcq-01` | mcq | d1 | D2 | D2a.md |
| 331 | `ccdvf-parallel-tool-calls-stopped-mcq-01` | mcq | d2 | D2 | D2a.md |
| 332 | `ccdvf-server-tool-pending-mcq-01` | mcq | d3 | D2 | D2a.md |
| 333 | `ccdvf-budget-tokens-max-tokens-mcq-01` | mcq | d1 | D2 | D2a.md |
| 334 | `ccdvf-forced-tool-with-manual-thinking-mcq-01` | mcq | d2 | D2 | D2a.md |
| 335 | `ccdvf-prefill-removed-mcq-01` | mcq | d1 | D2 | D2a.md |
| 336 | `ccdvf-prewarm-cache-mcq-01` | mcq | d2 | D2 | D2a.md |
| 337 | `ccdvf-pdf-visual-content-mcq-01` | mcq | d1 | D2 | D2a.md |
| 338 | `ccdvf-image-then-text-ordering-mcq-01` | mcq | d1 | D2 | D2a.md |
| 339 | `ccdvf-count-tokens-limits-mcq-01` | mcq | d2 | D2 | D2a.md |
| 340 | `ccdvf-cache-scope-changes-mcq-01` | mcq | d3 | D2 | D2a.md |
| 341 | `ccdvf-tool-result-content-types-mcq-01` | mcq | d2 | D2 | D2a.md |
| 342 | `ccdvf-thinking-replay-rules-mcq-01` | mcq | d3 | D2 | D2a.md |
| 343 | `ccdvf-batch-vs-realtime-mcq` | mcq | d1 | D2 | D2b.md |
| 344 | `ccdvf-batch-results-join-mcq` | mcq | d1 | D2 | D2b.md |
| 345 | `ccdvf-batch-latency-mismatch-mcq` | mcq | d2 | D2 | D2b.md |
| 346 | `ccdvf-batch-expired-results-mcq` | mcq | d2 | D2 | D2b.md |
| 347 | `ccdvf-batch-dry-run-validation-mcq` | mcq | d2 | D2 | D2b.md |
| 348 | `ccdvf-batch-shared-prefix-cache-mcq` | mcq | d2 | D2 | D2b.md |
| 349 | `ccdvf-batch-tenant-isolation-mcq` | mcq | d2 | D2 | D2b.md |
| 350 | `ccdvf-files-multiturn-image-mcq` | mcq | d2 | D2 | D2b.md |
| 351 | `ccdvf-files-auto-expiry-mcq` | mcq | d2 | D2 | D2b.md |
| 352 | `ccdvf-third-party-platform-gaps-mcq` | mcq | d3 | D2 | D2b.md |
| 353 | `ccdvf-vertex-model-in-body-mcq` | mcq | d2 | D2 | D2b.md |
| 354 | `ccdvf-foundry-deployment-name-mcq` | mcq | d1 | D2 | D2b.md |
| 355 | `ccdvf-foundry-hosted-azure-400-mcq` | mcq | d2 | D2 | D2b.md |
| 356 | `ccdvf-aws-compliance-choice-mcq` | mcq | d3 | D2 | D2b.md |
| 357 | `ccdvf-bedrock-endpoint-cost-mcq` | mcq | d2 | D2 | D2b.md |
| 358 | `ccdvf-model-pin-snapshot-mcq` | mcq | d2 | D2 | D2b.md |
| 359 | `ccdvf-model-retirement-plan-mcq` | mcq | d3 | D2 | D2b.md |
| 360 | `ccdvf-settings-local-model-override-mcq` | mcq | d1 | D2 | D2b.md |
| 361 | `ccdvf-claude-md-personal-sandbox-mcq` | mcq | d1 | D2 | D2b.md |
| 362 | `ccdvf-enforce-vs-instruct-mcq` | mcq | d2 | D2 | D2b.md |
| 363 | `ccdvf-plugin-dep-pin-mcq` | mcq | d2 | D2 | D2b.md |
| 364 | `ccdvf-settings-precedence-mcq` | mcq | d3 | D2 | D2b.md |
| 365 | `ccdvf-claude-md-bloat-mcq` | mcq | d2 | D2 | D2b.md |
| 366 | `ccdvf-cc-ci-lockdown-mcq-01` | mcq | d2 | D3 | D3.md |
| 367 | `ccdvf-cc-repeated-procedure-mcq-02` | mcq | d1 | D3 | D3.md |
| 368 | `ccdvf-cc-block-env-edit-mcq-03` | mcq | d2 | D3 | D3.md |
| 369 | `ccdvf-cc-monorepo-rules-mcq-04` | mcq | d2 | D3 | D3.md |
| 370 | `ccdvf-cc-mcp-share-team-mcq-05` | mcq | d3 | D3 | D3.md |
| 371 | `ccdvf-retrieval-vs-model-fault-mcq` | mcq | d2 | D4 | D4.md |
| 372 | `ccdvf-spend-cap-429-mcq-01` | mcq | d2 | D4 | D4.md |
| 373 | `ccdvf-stream-error-handling-mcq-01` | mcq | d2 | D4 | D4.md |
| 374 | `ccdvf-thinking-blocks-400-mcq-01` | mcq | d2 | D4 | D4.md |
| 375 | `ccdvf-refusal-observability-mcq-01` | mcq | d3 | D4 | D4.md |
| 376 | `ccdvf-right-size-classifier-mcq-01` | mcq | d1 | D5 | D5.md |
| 377 | `ccdvf-budget-tokens-400-mcq-02` | mcq | d1 | D5 | D5.md |
| 378 | `ccdvf-cache-silently-not-written-mcq-03` | mcq | d2 | D5 | D5.md |
| 379 | `ccdvf-cache-ttl-support-chat-mcq-04` | mcq | d2 | D5 | D5.md |
| 380 | `ccdvf-effort-change-cache-miss-mcq-05` | mcq | d2 | D5 | D5.md |
| 381 | `ccdvf-fast-mode-ttft-mcq-06` | mcq | d2 | D5 | D5.md |
| 382 | `ccdvf-eval-batch-cache-mcq-07` | mcq | d3 | D5 | D5.md |
| 383 | `ccdvf-max-tokens-truncation-mcq-08` | mcq | d2 | D5 | D5.md |
| 384 | `ccdvf-sampling-400-migration-mcq-09` | mcq | d1 | D5 | D5.md |
| 385 | `ccdvf-token-count-before-send-mcq-10` | mcq | d1 | D5 | D5.md |
| 386 | `ccdvf-cost-per-task-compare-mcq-11` | mcq | d2 | D5 | D5.md |
| 387 | `ccdvf-thinking-disabled-xhigh-400-mcq-12` | mcq | d2 | D5 | D5.md |
| 388 | `ccdvf-content-index-zero-break-mcq-13` | mcq | d2 | D5 | D5.md |
| 389 | `ccdvf-model-alias-drift-mcq-14` | mcq | d1 | D5 | D5.md |
| 390 | `ccdvf-retirement-notice-mcq-15` | mcq | d1 | D5 | D5.md |
| 391 | `ccdvf-rate-limit-cache-mcq-16` | mcq | d2 | D5 | D5.md |
| 392 | `ccdvf-cache-invalidators-mcq-17` | mcq | d3 | D5 | D5.md |
| 393 | `ccdvf-effort-vs-downgrade-mcq-18` | mcq | d2 | D5 | D5.md |
| 394 | `ccdvf-thinking-blocks-tool-loop-mcq-19` | mcq | d2 | D5 | D5.md |
| 395 | `ccdvf-long-context-pricing-mcq-20` | mcq | d3 | D5 | D5.md |
| 396 | `ccdvf-few-shot-format-drift-mcq-21` | mcq | d1 | D5 | D5.md |
| 397 | `ccdvf-advisor-consult-rate-mcq-22` | mcq | d3 | D5 | D5.md |
| 398 | `ccdvf-fast-mode-facts-mcq-23` | mcq | d3 | D5 | D5.md |
| 399 | `ccdvf-usage-tracking-mcq-24` | mcq | d3 | D5 | D5.md |
| 400 | `ccdvf-defensive-parsing-retry-mcq` | mcq | d2 | D6 | D6.md |
| 401 | `ccdvf-context-bloat-tool-results-mcq-01` | mcq | d2 | D6 | D6.md |
| 402 | `ccdvf-long-document-placement-mcq-02` | mcq | d1 | D6 | D6.md |
| 403 | `ccdvf-subagent-vs-main-mcq-03` | mcq | d2 | D6 | D6.md |
| 404 | `ccdvf-mid-conversation-system-cache-mcq-04` | mcq | d2 | D6 | D6.md |
| 405 | `ccdvf-few-shot-format-drift-mcq-05` | mcq | d1 | D6 | D6.md |
| 406 | `ccdvf-context-overflow-stop-reason-mcq-06` | mcq | d1 | D6 | D6.md |
| 407 | `ccdvf-hallucinated-figures-mcq-07` | mcq | d2 | D6 | D6.md |
| 408 | `ccdvf-over-prompting-overtrigger-mcq-08` | mcq | d2 | D6 | D6.md |
| 409 | `ccdvf-prefill-400-mcq-09` | mcq | d1 | D6 | D6.md |
| 410 | `ccdvf-tool-response-verbosity-mcq-10` | mcq | d2 | D6 | D6.md |
| 411 | `ccdvf-compaction-instructions-mcq-11` | mcq | d3 | D6 | D6.md |
| 412 | `ccdvf-instruction-in-tool-result-mcq-12` | mcq | d2 | D6 | D6.md |
| 413 | `ccdvf-schema-400-fix-mcq-13` | mcq | d3 | D6 | D6.md |
| 414 | `ccdvf-input-sanitization-user-text-mcq-14` | mcq | d3 | D6 | D6.md |
| 415 | `ccdvf-least-privilege-tool-scope-mcq` | mcq | d2 | D7 | D7.md |
| 416 | `ccdvf-email-agent-injection-mcq` | mcq | d3 | D7 | D7.md |
| 417 | `ccdvf-web-fetch-sensitive-data-mcq` | mcq | d2 | D7 | D7.md |
| 418 | `ccdvf-ci-pipeline-auth-mcq` | mcq | d2 | D7 | D7.md |
| 419 | `ccdvf-ios-app-auth-mcq` | mcq | d2 | D7 | D7.md |
| 420 | `ccdvf-hook-exit-code-mcq` | mcq | d1 | D7 | D7.md |
| 421 | `ccdvf-env-file-protection-mcq` | mcq | d2 | D7 | D7.md |
| 422 | `ccdvf-curl-network-control-mcq` | mcq | d2 | D7 | D7.md |
| 423 | `ccdvf-workspace-env-separation-mcq` | mcq | d1 | D7 | D7.md |
| 424 | `ccdvf-zdr-feature-choice-mcq` | mcq | d3 | D7 | D7.md |
| 425 | `ccdvf-refusal-handling-mcq` | mcq | d2 | D7 | D7.md |
| 426 | `ccdvf-overlapping-tools-mcq-01` | mcq | d2 | D8 | D8.md |
| 427 | `ccdvf-skill-vs-mcp-choice-mcq-02` | mcq | d2 | D8 | D8.md |
| 428 | `ccdvf-mixed-turn-400-mcq-03` | mcq | d2 | D8 | D8.md |
| 429 | `ccdvf-tool-search-context-bloat-mcq-04` | mcq | d2 | D8 | D8.md |
| 430 | `ccdvf-strict-passengers-int-mcq-05` | mcq | d1 | D8 | D8.md |
| 431 | `ccdvf-stdio-vs-http-deploy-mcq-06` | mcq | d2 | D8 | D8.md |
| 432 | `ccdvf-readonly-assistant-allowlist-mcq-07` | mcq | d2 | D8 | D8.md |
| 433 | `ccdvf-web-fetch-url-not-in-context-mcq-08` | mcq | d1 | D8 | D8.md |
| 434 | `ccdvf-programmatic-20-lookups-mcq-09` | mcq | d2 | D8 | D8.md |
| 435 | `ccdvf-bash-tool-safety-mcq-10` | mcq | d3 | D8 | D8.md |
| 436 | `ccdvf-pause-turn-handling-mcq-11` | mcq | d2 | D8 | D8.md |
| 437 | `ccdvf-cache-tool-choice-mcq-12` | mcq | d2 | D8 | D8.md |
| 438 | `ccdvf-mcp-primitive-choice-mcq-13` | mcq | d3 | D8 | D8.md |
| 439 | `ccdvf-agent-sdk-custom-tool-mcq-14` | mcq | d1 | D8 | D8.md |
| 440 | `ccdvf-tool-response-shaping-mcq-15` | mcq | d3 | D8 | D8.md |


# C11 — MCQ P1d console importer (`mcq-console-importer`)

Teach the console's Markdown importer the three MCQ markers — `OPT:`, `WHY:`, `QUALIFIER:` — with lenient marker recognition and strict payload validation, so a mistyped `OPT:` line is an error at its own line number instead of text silently glued into the previous section. Add the pure rule module `frontend/src/lib/mcqRules.ts` (all 19 `McqIssueCode`s, `validateMcq`, `normalizeMcqForCompare`) and the shared blob type `frontend/src/types/mcq.ts`; put `mcq` into `DeckCardContent`, `COMPARABLE_FIELDS`, `fieldsThatDiffer` and `serializeDeckMarkdown` so `parse(serialize(x))` deep-equals `x` and a re-import of the same file plans all `unchanged`; make `deckImportRunner.ts` send `mcq` (explicit `null` on Q/A cards) and stop the run with `SERVER_NOT_READY_MCQ` the first time a server echo drops the field. Tests: a new `frontend/tests/deckImport.mcq.test.ts` (fast-check `mcqArb`) and an optional `mcq` branch in the shared `cardArb` of `frontend/tests/deckImport.test.ts`; one bullet deleted from `docs/delivery-wave-1.6-plan-2026-09-19.md`. Pure TS in `frontend/`; no page, no API client, no `Card` type change (that is C12).

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`; C06 merges before you start and shifts the `deckImport.ts` / `deckImportRunner.ts` / `deckImport.test.ts` line numbers below by a few lines — anchor on the quoted text, not on the numbers):

- `frontend/src/lib/deckImport.ts` (684 lines): `DeckCardContent` `:36-44` (seven fields; C06 appends `topic?: string`), `ParsedCard` `:46-51`, `ImportIssueCode` `:53-66` (13 codes; C06 appends `'BAD_TOPIC' | 'DUPLICATE_TOPIC'`), `ImportIssue` `:68-75` (`line` always set, `stableUid?`), `ComparableField` `:91-98`. Markers `:136-141` are all column-0 regexes; `type SectionKind = 'question' | 'answer' | 'code' | 'usage'` `:157`; `CardDraft` `:164-170` holds `sections: Partial<Record<SectionKind, Section>>`. `finishCard` `:218-261` reports `MISSING_QUESTION` / `MISSING_ANSWER` and returns without pushing the card at `:243`; `orderInDeck: cards.length * 10` `:258`. `openSection` `:268-287` turns a repeated kind into `DUPLICATE_SECTION` (`:272`), sets `swallowing = true` (`:279`) and returns `null` (first wins). The loop `:289-421` checks, per non-blank line: `##` header → `# deck:` → no draft (`TEXT_BEFORE_CARD`) → `Q:` (`:383`) → `A:` → `USAGE:` → `CODE:` → `currentSection === null` (`TEXT_BEFORE_SECTION` `:411`, silenced while `swallowing`) → **`currentSection.lines.push(raw.trimEnd())` `:420`**. That last line is the hazard MCQ plan §4.4 names: any line that matches no marker is appended to the open section, so a strict `OPT:` regex would let `OPT: g`, `OPT: a Increase…` or `OPT: A)` vanish into the previous body with no error. `validateCards` `:460-514` re-checks uid/difficulty/content per card; `COMPARABLE_FIELDS` `:518-526` (C06 appends `'topic'` last); `normalizeText` `:533-535`; `fieldsThatDiffer` `:537-547`; `planImport` `:558-647` turns every `validateCards` issue that carries a `stableUid` into an `INVALID_CARD` conflict (`:566-570`, `:595`) and calls a card `unchanged` when `changedFields` is empty (`:631`); `serializeDeckMarkdown` `:655-679` emits header, `Q:`, question, `A:`, explanation, `CODE:`, `USAGE:` (C06 inserts `TOPIC:` between the header and `Q:`).
- There is no warning tier. `frontend/src/pages/DeckImportPage.tsx:224-230` blocks execution when `preview.parsed.errors.length > 0` or `plan.conflicts.length > 0`; every `ImportIssue` blocks, whether the lexer or `validateCards` emitted it (MCQ plan §4.5 "全部阻断").
- `frontend/src/lib/deckImportRunner.ts` (199 lines): `CreateCardParams` `:31-41`, `UpdateCardParams` `:43-55` (C06 adds `topic?: string` to both), `ImportWriter` `:62-65` returns `ApiResult<Card>` (`frontend/src/types/api.ts:9-14`: `data: T | null`), `ImportFailure` `:67-72`, `ImportRunResult` `:74-78`, `optionalText` `:100-102`, `createParamsFor` `:104-116`, `updateParamsFor` `:118-132`, `describeFailure` `:135-140`, `runImport` `:149-199` (serial `for…of` `:159`; success branch `:182-184`; failure branch `:185-192`; progress `:194-195`). Nothing stops a run today (design point 2, `:16-17`). `DeckImportPage.tsx:556-560` renders `describeFailure(failure)` per failure and `:576-583` re-feeds `failures.map((f) => f.action)` through the "Retry N failed" button — so pushing skipped actions into `failures` surfaces them with no page change.
- Why the readiness guard exists: `src_C/Vpc/Authoring/Helpers.cs:58` (`if (!body.TryGetProperty(f.BodyKey, out var el)) continue;`) drops unknown body keys silently, and the POST handler ignores keys it does not read. Until C08's Lambda (migration `019_cards_mcq.sql`) is deployed — and, on the console side, until C12 teaches `frontend/src/api/authoring.ts` to forward `mcq` — an MCQ card written through the importer lands as a plain Q/A card. The server echo is the only signal: `normalizeCard` (`authoring.ts:86-99`) spreads the raw row, so a deployed server echoes `mcq` as an object (MCQ plan §3.6 pins `ValueKind == Object`) and an old one echoes no `mcq` key at all. The guard fires on that first echo and stops the loop, so a wrong deployment order costs one card, not a deck.
- `frontend/src/types/card.ts` (24 lines) has no `mcq` (C12 adds `mcq?: McqBlob | null`; C06 adds `topic?`). C11 may not edit it (§1.3 file map), so the compare and the guard read the wire key structurally (Change 1's `mcqOf`). Verified with this repo's `tsc`: passing a `Card` to a parameter typed `{ mcq?: unknown }` is a TS2559 weak-type error, `object` is fine; a conditional spread `...(c.mcq !== undefined ? { mcq: c.mcq } : {})` inside a `Card`-typed literal raises no excess-property error; a test row typed `Card & { mcq?: McqBlob | null }` is assignable to `Card[]`.
- `frontend/src/lib/cardRules.ts` exports are pinned to exactly seven names and its consumer table to `CardForm.tsx` + `deckImport.ts` (`frontend/tests/cardRulesWiring.test.ts:157-167`, `:173-196`). `mcqRules.ts` therefore imports nothing from `cardRules.ts`.
- `frontend/tests/deckImport.test.ts` (625 lines): `toExistingCard` `:40-58` (a full `Card` literal), `contentOf` `:61-72` (explicit field list — a field left out here is invisible to every property), the exact `toEqual` fixture `:87-97` (a Q/A card has NO `mcq` key, so the key must be absent, never `undefined`/`null`), `cardArb` `:477-500`, `deckArb` `:502-509`, the four `deckArb` properties `:514-611` and the line property `:613-624`. The idempotence property `:584-611` models the server rows from `toExistingCard` plus `?? ''` for the optionals (`:595-600`). C06 adds `topic` to `contentOf`, `cardArb` and that server model; you add `mcq` the same way.
- `frontend/tests/deckImportRunner.test.ts`: `ok()` `:19-23` returns `data: null` ("The runner only reads `success` and `error`"); `existingCard` `:85-101`; totals are asserted with `toEqual({ created, updated, failures: [] })` (`:109`, `:247`, `:260`). The guard must never look at the echo of a Q/A card or these eight cases break.
- `docs/delivery-wave-1.6-plan-2026-09-19.md:226-230` is the plan doc's `<!-- paths-not-on-disk -->` block; `:229` registers `frontend/tests/deckImport.mcq.test.ts`. `frontend/tests/docsPaths.test.ts:169-184` (rule b) fails the moment a registered path exists, and that test is part of your own root gate. C00 §6 #12: C11 deletes that one bullet in the same PR. `:115` (the C11 row) also cites the file in backticks; that citation becomes true when you create the file and stays.
- Tooling: `tsconfig.app.json` / `tsconfig.test.json` are `strict` + `noUnusedLocals` + `noUnusedParameters` + `erasableSyntaxOnly` + `verbatimModuleSyntax` (type-only imports must be `import type`); `npm run build` = `tsc -b && vite build` and compiles `tests/` too. `eslint .` lints `tests/` as well (`@typescript-eslint/no-explicit-any` and `no-unused-vars` are errors). `frontend/tests/uiLanguage.test.ts` forbids any Chinese character under `frontend/src/` (comments included) — keep the new source files ASCII; `tests/` is exempt. `frontend/vitest.config.ts` includes `tests/**/*.test.ts` and `tests/**/*.test.tsx` only, `environment: 'node'`, `globals: false` (import `describe`/`it`/`expect` explicitly). fast-check `^4.9.0` (`frontend/package.json:37`; 4.9.0 installed).

What C00 decided (binding; `docs/delivery/r16-issues/C00-contracts.md` §2.11 holds the verbatim signatures repeated in Changes required): the canonical blob shape is §2.9.1 (`{v, options[{key, text, why, correct}], shuffle, qualifier}`); the console type lives in a new `frontend/src/types/mcq.ts` and the rules in a new `frontend/src/lib/mcqRules.ts` (§6 #15 — not in `types/card.ts`, not in `cardRules.ts`); markers are loose `(.*)` regexes checked before `Q:`; the section-key type widens with `` `option:${string}` `` / `` `why:${string}` ``; a repeated `OPT:` key is `MCQ_DUPLICATE_OPTION_KEY`, a second `WHY:` for one option is `DUPLICATE_SECTION`; a bad `OPT:` payload is `MCQ_BAD_OPT_LINE` at that line and the card is dropped; a card with an MCQ marker gets `mcq`, a Q/A card has no key; `'mcq'` is the last `COMPARABLE_FIELDS` entry and compares via `normalizeMcqForCompare` (server `null` == file absent == `''`); the runner sends `mcq: card.mcq ?? null` on create and update and stops with `SERVER_NOT_READY_MCQ`; no `eventType`/schema changes anywhere; the only MCQ example text any test may quote is the two original cards at `docs/mcq-card-type-plan-2026-09-18.md:177-253`.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (`:9-24`, non-negotiables), §1.3 (`:95-116`, your file row and the `:229` note), §2.8.2 (`:411-424`, what C06 already did to the same files), §2.9.1 (`:458-466`, the canonical shape and rules), §2.11 (`:531-568`, every C11 signature), §3.1 C11 sentence (`:670`), §3.2 bullet for `deckImport.mcq.test.ts` (`:685`), §5 (`:725-738`, verify conventions, docsPaths clause), §6 #12 and #15 (`:753`, `:756`).
2. `docs/mcq-card-type-plan-2026-09-18.md` §4 whole (`:154-274`): §4.1 syntax (`:156-164`), §4.3 the two example cards (`:170-256`; the fence is `:172-254`, the cards are `:177-253` — the placeholder header at `:175` is NOT part of any fixture), §4.4 lenient markers (`:258-260`), §4.5 the code list (`:262-266`), §4.6 round trip / diff / runner (`:268-274`). Also §3.6 (`:118-120`, echo is an object) and §3.7 (`:122-124`).
3. `frontend/src/lib/deckImport.ts` whole (684 lines on base; read the C06 version in your worktree): the lexer loop `:289-421`, `openSection` `:268-287`, `finishCard` `:218-261`, `validateCards` `:460-514`, plan `:518-647`, serializer `:655-679`.
4. `frontend/src/lib/deckImportRunner.ts` whole (199 lines).
5. `frontend/tests/deckImport.test.ts` `:1-72` (imports, `EXAMPLE_DOC`, `toExistingCard`, `contentOf`), `:87-97` (the exact fixture), `:451-625` (the arbitraries and the five properties).
6. `frontend/tests/deckImportRunner.test.ts` `:1-130` (fixtures) — copy its `recorder()` pattern (`:38-58`) for the guard tests.
7. `frontend/tests/cardRulesWiring.test.ts:150-196` (why `mcqRules.ts` imports nothing from `cardRules.ts`), `frontend/tests/docsPaths.test.ts:85-200` (the rules your doc edit must satisfy).
8. `docs/delivery-wave-1.6-plan-2026-09-19.md:224-230` (the block you edit) and `:115` (the row that cites your test file).
9. `src_C/Vpc/Authoring/Helpers.cs:50-66` (`BuildUpdateSet`, the silent-drop rationale) and `frontend/src/api/authoring.ts:86-99` (`normalizeCard` passes unknown keys through).

## Constraints

- **Scope (the ONLY files that may change):** `frontend/src/lib/deckImport.ts`, `frontend/src/lib/mcqRules.ts` (new), `frontend/src/types/mcq.ts` (new), `frontend/src/lib/deckImportRunner.ts`, `frontend/tests/deckImport.mcq.test.ts` (new), `frontend/tests/deckImport.test.ts`, `docs/delivery-wave-1.6-plan-2026-09-19.md` (one deleted line). Nothing else: not `frontend/src/types/card.ts`, `frontend/src/api/authoring.ts`, `frontend/src/lib/cardRules.ts`, any file under `frontend/src/pages/` or `frontend/src/components/`, `frontend/tests/deckImportRunner.test.ts`, `frontend/tests/authoringRequestBody.test.ts`, `frontend/tests/support/*`, `frontend/package.json`, `frontend/package-lock.json`, any config file, any other top-level `docs/*.md`, and nothing under `mobile/`, `src_C/`, `snowflake/`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. (You have no reason to open `mobile/` at all.)
- **OTA / dependency rule:** no `npm install`, no dependency or devDependency change in any root; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` untouched. Pure TS.
- **Banned literals in any added line:** the six terms of B00 §0 (the driver greps the diff, case-insensitive; C00 §0 deliberately does not spell them out — use "work around", "sidestep", "sensor", "guard", "probe", "fallback"). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff. No `any`.
- **MCQ example text:** the ONLY MCQ card text any test or fixture may contain verbatim is the two cards at `docs/mcq-card-type-plan-2026-09-18.md:177-253`. Every other fixture is synthetic (short invented lines, fast-check words). Never copy any exam dump. Keep `frontend/src/**` free of Chinese characters.
- **Existing tests:** `frontend/tests/deckImport.test.ts` changes only as Change 6 says (`contentOf`, `cardArb`, the server-row model; every `it('…'` title byte-identical — the verify diffs the title set against the base). `frontend/tests/deckImportRunner.test.ts`, `frontend/tests/cardRulesWiring.test.ts`, `frontend/tests/authoringRequestBody.test.ts` and every other existing test are byte-identical and must stay green (the guard never inspects a Q/A echo; `mcq: null` in the params is invisible to `toMatchObject`).
- **`mcqRules.ts` is pure:** no `react`, no `import` from `./cardRules` (the consumer table at `cardRulesWiring.test.ts:173-196` would go red), only `import type { McqBlob, McqOption } from '../types/mcq'`. `types/mcq.ts` has no imports at all.
- **The plan doc edit is exactly one deleted line** (`docs/delivery-wave-1.6-plan-2026-09-19.md:229`); `git diff --numstat` for that file prints `0	1`. Do not renumber, reflow or touch anything else in that doc; keep the block (its other bullet `docs/design/v10-ceremony-seam-of-light.md` stays registered — that path is not on disk).
- **No new export from `authoring.ts`, no new page, no hook** (`tests/apiSurfaceCensus.test.ts`, `tests/consoleDirectoryLayout.test.ts:97`, `tests/hookWiring.test.ts` are census tests in your gate).
- The interim behaviour until C12 merges is intended: `authoring.ts`'s `createCard`/`updateCard` do not yet forward `mcq`, so an MCQ import through the real page stops at the first MCQ card with `SERVER_NOT_READY_MCQ`. Do not "fix" that by editing `authoring.ts`.

## Changes required

1. **`frontend/src/types/mcq.ts` (new, no imports)** — verbatim from C00 §2.11:
   ```ts
   // src/types/mcq.ts
   //
   // The console's copy of the canonical MCQ blob (C00 §2.9.1, MCQ plan §3.2).
   // `key` is a stable id a-f, never a display letter; requiredCount is derived
   // from the number of correct options and is not stored.
   export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
   export interface McqBlob { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
   ```
   Both interface lines byte-for-byte as above (the verify greps them).

2. **`frontend/src/lib/mcqRules.ts` (new, pure)** — exports, verbatim where C00 pins them:
   ```ts
   import type { McqBlob } from '../types/mcq';

   export type McqIssueCode =
     | 'MCQ_BAD_OPT_LINE' | 'MCQ_QUALIFIER_EMPTY' | 'MCQ_QUALIFIER_IS_CHOOSE_N' | 'MCQ_TOO_FEW_OPTIONS' | 'MCQ_TOO_MANY_OPTIONS'
     | 'MCQ_KEY_SEQUENCE' | 'MCQ_DUPLICATE_OPTION_KEY' | 'MCQ_OPTION_EMPTY' | 'MCQ_OPTION_TEXT_DUPLICATE' | 'MCQ_NO_CORRECT'
     | 'MCQ_TOO_MANY_CORRECT' | 'MCQ_ALL_CORRECT' | 'MCQ_WHY_MISSING' | 'MCQ_WHY_WITHOUT_OPTION' | 'MCQ_FORBIDDEN_OPTION_TEXT'
     | 'MCQ_LETTER_REFERENCE' | 'MCQ_QUALIFIER_NOT_IN_STEM' | 'MCQ_CHOOSE_N_MISMATCH' | 'MCQ_DIFFICULTY_RANGE';
   export const OPT_PAYLOAD = /^[ \t]*([A-Fa-f])[ \t]*(\*)?[ \t]*$/;
   export const LETTER_REFERENCE = /\b(?:Option|Answer|Choice)\s+[A-F]\b|\b[A-F]\)\s/;
   export const FORBIDDEN_OPTION_TEXT = /\b(all|none) of the above\b|\bboth [a-f] and [a-f]\b/i;
   export const CHOOSE_N_STEM = /\(choose (two|three)\.?\)/i;
   export const QUALIFIER_IS_CHOOSE_N = /choose (two|three)/i;
   export const MCQ_MIN_OPTIONS = 3;
   export const MCQ_MAX_OPTIONS = 6;
   export const MCQ_MAX_CORRECT = 3;
   export interface McqIssue { code: McqIssueCode; message: string }
   export function validateMcq(input: { question: string; explanation: string; difficulty: number; mcq: McqBlob }): Array<{ code: McqIssueCode; message: string }>;
   export function normalizeMcqForCompare(mcq: McqBlob | null | undefined): string;
   export function mcqOf(row: object | null | undefined): McqBlob | null;
   ```
   The three regex lines and the `McqIssueCode` union are byte-for-byte as printed (line breaks inside the union may differ; every code literal must appear). `LETTER_REFERENCE` has no `i` flag on purpose: "answer a question" must not match (pinned in tests); `Option B`, `Answer C`, `Choice D`, `B) text` do.
   - `validateMcq` is total (never throws) and returns issues in this check order, each code at most once per blob unless noted; messages are free-form English that name the option key or the offending phrase:
     1. `MCQ_DIFFICULTY_RANGE` — `!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3`.
     2. `MCQ_TOO_FEW_OPTIONS` — `options.length < MCQ_MIN_OPTIONS`; `MCQ_TOO_MANY_OPTIONS` — `> MCQ_MAX_OPTIONS`.
     3. `MCQ_DUPLICATE_OPTION_KEY` — a key occurs twice (once per repeated key). Only when there is no duplicate: `MCQ_KEY_SEQUENCE` — `options[i].key !== String.fromCharCode(97 + i)` for some `i` (keys must be `a`, `b`, `c`… consecutive from `a` in stored order, lowercase).
     4. Per option, in stored order: `MCQ_OPTION_EMPTY` (`text.trim() === ''`), `MCQ_FORBIDDEN_OPTION_TEXT` (`FORBIDDEN_OPTION_TEXT.test(text)`), `MCQ_WHY_MISSING` (`!correct && (why === null || why.trim() === '')`), `MCQ_LETTER_REFERENCE` (`why !== null && LETTER_REFERENCE.test(why)`).
     5. `MCQ_OPTION_TEXT_DUPLICATE` — two options share `text.trim().toLowerCase()` (once per repeated text).
     6. `requiredCount = options.filter((o) => o.correct).length`: `MCQ_NO_CORRECT` (0), `MCQ_TOO_MANY_CORRECT` (`> MCQ_MAX_CORRECT`), `MCQ_ALL_CORRECT` (`requiredCount === options.length && options.length > 0`).
     7. `MCQ_LETTER_REFERENCE` on `explanation` (`LETTER_REFERENCE.test(explanation)`).
     8. Qualifier, when `mcq.qualifier !== null`: `MCQ_QUALIFIER_EMPTY` (`qualifier.trim() === ''`); otherwise `MCQ_QUALIFIER_IS_CHOOSE_N` (`QUALIFIER_IS_CHOOSE_N.test(qualifier)`); otherwise `MCQ_QUALIFIER_NOT_IN_STEM` (`!question.toLowerCase().includes(qualifier.trim().toLowerCase())`).
     9. `MCQ_CHOOSE_N_MISMATCH` — `stemN` = 2 / 3 when `CHOOSE_N_STEM` matches `question` (`two` → 2, `three` → 3), else 1; reported when `requiredCount` is 1, 2 or 3 and `requiredCount !== stemN` (a 0 or > 3 count is already reported by step 6). Both directions: "(Choose two.)" with one star and two stars without the phrase.
     `MCQ_BAD_OPT_LINE` and `MCQ_WHY_WITHOUT_OPTION` are lexer-only (Change 3) and are never returned by `validateMcq`; they are in the union so `ImportIssueCode` can carry them.
   - `normalizeMcqForCompare(mcq)`: `null`/`undefined` → `''`; otherwise `JSON.stringify` of `{ options, qualifier, shuffle }` written in that (alphabetical) key order with `v` dropped, where `options` is a copy sorted by `key` (`localeCompare` is fine for a-f; do not mutate the input) and each option is `{ correct, key, text: text.trim(), why: why === null || why.trim() === '' ? null : why.trim() }` in that key order, and `qualifier` is `qualifier === null ? null : qualifier.trim()`. Two blobs that differ only in spacing, option order, `v`, or a `why` of `''` vs `null` normalize to the same string.
   - `mcqOf(row)`: `null` for a falsy row; otherwise `const value = (row as { mcq?: unknown }).mcq;` and `typeof value === 'object' && value !== null ? (value as McqBlob) : null`. This is the one place the console reads the wire key without `Card.mcq` (C12 types it; MCQ plan §3.6: no defensive parsing of a canonical echo). The parameter type is `object | null | undefined` — not `{ mcq?: unknown }`, which is a TS2559 weak-type error for a `Card` argument.
   - A doc comment on `McqIssueCode` says the 19 codes are MCQ plan §4.5's list and that `MCQ_DUPLICATE_QUALIFIER` lives on `ImportIssueCode` in `deckImport.ts`.

3. **`frontend/src/lib/deckImport.ts` — lexer, types, validate, plan, serialize.** Build on the C06 version in your worktree.
   a. Imports: `import type { McqBlob } from '../types/mcq';` and `import { validateMcq, OPT_PAYLOAD, type McqIssueCode } from './mcqRules';` (keep the existing `cardRules` import exactly as it is).
   b. Types: `DeckCardContent` gains `mcq?: McqBlob;` as its LAST field, after C06's `topic?: string;` — optional, and ABSENT (not `undefined`, not `null`) on a Q/A card, so `deckImport.test.ts:87-97` stays byte-identical. `ImportIssueCode` becomes `… | 'BAD_TOPIC' | 'DUPLICATE_TOPIC' | McqIssueCode | 'MCQ_DUPLICATE_QUALIFIER'` (append the two members after C06's). `ComparableField` gains `| 'mcq'` last (its final line is exactly `  | 'mcq';`, the existing two-space union style); `COMPARABLE_FIELDS` ends `…, 'realWorldUsage', 'topic', 'mcq',` (`'mcq'` LAST — the verify extracts the array and checks it ends with `'topic','mcq'`).
   c. Markers, next to the existing six (`:136-141`), verbatim:
      ```ts
      const OPT_MARKER = /^OPT:(.*)$/;
      const WHY_MARKER = /^WHY:(.*)$/;
      const QUALIFIER_MARKER = /^QUALIFIER:(.*)$/;
      ```
      Column 0 only (rule 1 of the file header), loose on purpose (MCQ plan §4.4): recognition is lenient, the payload is validated by `OPT_PAYLOAD`.
   d. Section keys: `type SectionKind = 'question' | 'answer' | 'code' | 'usage' | `` `option:${string}` `` | `` `why:${string}` ``;` (a template-literal union; `Partial<Record<SectionKind, Section>>` keeps compiling — verified with this repo's `tsc`). `CardDraft` gains
      ```ts
      /** null until the first OPT:/WHY:/QUALIFIER: line. A card that never sees one is a Q/A card and gets no `mcq` key. */
      mcq: McqDraft | null;
      /** Set by MCQ_BAD_OPT_LINE: finishCard drops the card and reports nothing further for it. */
      dropped: boolean;
      ```
      with `interface McqDraft { qualifier: string | null; qualifierSeen: boolean; options: Array<{ key: string; correct: boolean }>; lastOptionKey: string | null }`. Initialise `mcq: null, dropped: false` where the draft is built (`:336-342`); a small `ensureMcq(draft)` helper creates the `McqDraft` on first use.
   e. `openSection`: when `draft.sections[kind]` already exists and `kind` starts with `option:`, push `MCQ_DUPLICATE_OPTION_KEY` (line, message names the key, `stableUid`) instead of `DUPLICATE_SECTION`; every other kind (including `why:<key>`) keeps `DUPLICATE_SECTION` exactly as today (first wins, `swallowing = true`, return `null`). The message template for a `why:` kind may stay the generic `repeats the ${kind} section`.
   f. Loop: insert three branches immediately after C06's `TOPIC:` branch and before `const questionMatch = QUESTION_MARKER.exec(raw);` (`:383` on base). Each ends with `continue;`.
      - `QUALIFIER:` — single-line, does not touch `currentSection` (same as `TOPIC:`). `payload = qualifierMatch[1].trim()`. If `mcq.qualifierSeen` → `pushIssue('MCQ_DUPLICATE_QUALIFIER', lineNo, …, draft.stableUid)` and keep the first. Else `mcq.qualifier = payload` (an empty payload is stored as `''` so `validateMcq` reports `MCQ_QUALIFIER_EMPTY`), `mcq.qualifierSeen = true`.
      - `OPT:` — `const payload = OPT_PAYLOAD.exec(optMatch[1]);`. No match → `pushIssue('MCQ_BAD_OPT_LINE', lineNo, `Card "${uid}": OPT: must be "OPT: <a-f>" or "OPT: <a-f> *" on its own line, got "${raw.trimEnd()}".`, uid)`, then `draft.dropped = true; currentSection = null; swallowing = true;` — the line is never appended to the open section and the body that follows is swallowed silently. Match → `key = payload[1].toLowerCase()`, `correct = payload[2] === '*'`; `currentSection = openSection(`option:${key}`, lineNo, '')`; when it returned a section push `{ key, correct }` onto `mcq.options`; set `mcq.lastOptionKey = key` in both cases. Uppercase keys are accepted and normalised (MCQ plan §4.1).
      - `WHY:` — if `mcq === null || mcq.lastOptionKey === null` → `pushIssue('MCQ_WHY_WITHOUT_OPTION', lineNo, …, uid)`, `currentSection = null; swallowing = true;` (the orphan body must not raise `TEXT_BEFORE_SECTION`). Else `currentSection = openSection(`why:${mcq.lastOptionKey}`, lineNo, whyMatch[1].replace(/^[ \t]/, ''))` — the first-line payload is treated exactly like `Q:`'s (`Q:[ \t]?(.*)`): one optional leading blank stripped, pushed when non-blank.
      All three call `ensureMcq(draft)` first (a `WHY:`-only or `QUALIFIER:`-only card is an MCQ card with zero options; `validateMcq` then reports `MCQ_TOO_FEW_OPTIONS` etc. — nothing an author typed vanishes silently).
   g. `finishCard`: first thing after `draft = null; currentSection = null;` → `if (d.dropped) return;`. After the existing Q/A checks build the blob when `d.mcq !== null`:
      ```ts
      const mcq: McqBlob | null = d.mcq
        ? {
            v: 1,
            qualifier: d.mcq.qualifier,
            shuffle: true,
            options: d.mcq.options.map((o) => ({
              key: o.key,
              text: sectionText(d.sections[`option:${o.key}`]),
              why: sectionText(d.sections[`why:${o.key}`]) || null,
              correct: o.correct,
            })),
          }
        : null;
      ```
      and push the card with `...(mcq ? { mcq } : {})` after `sourceLine` (key absent on Q/A cards). `shuffle` is always `true` (the format has no marker for it); `v` is always `1`.
   h. `validateCards`: after the existing per-card checks, `if (card.mcq) for (const issue of validateMcq({ question: card.question, explanation: card.explanation, difficulty: card.difficulty, mcq: card.mcq })) issues.push({ code: issue.code, line: card.sourceLine, message: issue.message, stableUid: card.stableUid });`. Because `validateCards` is also what `planImport` re-runs (`:566-570`), every MCQ issue blocks as an `INVALID_CARD` conflict and, through `parsed.errors`, at the page (`DeckImportPage.tsx:224-230`). The Q/A difficulty range 0–4 (`isValidDifficulty`) is untouched; MCQ cards get the narrower 1–3 from `MCQ_DIFFICULTY_RANGE`.
   i. `fieldsThatDiffer`: a branch before the text branch — `if (field === 'mcq') { if (normalizeMcqForCompare(card.mcq) !== normalizeMcqForCompare(mcqOf(existing))) changed.push(field); continue; }` (import `normalizeMcqForCompare` and `mcqOf` from `./mcqRules`). Server `null`, a missing key on an old server and file absence all normalize to `''`.
   j. `serializeDeckMarkdown`: per card, in this order — header; `TOPIC: …` (C06, when set); `QUALIFIER: ${card.mcq.qualifier}` when `card.mcq && card.mcq.qualifier !== null`; `Q:` + question; when `card.mcq`, for each option in stored order `OPT: ${key}` or `OPT: ${key} *` (exactly one space before `*`), the option text, then `WHY:` + `why` when `why !== null`; `A:` + explanation; `CODE:`; `USAGE:`; blank line. Update the header comment of the file (`:6-18`) with the three markers in the format sketch.
   k. Update the `TEXT_BEFORE_SECTION` message only if you want; it is not pinned. Do not touch `SLUG_PATTERN`, `sortIssues`, `formatIssue`, `planImport`'s conflict logic or the seven existing marker regexes.

4. **`frontend/src/lib/deckImportRunner.ts`.**
   a. `import type { McqBlob } from '../types/mcq';` and `import { mcqOf } from './mcqRules';`. `CreateCardParams` and `UpdateCardParams` each gain `mcq?: McqBlob | null;` as their last member (after C06's `topic?: string;`).
   b. `createParamsFor` adds `mcq: card.mcq ?? null,` and `updateParamsFor` adds `mcq: action.card.mcq ?? null,` (both after the `topic` line C06 added). Always present, explicit `null` on Q/A cards — an update that removed the options must clear the column, and `Helpers.cs:58` treats an absent key as "leave it alone". Extend the design-choice comment (`:18-22`) with one sentence saying so.
   c. `export const SERVER_NOT_READY_MCQ = 'SERVER_NOT_READY_MCQ';` next to the `VERSION_CONFLICT` re-export (`:92`).
   d. `describeFailure`: a second branch — `if (failure.code === SERVER_NOT_READY_MCQ) return 'The server is not ready for MCQ cards (migration 019 / Lambda not deployed); nothing after this card was written.';` (that sentence verbatim; the verify greps it).
   e. Readiness guard in `runImport`: keep the loop serial but index-aware (`for (const [index, action] of actions.entries())` or a counter). Add `let mcqProbed = false;` before the loop. Inside `if (outcome.success) {` and BEFORE the counters are incremented:
      ```ts
      if (!mcqProbed && action.card.mcq !== undefined) {
        mcqProbed = true;
        if (mcqOf(outcome.data) === null) {
          // The write succeeded but the echo has no mcq: the API in front of us
          // predates migration 019 / C08 and stored a Q/A card. Stop here so a
          // wrong deployment order costs one card, not the rest of the file.
          result.failures.push({ action, stableUid: action.card.stableUid, code: SERVER_NOT_READY_MCQ, message: `The server stored "${action.card.stableUid}" without its options.` });
          for (const skipped of actions.slice(index + 1)) {
            result.failures.push({ action: skipped, stableUid: skipped.card.stableUid, code: SERVER_NOT_READY_MCQ, message: `Not written: "${skipped.card.stableUid}" was skipped after the MCQ readiness check failed.` });
          }
          done += 1;
          onProgress?.({ done, total, current: action });
          return result;
        }
      }
      ```
      The tripping action is NOT counted in `created`/`updated`; it and everything after it sit in `failures` so the page's failure list and "Retry N failed" button show them (`DeckImportPage.tsx:556-583`) with no page change. The probe runs once per run, only on the first action whose `card.mcq` is set; a run without MCQ cards never reads `outcome.data` (the existing fixtures return `data: null`). `ImportRunResult` gains no field.

5. **`frontend/tests/deckImport.mcq.test.ts` (new; `describe`/`it`/`expect` imported from `vitest`, `fc` from `fast-check`).** Fixtures: `EXAMPLE_MCQ_DOC` = `# deck: aws-associate-architect`, a blank line, then the two cards copied verbatim from `docs/mcq-card-type-plan-2026-09-18.md:177-253` (NOT `:173-175`); synthetic docs built with a small `doc(...lines)` helper; a `writer` recorder in the style of `deckImportRunner.test.ts:38-58` whose echo is configurable (`data: null`, a `Card & { mcq?: McqBlob | null }` row without `mcq`, or one with the canonical blob). `mcqArb` generates only VALID cards: `n ∈ [3, 6]` options with keys `a…`, texts drawn from the `WORDS`/`lineArb` vocabulary of `deckImport.test.ts:453-462` and unique per card, `required ∈ [1, min(3, n - 1)]` correct options chosen as a subarray of the indices, `why` = a non-empty line for every wrong option and `fc.option(lineArb, { nil: null })` for correct ones, `qualifier` = `fc.option(fc.constantFrom('LEAST operational overhead', 'MOST cost-effective'), { nil: null })`, `difficulty ∈ [1, 3]`, `shuffle: true`, `v: 1`; the question is the generated stem plus (when a qualifier is set) a sentence containing it and (when `required` is 2 / 3) the suffix `(Choose two.)` / `(Choose three.)`, so `validateMcq` returns `[]` for every generated card (assert that inside the property). Cases, each its own `it`, titles verbatim:
   - `describe('parseDeckMarkdown: the two example cards of MCQ plan §4.3')`
     1. `it('parses the single-answer example card: options a-d, correct b, qualifier set', …)` — `aws-sqs-order-buffer-mcq-01`: `difficulty 2`, `mcq.options.map(o => o.key)` is `['a','b','c','d']`, correct keys `['b']`, `qualifier === 'LEAST operational overhead'`, `options[1].why === null`, `options[0].why` starts with `Vertical scaling`, `shuffle === true`, `v === 1`, `realWorldUsage` starts with `In my own checkout`.
     2. `it('parses the choose-two example card: options a-e, correct a and c, no qualifier', …)` — keys `a-e`, correct `['a','c']`, `qualifier === null`, `realWorldUsage === null`, `difficulty 3`.
     3. `it('reports no issues for the example document', …)` — `errors` is `[]` and `validateMcq` on both cards returns `[]`.
     4. `it('leaves the mcq key absent on Q/A cards in the same document', …)` — a doc with one Q/A card and one MCQ card: `'mcq' in cards[0]` is `false`, `cards[1].mcq` is defined; `planImport` against `[]` creates both.
   - `describe('lenient markers, strict payloads')`
     5. `it('reports a mistyped OPT: line as MCQ_BAD_OPT_LINE at that line and drops the card', …)` — three sub-documents: `OPT: g`, `OPT: a Increase the instance size`, `OPT: A)`; each yields exactly one issue with code `MCQ_BAD_OPT_LINE`, `line` equal to that line's 1-based number and `stableUid` set; `cards` is `[]`.
     6. `it('never glues a mistyped OPT: line into the open section', …)` — the `Q:` text of the surviving parse of a sibling card is unchanged and no card's `question`/`explanation`/option text contains `OPT:`; the body after the bad line raises no `TEXT_BEFORE_SECTION`.
     7. `it('accepts an uppercase key and normalizes it to lowercase', …)` — `OPT: B *` → key `'b'`, `correct true`.
     8. `it('reports a WHY: before any OPT: as MCQ_WHY_WITHOUT_OPTION', …)` — code present at the `WHY:` line; no `TEXT_BEFORE_SECTION`.
     9. `it('reports a second QUALIFIER: as MCQ_DUPLICATE_QUALIFIER and keeps the first', …)`.
     10. `it('reports a repeated OPT: key as MCQ_DUPLICATE_OPTION_KEY, not DUPLICATE_SECTION', …)` — first body wins.
     11. `it('reports a second WHY: for one option as DUPLICATE_SECTION and keeps the first', …)`.
   - `describe('validateMcq')`
     12. `it('produces every McqIssueCode from at least one positive case', …)` — a `Record<McqIssueCode, …>` literal (TypeScript makes it exhaustive: all 19 keys or it does not compile) mapping each code to either a Markdown document (parse-level, asserted through `parseDeckMarkdown(...).errors`) or a direct `validateMcq` input for the codes the lexer cannot reach (`MCQ_TOO_MANY_OPTIONS` — `OPT_PAYLOAD` stops at `f`, so a 7-option blob is hand-built); assert every entry yields its code and that `Object.keys(table).length === 19`.
     13. `it('does not flag "answer a question" as a letter reference', …)` — `LETTER_REFERENCE.test('answer a question')` is `false`; `'Option B'`, `'B) text'` are `true`; an explanation of `We answer a question here.` yields no `MCQ_LETTER_REFERENCE`.
     14. `it('checks choose-N in both directions', …)` — one star with `(Choose two.)` and two stars without it both give `MCQ_CHOOSE_N_MISMATCH`; two stars with `(Choose two.)` gives none.
     15. `it('blocks an invalid MCQ card through validateCards and planImport as INVALID_CARD', …)` — e.g. a `d4` MCQ card: `validateCards` carries `MCQ_DIFFICULTY_RANGE` with the header line and uid; `planImport` lists the card under `conflicts` with `reason 'INVALID_CARD'`, nothing under `creates`.
   - `describe('round trip and reconciliation')`
     16. `it('round trips: serialize then parse returns every MCQ field unchanged', …)` — `fc.assert` over `mcqArb` decks (1–4 cards, unique uids): `parseDeckMarkdown(serializeDeckMarkdown(slug, cards))` has no errors and its content (including `mcq`, deep) equals the input.
     17. `it('serializes QUALIFIER: before Q: and OPT:/WHY: between the question and A:', …)` — on the first example card the serialized lines contain, in order: `## aws-sqs-order-buffer-mcq-01 | d2`, `QUALIFIER: LEAST operational overhead`, `Q:`, …, `OPT: a`, …, `WHY:`, …, `OPT: b *`, …, `A:`; and `serialize(parse(EXAMPLE_MCQ_DOC))` re-parses to the same content.
     18. `it('re-planning the serialized document against rows built from it is all unchanged', …)` — property: rows = `Card & { mcq?: McqBlob | null }` built from the parsed cards (`mcq: card.mcq ?? null`, optionals `?? ''`); `planImport` is all `unchanged`; the same rows with `mcq: null` on an MCQ card give exactly one update whose `changedFields` is `['mcq']`.
     19. `it('normalizeMcqForCompare treats server null and file absence alike and ignores spacing, key order and v', …)` — `''` for `null`/`undefined`; equal strings for an option list in reversed order, `why: ''` vs `null`, padded text; the first example card's blob equals a hand-written copy with the keys in PG order (`v, options, shuffle, qualifier` / `key, why, text, correct`).
   - `describe('runImport readiness guard')`
     20. `it('stops after the first MCQ write whose echo lacks mcq and lists the rest as SERVER_NOT_READY_MCQ', …)` — doc: Q/A card, the two example MCQ cards, a trailing Q/A card; echo rows without `mcq`; `result.created === 1`, `failures.map(f => f.stableUid)` is `[mcq-01, mcq-02, trailing]`, every code `SERVER_NOT_READY_MCQ`, the writer saw exactly two calls, the last `onProgress` had `done === 2`.
     21. `it('continues when the echo carries an mcq object', …)` — same doc, echo `{ ...row, mcq: <the canonical blob> }`: `created === 4`, `failures === []`, `creates[1].mcq` is the blob and `creates[0].mcq === null`.
     22. `it('never inspects the echo of a Q/A-only run', …)` — a two-card Q/A doc with `data: null` echoes: `failures === []`, `created === 2`.
     23. `it('describeFailure names the server readiness problem', …)` — returns the exact sentence of Change 4d; `describeFailure` for another code still returns `failure.message`.
   Use `expect(...).toEqual` for deep content; no snapshots; no `.only`/`.skip`.

6. **`frontend/tests/deckImport.test.ts` — three small edits, nothing else.**
   a. `contentOf` (`:61-72`): add `...(card.mcq !== undefined ? { mcq: card.mcq } : {})` after C06's `topic` spread, so the properties see `mcq`.
   b. `cardArb` (`:477-500`): add an optional branch — a local `mcqArb` (same construction as Change 5; a copy is fine — `tests/support/` is out of scope) wrapped in `fc.option(mcqArb, { nil: null })`; in the `.map`, when the branch is present, override `difficulty` (1–3) and `question` (stem + qualifier sentence + choose-N suffix) and spread `mcq`; when absent, emit exactly today's object (no `mcq` key). Import `type McqBlob` from `../src/types/mcq` and `validateMcq` from `../src/lib/mcqRules` only if you use them here.
   c. The server-row model of the idempotence property (`:595-600`) — or `toExistingCard` (`:40-58`), whichever C06 used for `topic` — gains `...(card.mcq !== undefined ? { mcq: card.mcq } : {})` (a conditional spread compiles against the `Card` annotation; do not add `mcq` as a written property).
   Every `it('…'` title in the file stays byte-identical (the verify compares the whole title set against the merge-base and pins these seven by name: `reads every card field`, `lists every changed field for the preview`, `round trips: serialize then parse returns every field unchanged`, `blank lines and CRLF anywhere do not change the parse result`, `any document with a repeated uid is rejected`, `planImport is idempotent and calls identical content unchanged`, `every reported issue points at a real line`); the `:87-97` fixture is untouched.

7. **`docs/delivery-wave-1.6-plan-2026-09-19.md`** — delete line `:229` (`     - frontend/tests/deckImport.mcq.test.ts`) from the `<!-- paths-not-on-disk -->` block. Nothing else in the file; the block keeps its other bullet.

Estimated size: `mcqRules.ts` ~170 lines, `types/mcq.ts` ~8, `deckImport.ts` +~120, `deckImportRunner.ts` +~30, new test ~450, shared test +~40, doc −1.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C11.verify.sh` re-runs exactly these.

1. Scope files exist: `frontend/src/lib/mcqRules.ts`, `frontend/src/types/mcq.ts`, `frontend/tests/deckImport.mcq.test.ts` (fail on the base tree); `frontend/src/lib/deckImport.ts` carries C06's `TOPIC_MARKER` line and `'DUPLICATE_TOPIC'`, and `deckImportRunner.ts` carries C06's `topic: optionalText(card.topic ?? null),` (prerequisite — C06 merged).
2. Literal guards:
   - `types/mcq.ts`: both interface lines verbatim; no `import` at all.
   - `mcqRules.ts`: `export type McqIssueCode` with all 19 code literals and NOT `'MCQ_DUPLICATE_QUALIFIER'`; the three regex lines verbatim; `export const CHOOSE_N_STEM` / `QUALIFIER_IS_CHOOSE_N` / `MCQ_MIN_OPTIONS` / `MCQ_MAX_OPTIONS` / `MCQ_MAX_CORRECT`; `export function validateMcq(`, `export function normalizeMcqForCompare(`, `export function mcqOf(`; `import type { McqBlob` … `from '../types/mcq'` is its only import; no `cardRules`, no `react`, no `require(`.
   - `deckImport.ts`: the three marker lines verbatim; `  mcq?: McqBlob;` (never `McqBlob | null`); `'MCQ_DUPLICATE_QUALIFIER'` and `McqIssueCode` in `ImportIssueCode`; imports from `'../types/mcq'` and `'./mcqRules'`; `` `option:${string}` `` and `` `why:${string}` ``; `McqDraft`, `dropped: boolean`, `d.dropped`; `'MCQ_BAD_OPT_LINE'`, `'MCQ_WHY_WITHOUT_OPTION'`, `'MCQ_DUPLICATE_OPTION_KEY'`; `validateMcq(`, `normalizeMcqForCompare(`, `mcqOf(`, `OPT_PAYLOAD.exec(`, `shuffle: true`, `v: 1`; the conditional spread `...(mcq ? { mcq } : {})`; `ComparableField` ends with `  | 'mcq';` and `COMPARABLE_FIELDS` ends with `'topic', 'mcq'`; in the lexer the first `QUALIFIER_MARKER.exec(` / `OPT_MARKER.exec(` / `WHY_MARKER.exec(` lines sit after `TOPIC_MARKER.exec(` and before `QUESTION_MARKER.exec(`; inside `serializeDeckMarkdown`, counting `out.push(` lines only, the header push < `QUALIFIER: ${` < `out.push('Q:')` < `OPT: ${` < `out.push('A:')` and a `WHY:` push < `out.push('A:')`.
   - `deckImportRunner.ts`: `export const SERVER_NOT_READY_MCQ = 'SERVER_NOT_READY_MCQ';`; the describeFailure sentence verbatim; exactly two lines `  mcq?: McqBlob | null;`; `mcq: card.mcq ?? null,`; `mcq: action.card.mcq ?? null,`; `mcqOf(outcome.data)`; `import { mcqOf } from './mcqRules'`; `import type { McqBlob } from '../types/mcq'`; `mcqProbed`; no word `aborted`.
   - `deckImport.mcq.test.ts`: `from 'fast-check'`, `fc.assert(`, `mcqArb`, `aws-sqs-order-buffer-mcq-01`, `aws-s3-compliance-copy-mcq-02`, `answer a question`, `SERVER_NOT_READY_MCQ`, `runImport`, `describeFailure`, `validateMcq`, `normalizeMcqForCompare`, `LETTER_REFERENCE`, `LEAST operational overhead`; not the placeholder header `现有 154` (MCQ plan `:175`); all 23 `it('…'` titles of Change 5 verbatim and ≥ 23 `it(` blocks.
   - `deckImport.test.ts`: mentions `mcq`, contains `...(card.mcq !== undefined ? { mcq: card.mcq } : {}),` and `mcqArb`; the `reads every card field` block has no `mcq`; ≥ 46 `it(` blocks and the seven pinned titles present (the full title-set equality against the merge-base runs in step 5).
   - No `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in the six TS scope files; no CJK character in the four `frontend/src` scope files.
   - Plan doc: exactly one `<!-- paths-not-on-disk -->` block; it no longer lists `frontend/tests/deckImport.mcq.test.ts` and still lists `docs/design/v10-ceremony-seam-of-light.md`; `:115` still cites `` `frontend/tests/deckImport.mcq.test.ts` ``.
3. `cd frontend && npm run lint && npm run build` — exit 0 (`tsc -b` compiles `tests/` too).
4. `cd frontend && npx vitest run tests/deckImport.mcq.test.ts tests/deckImport.test.ts tests/deckImportRunner.test.ts tests/cardRulesWiring.test.ts tests/docsPaths.test.ts tests/rootReadmePaths.test.ts tests/uiLanguage.test.ts tests/apiSurfaceCensus.test.ts tests/consoleDirectoryLayout.test.ts tests/hookWiring.test.ts --reporter=dot` — exit 0; plus a python reproduction of `docsPaths` rules (a) cited-exists-or-registered and (b) registered-must-not-exist over `docs/delivery-wave-1.6-plan-2026-09-19.md`.
5. Scope + frozen guard (against `git merge-base HEAD $BASE_REF`): zero-diff on the three frozen mobile files, `frontend/src/types/card.ts`, `frontend/src/api/authoring.ts`, `frontend/src/lib/cardRules.ts`, `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/hooks/`, `frontend/tests/deckImportRunner.test.ts`, `frontend/tests/authoringRequestBody.test.ts`, `frontend/tests/cardRulesWiring.test.ts`, `frontend/tests/deckImport.topic.test.ts`, `frontend/tests/support/`, the frontend config files (`package.json`, `package-lock.json`, `vitest.config.ts`, `eslint.config.js`, the four `tsconfig*.json`), `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no top-level `docs/*.md` other than the plan doc changed, the plan doc's numstat is `0	1` and its one removed line is `     - frontend/tests/deckImport.mcq.test.ts`; `deckImport.test.ts`'s `it('…'` title set equals the merge-base's; `git diff --name-only` ∪ the pathspec-scoped untracked scan of `frontend/src frontend/tests docs` ⊆ the seven scope files + `docs/delivery/r16-issues/*`. The six banned terms are checked by the driver's diff-scoped gate, not by the script.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C11.verify.sh
```
Runtime ~30 s (lint ~4 s, `tsc -b` + vite ~10 s, targeted vitest ~2 s). The driver then runs the full frontend root gate (`cd frontend && npm run lint && npx vitest run && npm run build`), the diff-scoped banned-term grep and the suppression scan on top; the verify never repeats the whole suite.

## Do NOT

- Do NOT edit `frontend/src/types/card.ts` (C12 adds `mcq?`), `frontend/src/api/authoring.ts` (C12 forwards `mcq`), `frontend/src/lib/cardRules.ts`, any page or component, or `frontend/tests/deckImportRunner.test.ts`.
- Do NOT add a warning tier, an `aborted` field on `ImportRunResult`, a new `ImportIssue` field, or an `mcq` marker for `shuffle`.
- Do NOT create `frontend/tests/support/*` or any shared arbitrary module; duplicate the small `mcqArb` instead.
- Do NOT quote MCQ text other than the two cards at `docs/mcq-card-type-plan-2026-09-18.md:177-253`; never paste exam-dump content.
- Do NOT put Chinese characters in `frontend/src/**`; do NOT use `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- Do NOT touch any other top-level `docs/*.md`, `mobile/**`, `src_C/**`, `snowflake/**`; do NOT run `npm install`, `npm ci`, `git push`, open a PR, or touch `main` or the shared checkout `/Users/qc/src/recallsmith`.

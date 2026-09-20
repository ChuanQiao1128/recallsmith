# C06 — L2b topic console (`topic-console`)

The console learns the card `topic` that C05 added to the server: the markdown importer gains a single-line `TOPIC:` marker (loose match, strict payload, max 80 chars), `topic` joins `COMPARABLE_FIELDS` as the LAST entry, `serializeDeckMarkdown` emits `TOPIC:` directly under the card header so `parse(serialize(x))` deep-equals `x`, the import runner sends `topic` on every create/update (empty string clears, like the other optionals), `Card`/`createCard`/`updateCard` carry `topic`, and a new test file pins all of it. Pure TS under `frontend/src` + `frontend/tests`; no page, no form, no docs, no dependency.

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`; every line read 2026-09-21):

- `frontend/src/lib/deckImport.ts` (684 lines). `DeckCardContent` `:36-44` has seven fields and no `topic`; `ParsedCard` `:46-51` adds `orderInDeck`/`sourceLine`. `ImportIssueCode` `:53-66` ends with `'TEXT_BEFORE_SECTION'`. `ComparableField` `:91-98` ends with `'realWorldUsage'`. Marker regexes `:136-141` (`QUESTION_MARKER` … `USAGE_MARKER`, all column 0). `CardDraft` `:164-170` (`headerLine, stableUid, difficulty, sections, codeLanguage`). `finishCard` `:218-261`: early return on a missing Q/A at `:243`, card literal `:248-260` (`realWorldUsage,` at `:257`). The parse loop `:289-421`: card header `:295-345` (draft literal `:336-342`), deck header `:347-369`, the `if (!draft) {` stray-text guard `:371-381`, then `const questionMatch = QUESTION_MARKER.exec(raw);` at `:383`, A/USAGE/CODE `:388-405`, `TEXT_BEFORE_SECTION` `:407-418`, and the catch-all append `currentSection.lines.push(raw.trimEnd())` at `:420` — any unmatched column-0 line is glued to the open section, which is why a marker must be recognised loosely and its payload validated (MCQ plan §4.4). `COMPARABLE_FIELDS` `:518-526`; `normalizeText` `:533-535`; `fieldsThatDiffer` `:537-547` (the generic arm `normalizeText(card[field]) !== normalizeText(existing[field])` is what makes server `null` == `''` == absent); `planImport` `:558-647`; `serializeDeckMarkdown` `:655-679` (header push `:662`, `out.push('Q:')` `:663`).
- `frontend/src/lib/deckImportRunner.ts` (199 lines). `CreateCardParams` `:31-41` (`realWorldUsage?: string;` at `:40`), `UpdateCardParams` `:43-55` (`:50`), `optionalText(value: string | null)` `:100-102` sends cleared optionals as `""` (design point 3, `:18-22`), `createParamsFor` `:104-116` (`realWorldUsage: optionalText(card.realWorldUsage),` at `:112`), `updateParamsFor` `:118-132` (`:127`). The write loop `:159-196` never reads `outcome.data` (fixtures return `data: null`, `tests/deckImportRunner.test.ts:19-23`).
- `frontend/src/types/card.ts` (24 lines): `codeLanguage?: string | null;` at `:13`, `revision?: number | null;` at `:14`. No `topic`.
- `frontend/src/api/authoring.ts`: `normalizeCard` `:86-99` spreads `...c`, so an unknown `topic` key from the server already survives; `createCard` params `:382-395` (`realWorldUsage?: string;` `:394`), body guards `:397-407` (`realWorldUsage` at `:406`); `updateCard` params `:426-448` (`:438`), guards `:463-474` (`:469`). An absent body key means "leave it alone" server-side (`src_C/Vpc/Authoring/Helpers.cs:58` skips keys the body lacks), so `EditCardPage`/`NewCardPage` — which do not send `topic` and are NOT edited here — keep a card's topic intact on a console edit.
- Server after C05 (C00 §2.8.1, the dependency): `cards.topic text null` (migration `018_cards_topic.sql`); POST/PUT/GET/page/preview all echo the wire key `topic` (`"topic": null` for untagged cards); `Helpers.ParseOptionalTopic`/`NormalizeTopic`: absent / JSON null / blank → `null`, string → `Trim()`, > 80 chars → `VALIDATION_ERROR` "topic too long (max 80)". So the console's limit is 80 (`TOPIC_MAX_LENGTH`), measured on the trimmed payload with JS `.length` (UTF-16 units, the same unit C# `Length` uses), and sending `topic: ''` for an untagged card stores `null` — which is exactly why `normalizeText` treats `null`/`''`/absent alike and a re-import of an untouched file stays all-`unchanged`.
- Tests that pin the seams: `frontend/tests/deckImport.test.ts` (625 lines, 46 `it(` blocks): `toExistingCard` `:40-58` (Card literal; `codeLanguage: card.codeLanguage,` at `:51`), `contentOf` `:61-72` (explicit field list; `realWorldUsage: card.realWorldUsage,` at `:69`), the exact-key `toEqual` fixture `:87-97` (nine keys — a `topic: null` on every card would break it, hence "absent, not null"), `textArb` `:465`, `cardArb` `:477-500` (record `:478-491`, map `:492-500`), the four fast-check properties `:514-625` (round trip `:514-525`, idempotence `:584-611` models the server with `toExistingCard` + `?? ''` overrides at `:595-600`). `frontend/tests/authoringRequestBody.test.ts` (157 lines): "sends every optional field" `:54-80` / `:96-126`, absent lists `:89` / `:134`. `frontend/tests/deckImportRunner.test.ts` (287 lines): `toMatchObject` on params throughout — an extra `topic` key is harmless, so this file is untouched.
- Census tests that a careless edit trips (all run by the driver's full gate): `tests/cardRulesWiring.test.ts:157-167` pins the export list of `src/lib/cardRules.ts` — `TOPIC_MAX_LENGTH` lives in `deckImport.ts`, never there; `tests/apiSurfaceCensus.test.ts:72-77` — no new top-level export from `authoring.ts`; `tests/uiLanguage.test.ts:117` — no Chinese character anywhere under `src/` (comments included; `tests/` is exempt); `tests/typeGateFileSet2.test.ts:180-199` — every `tests/**/*.test.ts` is compiled by `tsc -b` via `tsconfig.test.json` (strict, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` → `import type`, `erasableSyntaxOnly`); `tests/docsPaths.test.ts` scans top-level `docs/*.md` only — C06 touches none, and `frontend/tests/deckImport.topic.test.ts` is registered nowhere, so creating it is safe (unlike C11's `deckImport.mcq.test.ts`, §6 #12).

What C00 decided (§2.8.2, binding): `DeckCardContent.topic?: string` is ABSENT (never `null`) when the card has no `TOPIC:` line; `'topic'` is appended LAST to both `ComparableField` and `COMPARABLE_FIELDS`; `ImportIssueCode` gains `'BAD_TOPIC' | 'DUPLICATE_TOPIC'`; `const TOPIC_MARKER = /^TOPIC:(.*)$/;` (column 0, loose, payload = trimmed remainder); `export const TOPIC_MAX_LENGTH = 80;`; the lexer checks `TOPIC:` BEFORE `Q:` and it does not open a section (`currentSection` stays as it was); empty or over-long payload → `BAD_TOPIC` and the card is dropped like `MISSING_QUESTION`; a second `TOPIC:` in one card → `DUPLICATE_TOPIC`, first wins, card kept; `serializeDeckMarkdown` emits `TOPIC: ${card.topic}` immediately after the `## uid | dN` header and before `Q:`, only when set (C11 later inserts `QUALIFIER:` after it — the per-card order is header, `TOPIC:`, `QUALIFIER:`, `Q:`, …); the runner sends `topic: optionalText(card.topic ?? null)` always; `Card.topic?: string | null` after `codeLanguage`; `createCard`/`updateCard` params gain `topic?: string` with the guard `if (params.topic !== undefined) body.topic = params.topic;` after `realWorldUsage`. Test contract (§3.1/§3.2): `deckImport.test.ts` — `contentOf` and `cardArb` gain `topic` "only when defined" (conditional spread), the `:87-97` fixture and every `it` title byte-identical; `authoringRequestBody.test.ts` — `topic` in both "sends" objects and both absent lists; `deckImportRunner.test.ts` untouched; new `deckImport.topic.test.ts` with a fast-check round trip (§3.3).

One gap in C00 resolved here: §3.1 lists `contentOf` and `cardArb` but not `toExistingCard` (`:40-58`). Without `topic` there, the idempotence property (`:584-611`) fails as soon as `cardArb` emits a topic (file `'x'` vs server `undefined` → `'topic'` in `changedFields`). So `toExistingCard` gains exactly one line, `topic: card.topic ?? null,` — the server's shape for an untagged card — and the `:595-600` override block stays byte-identical.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.3 (your file row), §2.8.1 (what the server echoes after C05), §2.8.2 (your contract, verbatim), §2.11 (what C11 builds on top of you — do not pre-empt it), §3.1 "C06", §3.2 (`deckImport.topic.test.ts`), §3.3, §5 (verify conventions), §6 #12 and #15.
2. `frontend/src/lib/deckImport.ts:1-98` (format comment, types), `:136-170` (markers, `SectionKind`, `CardDraft`), `:218-287` (`finishCard`, `openSection`), `:289-345` (loop head + card header), `:371-421` (stray guard, markers, catch-all), `:518-547` (`COMPARABLE_FIELDS`, `normalizeText`, `fieldsThatDiffer`), `:655-679` (`serializeDeckMarkdown`).
3. `frontend/src/lib/deckImportRunner.ts:31-55`, `:100-132`.
4. `frontend/src/types/card.ts:1-24`; `frontend/src/api/authoring.ts:86-99`, `:382-424`, `:426-489`.
5. `frontend/tests/deckImport.test.ts:1-110` (imports, `toExistingCard`, `contentOf`, the exact-key fixture), `:315-395` (`planImport` cases), `:451-625` (arbitraries + properties); `frontend/tests/authoringRequestBody.test.ts:53-138`; `frontend/tests/deckImportRunner.test.ts:19-58` (the `ok()` / `recorder()` harness you copy into the new file) and `:85-101` (`existingCard`).
6. `docs/mcq-card-type-plan-2026-09-18.md:258-260` (§4.4: loose marker + strict payload, the reason `TOPIC_MARKER` has no `[ \t]?`), `:268-274` (§4.6, the per-card serialize order C11 will extend).
7. `frontend/tests/uiLanguage.test.ts:100-125`, `frontend/tests/cardRulesWiring.test.ts:157-196`, `frontend/tsconfig.test.json:30-51` (`types`, `verbatimModuleSyntax`, and the strict block at `:44-49` — what `tsc -b` demands of a test file).

## Constraints

- **Scope (the ONLY files that may change):** `frontend/src/lib/deckImport.ts`, `frontend/src/lib/deckImportRunner.ts`, `frontend/src/types/card.ts`, `frontend/src/api/authoring.ts`, `frontend/tests/deckImport.test.ts`, `frontend/tests/authoringRequestBody.test.ts`, `frontend/tests/deckImport.topic.test.ts` (new). Nothing else: no `frontend/src/pages/*`, no `frontend/src/components/CardForm.tsx`, no `frontend/src/lib/cardRules.ts`, no `frontend/src/hooks/*`, no `frontend/tests/deckImportRunner.test.ts`, no `docs/*.md`, no `frontend/package.json` / `package-lock.json` / `vitest.config.ts` / `eslint.config.js` / `tsconfig*.json`.
- **Frozen files (gacha-v7 §2.1, C00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Nothing under `mobile/` or `src_C/` changes in this issue at all.
- **OTA / dependency rule:** no dependency is added or changed in any root. `fast-check` 4.9.0 is already a frontend devDependency. No `npm install`, no `npm ci`, no network.
- **Banned literals in any added line:** the six terms of B00 §0 (driver grep, case-insensitive; not spelled out here — use "work around", "sidestep", "guard", "fallback"). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **No Chinese under `frontend/src`** (comments included — `tests/uiLanguage.test.ts`). Test files may contain it (the existing `WORDS` arbitrary does).
- **`TOPIC_MAX_LENGTH` is exported from `deckImport.ts` only.** `cardRules.ts` is untouched (its export list is pinned). No new export from `authoring.ts`.
- **Absent, never null.** `DeckCardContent.topic?: string` — a parsed card without a `TOPIC:` line must have NO `topic` own property (`Object.hasOwn(card, 'topic') === false`). `Card.topic?: string | null` is the server's shape and is a different type on purpose.
- **Existing tests:** `deckImport.test.ts` changes are limited to `toExistingCard` (+1 line), `contentOf` (+1 line), a new `topicArb` const, and `cardArb` (+1 record line, +1 map line); every `it(`/`describe(` title, the `:87-97` fixture and the `:595-600` block are byte-identical; the file keeps ≥ 46 `it(` blocks. `authoringRequestBody.test.ts` changes are limited to `topic: 'Networking',` in the four object literals of the two "sends every optional field" cases and `'topic'` appended to both absent lists. `deckImportRunner.test.ts` is byte-identical. No other existing test changes.
- **Do not pre-empt C11/C12:** no `OPT:`/`WHY:`/`QUALIFIER:`, no `mcq`, no `SectionKind` widening, no `ImportRunResult` field, no readiness guard, no page or form edit, no `CardListPage` badge.
- **tsc/eslint traps:** `verbatimModuleSyntax` (types via `import type` / inline `type` specifiers), `noUnusedLocals`/`noUnusedParameters`, `@typescript-eslint/no-explicit-any` is an error, `erasableSyntaxOnly` (no `enum`). `tsc -b` type-checks `tests/` as strictly as `src/`.

## Changes required

1. **`frontend/src/lib/deckImport.ts`**
   a. Format comment `:6-18`: add one line `//   TOPIC: <one line, optional, max 80 chars>` between `//   ## cs-async-001 | d2` (`:10`) and `//   Q:` (`:11`). English only.
   b. `DeckCardContent` (`:36-44`): append, after `realWorldUsage: string | null;`, exactly
      ```ts
        /** Optional grouping label (server column cards.topic). ABSENT, never null, when the card has no TOPIC: line. */
        topic?: string;
      ```
   c. `ImportIssueCode` (`:53-66`): append `  | 'BAD_TOPIC'` and `  | 'DUPLICATE_TOPIC'` after `  | 'TEXT_BEFORE_SECTION'` (move the `;` to the new last member).
   d. `ComparableField` (`:91-98`): append `  | 'topic';` after `  | 'realWorldUsage'` (LAST member).
   e. After `USAGE_MARKER` (`:141`) add, verbatim (C00 §2.8.2):
      ```ts
      // Loose on purpose (MCQ plan §4.4): a column-0 "TOPIC:" line is always this marker,
      // and the payload is validated afterwards, so a bad topic is reported instead of being
      // glued to the open section by the catch-all at the end of the loop.
      const TOPIC_MARKER = /^TOPIC:(.*)$/;
      /** Same limit as the server's Helpers.ParseOptionalTopic (C05): measured on the trimmed payload. */
      export const TOPIC_MAX_LENGTH = 80;
      ```
   f. `CardDraft` (`:164-170`): add `topic: string | null;`, `topicSeen: boolean;`, `topicInvalid: boolean;`. The draft literal at `:336-342` initialises them `topic: null, topicSeen: false, topicInvalid: false`.
   g. Lexer: insert the `TOPIC:` branch after the `if (!draft) { … continue; }` block (`:371-381`) and BEFORE `const questionMatch = QUESTION_MARKER.exec(raw);` (`:383`), so a `TOPIC:` before any card is `TEXT_BEFORE_CARD` (unchanged behaviour) and the marker is recognised even while `swallowing` a repeated section (like every other marker). It never touches `currentSection` or `swallowing`:
      ```ts
      const topicMatch = TOPIC_MARKER.exec(raw);
      if (topicMatch) {
        const topic = topicMatch[1].trim();
        if (draft.topicSeen) {
          pushIssue(
            'DUPLICATE_TOPIC',
            lineNo,
            `Card "${draft.stableUid}" repeats the TOPIC: line; the first one wins.`,
            draft.stableUid,
          );
          continue;
        }
        draft.topicSeen = true;
        if (!topic) {
          pushIssue('BAD_TOPIC', lineNo, `Card "${draft.stableUid}" has an empty TOPIC: line.`, draft.stableUid);
          draft.topicInvalid = true;
          continue;
        }
        if (topic.length > TOPIC_MAX_LENGTH) {
          pushIssue(
            'BAD_TOPIC',
            lineNo,
            `Card "${draft.stableUid}" has a topic that is longer than ${TOPIC_MAX_LENGTH} characters.`,
            draft.stableUid,
          );
          draft.topicInvalid = true;
          continue;
        }
        draft.topic = topic;
        continue;
      }
      ```
      Every `TOPIC:` after the first in one card is `DUPLICATE_TOPIC`, whatever the first one was; the first one alone decides `topic`/`topicInvalid`.
   h. `finishCard`: the early return at `:243` becomes `if (!question || !explanation || d.topicInvalid) return;` (a `BAD_TOPIC` card is dropped exactly like a missing Q/A; its issue was already pushed at lex time). The card literal (`:248-260`) gains `...(d.topic !== null ? { topic: d.topic } : {}),` directly after `realWorldUsage,` (`:257`) — a conditional spread, so untagged cards have no `topic` key.
   i. `COMPARABLE_FIELDS` (`:518-526`): append `'topic',` as the LAST element. `fieldsThatDiffer` (`:537-547`) needs NO new branch — the generic `normalizeText` arm already yields server `null` == `''` == file-absent for `topic`. Do not add a special case; do not touch `validateCards`.
   j. `serializeDeckMarkdown` (`:655-679`): between the header push (`:662`) and `out.push('Q:');` (`:663`) insert `if (card.topic) out.push(`TOPIC: ${card.topic}`);`. Nothing else in the function moves.

2. **`frontend/src/lib/deckImportRunner.ts`**
   a. `CreateCardParams` (`:31-41`): add `  topic?: string;` after `realWorldUsage?: string;` (`:40`). `UpdateCardParams` (`:43-55`): same, after `:50`.
   b. `createParamsFor` (`:104-116`): add `topic: optionalText(card.topic ?? null),` after `realWorldUsage: optionalText(card.realWorldUsage),` (`:112`). `updateParamsFor` (`:118-132`): add `topic: optionalText(action.card.topic ?? null),` after `:127`. Always sent (design point 3, `:18-22`): an untagged card sends `''`, which the server stores as `null`, so removing a `TOPIC:` line converges on the next import instead of replanning forever. No other change (no readiness guard — that is C11's, and it must not fire for Q/A cards).

3. **`frontend/src/types/card.ts`**: insert `  topic?: string | null;` between `codeLanguage?: string | null;` (`:13`) and `revision?: number | null;` (`:14`). Optional, so every existing `Card` literal in tests still compiles.

4. **`frontend/src/api/authoring.ts`**
   a. `createCard` params (`:382-395`): add `  topic?: string;` after `realWorldUsage?: string;` (`:394`). Body: add `    if (params.topic !== undefined) body.topic = params.topic;` directly after the `realWorldUsage` guard (`:406`).
   b. `updateCard` params (`:426-448`): add `  topic?: string;` after `realWorldUsage?: string;` (`:438` on the base). Body: add the identical guard line directly after the `realWorldUsage` guard (`:469` on the base).
   c. `normalizeCard` (`:86-99`) is untouched (the spread already forwards `topic`). No new export.

5. **`frontend/tests/deckImport.test.ts`** (surgical; titles byte-identical)
   a. `toExistingCard` (`:40-58`): add `    topic: card.topic ?? null,` after `codeLanguage: card.codeLanguage,` (`:51`).
   b. `contentOf` (`:61-72`): add `    ...(card.topic !== undefined ? { topic: card.topic } : {}),` after `realWorldUsage: card.realWorldUsage,` (`:69`).
   c. After `textArb` (`:465`) add
      ```ts
      // Topics are single line, trim-stable and far below TOPIC_MAX_LENGTH (4 words of WORDS ≤ 23 chars).
      const topicArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 4 }).map((words) => words.join(' '));
      ```
   d. `cardArb` (`:477-500`): the record gains `    topic: fc.option(topicArb, { nil: undefined }),` after `realWorldUsage: fc.option(textArb, { nil: null }),` (`:490`); the map gains `    ...(r.topic !== undefined ? { topic: r.topic } : {}),` after `realWorldUsage: r.realWorldUsage,` (`:499`). All four existing properties now exercise topics through the existing `serializeDeckMarkdown → parseDeckMarkdown → contentOf` chain and the idempotence model.
   e. Nothing else: the `:87-97` fixture, the `:595-600` override block, every `it`/`describe` title unchanged; ≥ 46 `it(` blocks remain. The verify greps these seven existing titles verbatim as the "not renamed" probe: `it('reads every card field'`, `it('lists every changed field for the preview'`, `it('round trips: serialize then parse returns every field unchanged'`, `it('blank lines and CRLF anywhere do not change the parse result'`, `it('any document with a repeated uid is rejected'`, `it('planImport is idempotent and calls identical content unchanged'`, `it('every reported issue points at a real line'`.

6. **`frontend/tests/authoringRequestBody.test.ts`**: in `createCard` "sends every optional field that was supplied" (`:54-80`) add `topic: 'Networking',` to the input object (`:55-66`) and to the `toMatchObject` expectation (`:68-79`); in "leaves out what was not supplied…" (`:89`) the absent list becomes `['explanation', 'realWorldUsage', 'codeSnippet', 'codeLanguage', 'difficulty', 'orderInDeck', 'revision', 'topic']`; in `updateCard` "sends every optional field that was supplied" (`:96-126`) add `topic: 'Networking',` to both objects; in "omits the fields the caller left alone" (`:134`) the list becomes `[…, 'revision', 'stableUid', 'topic']`. Titles unchanged — the verify greps these four verbatim: `it('sends every optional field that was supplied'` (both describes), `it('leaves out what was not supplied, rather than sending undefined'`, `it('omits the fields the caller left alone'`, `it('sends no expectedVersion at all when the caller did not supply one'`.

7. **`frontend/tests/deckImport.topic.test.ts` (new)** — `import { describe, expect, it } from 'vitest'; import fc from 'fast-check';`, `import { parseDeckMarkdown, planImport, serializeDeckMarkdown, TOPIC_MAX_LENGTH, type ParsedCard } from '../src/lib/deckImport';`, `import { runImport, type CreateCardParams, type ImportWriter, type UpdateCardParams } from '../src/lib/deckImportRunner';`, `import type { ApiResult } from '../src/types/api'; import type { Card } from '../src/types/card';`. Local helpers: `doc(lines: string[]) => lines.join('\n')`; `serverCard(card: ParsedCard, overrides: Partial<Card> & Pick<Card, 'id'>): Card` (a full `Card` literal like `deckImport.test.ts:40-58` with `topic: card.topic ?? null` and `...overrides` last); a recorder writer copied from `deckImportRunner.test.ts:19-58` (`ok()` returns `{ success: true, data: null, error: null, traceId: 't' }`; captures `CreateCardParams[]` / `UpdateCardParams[]`). Cases, each its own `it`, titles verbatim:

   `describe('TOPIC: marker', …)`
   1. `it('reads a TOPIC: line into card.topic, trimmed', …)` — `['# deck: d1', '## a-1 | d2', 'TOPIC:   Networking  ', 'Q:', 'q', 'A:', 'a']` → `errors` `[]`, `cards[0].topic === 'Networking'`; the same with `'TOPIC:Networking'` (no space) → `'Networking'`.
   2. `it('leaves topic absent, not null, when there is no TOPIC: line', …)` — minimal doc → `Object.hasOwn(cards[0], 'topic') === false`; `cards[0]` `toEqual` the nine-key object (`stableUid, difficulty, question, explanation, codeSnippet, codeLanguage, realWorldUsage, orderInDeck, sourceLine`).
   3. `it('accepts TOPIC: anywhere inside the card without opening a section', …)` — `['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a1', 'TOPIC: Storage', 'a2']` → `errors` `[]`, `explanation === 'a1\na2'`, `topic === 'Storage'`.
   4. `it('flags an empty TOPIC: line as BAD_TOPIC and drops the card', …)` — `'TOPIC:'` and `'TOPIC:    '` at line 3 of a doc with valid Q/A → `cards` `[]`, `errors.map((e) => [e.code, e.line, e.stableUid])` `toEqual` `[['BAD_TOPIC', 3, 'a-1']]`.
   5. `it('flags a topic longer than TOPIC_MAX_LENGTH as BAD_TOPIC and accepts one exactly at the limit', …)` — `'TOPIC: ' + 'x'.repeat(TOPIC_MAX_LENGTH + 1)` → `BAD_TOPIC` at line 3, `cards` `[]`; `'x'.repeat(TOPIC_MAX_LENGTH)` → `errors` `[]`, `cards[0].topic.length === TOPIC_MAX_LENGTH`.
   6. `it('keeps the first TOPIC: and reports the second as DUPLICATE_TOPIC', …)` — `['# deck: d1', '## a-1 | d0', 'TOPIC: First', 'TOPIC: Second', 'Q:', 'q', 'A:', 'a']` → `cards[0].topic === 'First'`, `errors.map(...)` `toEqual` `[['DUPLICATE_TOPIC', 4, 'a-1']]`.
   7. `it('reports a TOPIC: line before any card as TEXT_BEFORE_CARD', …)` — `['# deck: d1', 'TOPIC: Early', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']` → codes `['TEXT_BEFORE_CARD']` at line 2; `cards[0]` has no `topic` key.
   8. `it('reports text after TOPIC: and before the first section as TEXT_BEFORE_SECTION', …)` — `['# deck: d1', '## a-1 | d0', 'TOPIC: t', 'stray', 'Q:', 'q', 'A:', 'a']` → codes `['TEXT_BEFORE_SECTION']` at line 4; the card is kept with `topic === 't'`.

   `describe('serializeDeckMarkdown with topic', …)`
   9. `it('emits TOPIC: directly under the card header and before Q:', …)` — one card with `topic: 'Networking'` → `serialize('d1', [card]).split('\n').slice(2, 5)` `toEqual` `['## a-1 | d2', 'TOPIC: Networking', 'Q:']`; the same card without `topic` → `lines[3] === 'Q:'` and no line starts with `'TOPIC:'`.
   10. `it('round trips any topic through serialize and parse', …)` — `fc.assert(fc.property(topicArb, fc.boolean(), (topic, tagged) => …))` with a local `topicArb` (words joined by single spaces, ≤ 5 words from a constant list whose longest word is ≤ 13 chars, so ≤ 69 chars, trim-stable, no newline): serialize one card with `topic` when `tagged`, parse, expect `errors` `[]` and `cards[0].topic === (tagged ? topic : undefined)` and `Object.hasOwn(cards[0], 'topic') === tagged`.

   `describe('planImport with topic', …)`
   11. `it('lists topic last in changedFields', …)` — parse a card with `TOPIC:`, `Q:`, `A:`, `CODE: ts` + snippet, `USAGE:`; `existing = [serverCard(card, { id: 1, version: 1, question: 'other', difficulty: 0, orderInDeck: 10, explanation: 'other', codeSnippet: 'other', codeLanguage: 'sql', realWorldUsage: 'other', topic: 'other' })]` → `updates[0].changedFields` `toEqual` `['question', 'difficulty', 'orderInDeck', 'explanation', 'codeSnippet', 'codeLanguage', 'realWorldUsage', 'topic']`.
   12. `it('treats a server null topic and an absent TOPIC: line as unchanged', …)` — untagged parsed card vs `existing` with `topic: null`, then with `topic: ''` → `updates` `[]`, `unchanged` length 1 in both; a tagged card (`Networking`) vs `existing` `topic: '  Networking '` → unchanged (trim).
   13. `it('plans an update with changedFields [topic] when only the topic changed', …)` — tagged `New` vs existing `'Old'` → `updates[0].changedFields` `toEqual` `['topic']`; untagged vs existing `'Old'` → `['topic']` as well (a removed `TOPIC:` line is an update; the runner then sends `''`).

   `describe('runImport with topic', …)`
   14. `it('sends topic on create and update, and an empty string when the file has none', …)` — doc with `a-1` (`TOPIC: Networking`) and `a-2` (no topic); `existing = [serverCard(a-1, { id: 41, version: 3, topic: 'Old' })]` (all other fields equal) → plan = 1 update (a-1) + 1 create (a-2); `await runImport(7, [...plan.creates, ...plan.updates], rec.writer)` → `rec.creates[0]` `toMatchObject({ stableUid: 'a-2', topic: '' })`, `rec.updates[0]` `toMatchObject({ id: 41, expectedVersion: 3, topic: 'Networking' })`, result `toEqual({ created: 1, updated: 1, failures: [] })`.

Estimated size: `deckImport.ts` ~50 lines, runner 4, `card.ts` 1, `authoring.ts` 4, `deckImport.test.ts` 5, `authoringRequestBody.test.ts` 6, new test ~230.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C06.verify.sh` re-runs exactly these (steps 1–5).

1. Scope files exist (exit 0): `[ -f frontend/tests/deckImport.topic.test.ts ]` and the six edited files still exist.
2. Literal guards (exit 0), `f=frontend/src/lib/deckImport.ts`: `grep -Fq 'const TOPIC_MARKER = /^TOPIC:(.*)$/;' $f`; `grep -Fq 'export const TOPIC_MAX_LENGTH = 80;' $f`; `grep -Fq '  topic?: string;' $f` and `! grep -Eq 'topic\?: string \| null' $f`; `grep -Fq "  | 'BAD_TOPIC'" $f`; `grep -Fq "  | 'DUPLICATE_TOPIC'" $f`; `grep -Fq "  | 'topic';" $f`; the last quoted entry inside the `COMPARABLE_FIELDS` array literal is `'topic'`; the line of `TOPIC_MARKER.exec(raw)` is after the line of `if (!draft) {` and before the line of `QUESTION_MARKER.exec(raw)`; the three messages `has an empty TOPIC: line.`, `is longer than ${TOPIC_MAX_LENGTH} characters.`, `repeats the TOPIC: line; the first one wins.` are present; `grep -Fq 'out.push(`TOPIC: ${card.topic}`);' $f` and that line sits between the header push and `out.push('Q:');`; `grep -Fq '|| d.topicInvalid) return;' $f`; `grep -Fq '...(d.topic !== null ? { topic: d.topic } : {}),' $f`. Runner `r=frontend/src/lib/deckImportRunner.ts`: `grep -Fq 'topic: optionalText(card.topic ?? null),' $r`, `grep -Fq 'topic: optionalText(action.card.topic ?? null),' $r`, `grep -c '^  topic?: string;$' $r` = 2. `frontend/src/types/card.ts`: `grep -Fq '  topic?: string | null;'` and its line number is between those of `codeLanguage?:` and `revision?:`. `a=frontend/src/api/authoring.ts`: `grep -c 'if (params.topic !== undefined) body.topic = params.topic;' $a` = 2, `grep -c '^  topic?: string;$' $a` = 2. Tests: the new file imports `fast-check` and has `fc.assert(`, contains all 14 `it('…'` titles above verbatim and ≥ 14 `it(` blocks, imports `TOPIC_MAX_LENGTH` and `runImport`; `deckImport.test.ts` contains `topic: card.topic ?? null,`, `...(card.topic !== undefined ? { topic: card.topic } : {}),`, `topic: fc.option(topicArb, { nil: undefined }),`, `...(r.topic !== undefined ? { topic: r.topic } : {}),`, its `reads every card field` block has no `topic`, ≥ 46 `it(` blocks and the five property titles; `authoringRequestBody.test.ts` contains `'revision', 'topic']`, `'stableUid', 'topic']` and ≥ 4 lines `topic: 'Networking',`. No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file.
3. `cd frontend && npm run lint && npm run build` — exit 0 (`build` = `tsc -b && vite build`, which type-checks `tests/` too).
4. `cd frontend && npx vitest run tests/deckImport.topic.test.ts tests/deckImport.test.ts tests/authoringRequestBody.test.ts tests/deckImportRunner.test.ts tests/uiLanguage.test.ts tests/cardRulesWiring.test.ts tests/apiSurfaceCensus.test.ts tests/typeGateFileSet2.test.ts --reporter=dot` — exit 0.
5. Scope + frozen guard (exit 0): `mb=$(git merge-base HEAD delivery/r16-c-economy)`; `git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts frontend/src/lib/cardRules.ts frontend/tests/deckImportRunner.test.ts frontend/package.json frontend/package-lock.json mobile/package.json mobile/package-lock.json mobile/app.json` is empty; `git diff --name-only "$mb" -- ':(glob)docs/*.md'` is empty; `{ git diff --name-only "$mb"; git ls-files --others --exclude-standard -- frontend/src frontend/tests docs; } | grep -Ev '^(frontend/src/lib/deckImport\.ts|frontend/src/lib/deckImportRunner\.ts|frontend/src/types/card\.ts|frontend/src/api/authoring\.ts|frontend/tests/deckImport\.test\.ts|frontend/tests/authoringRequestBody\.test\.ts|frontend/tests/deckImport\.topic\.test\.ts|docs/delivery/r16-issues/.*)$'` is empty.

## Verify

```sh
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C06.verify.sh
```
(cwd = worktree root; ~15 s: lint ~3 s, build ~5 s, vitest ~2 s; no network). After it prints `C06 VERIFY OK`, the driver additionally runs the full frontend root gate `cd frontend && npm run lint && npx vitest run && npm run build`, the diff-scoped banned-term grep and the suppression scan; all must be green.

## Do NOT

- Do NOT make `topic` `null` on untagged parsed cards, do NOT add `topic` to the `:87-97` fixture, do NOT rename or reorder any existing `it`.
- Do NOT add `TOPIC_MAX_LENGTH` (or anything) to `cardRules.ts`; do NOT add a new export to `authoring.ts`.
- Do NOT touch `validateCards`, `openSection`, `SectionKind`, `normalizeText`, `planImport`'s body, `DeckImportPage.tsx`, `CardForm.tsx`, `EditCardPage.tsx`, `NewCardPage.tsx`, `CardListPage.tsx`, any `docs/*.md`, anything under `mobile/` or `src_C/`.
- Do NOT implement any part of C11/C12 (MCQ markers, `mcq`, readiness guard, badge, panel).
- Do NOT run `npm install`, `npm ci`, `npm update`, or any git command in `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree. No `git push`, no PR, never touch `main`.
- Do NOT gut tests (`.skip`, `.only`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`) or loosen any tsconfig / eslint config.

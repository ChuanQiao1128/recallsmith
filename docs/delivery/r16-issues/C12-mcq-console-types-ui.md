# C12 — MCQ P1e console types + client + badge + read-only panel (`mcq-console-types-ui`)

Make the console carry the `mcq` blob end to end without letting anyone edit it there: `Card.mcq?: McqBlob | null` on the client type, `mcq?: McqBlob | null` on `createCard` / `updateCard` with a guard that forwards an explicit `null` (that is how a clear reaches the server), an `MCQ` badge beside the rarity pill on the card list, a read-only `<fieldset data-testid="card-form-mcq">` on the edit form fed by `EditCardPage`, and two test files that pin all of it — `frontend/tests/authoringRequestBody.test.ts` (edited) and `frontend/tests/cardMcqConsole.test.tsx` (new). Root: `frontend`. Deps: C11 (which brought `frontend/src/types/mcq.ts`, `mcqRules.ts`, the importer and the runner's `mcq` params). Pure TypeScript/TSX; no dependency, no new page, no new hook, no new export from `authoring.ts`.

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`, plus C06 and C11 merged before you start — every line number below was read on the base and is stated as such; where C06/C11 moved a line the brief says "after the line C06/C11 added" instead of a number):

- `frontend/src/types/card.ts:1-24` declares `Card` only: `explanation?`, `realWorldUsage?`, `codeSnippet?`, `codeLanguage?: string | null` (`:10-13`), `revision?: number | null` (`:14`), `version` (`:16`). C06 inserted `topic?: string | null;` after `codeLanguage` (`:13`). There is no `mcq` key and no `McqBlob` in this file; the shared blob type lives in `frontend/src/types/mcq.ts` (created by C11, C00 §2.11 / §6 #15) as exactly

  ```ts
  export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
  export interface McqBlob { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
  ```

- `frontend/src/api/authoring.ts`: `normalizeCard` (`:86-99`) spreads `...c`, so an `mcq` key the server echoes already survives `fetchCardsByDeck` (`:364-380`) and the create/update returns (`:420`, `:485`). `createCard` params `:382-395`, body guards `:397-407` — `realWorldUsage` at `:406`, C06 added `topic` right after it. `updateCard` params `:426-448`, guards `:463-474` — `realWorldUsage` at `:469`, C06 added `topic` right after it. An absent body key means "leave alone" server-side (`src_C/Vpc/Authoring/Helpers.cs:58` `if (!body.TryGetProperty(f.BodyKey, out var el)) continue;`), which is why a clear must travel as an own key with value `null`, never be dropped.
- After C11 the runner already *sends* `mcq`: `frontend/src/lib/deckImportRunner.ts` `CreateCardParams`/`UpdateCardParams` (`:31-55` on the base) gained `mcq?: McqBlob | null` and `createParamsFor`/`updateParamsFor` (`:104-132` on the base) send `mcq: card.mcq ?? null`. `ImportWriter` (`:62-65`) uses method syntax (bivariant parameters) and `DeckImportPage.tsx:243` hands `{ createCard, updateCard }` straight to it, so TypeScript is green today while `authoring.ts` silently drops `mcq` on the floor — the exact defect `tests/authoringRequestBody.test.ts:1-14` was written against. C12 is the link that puts the key on the wire; that test file is where it is pinned.
- `frontend/src/pages/CardListPage.tsx`: header `:283-292` (8 `<th>`), empty row `colSpan={8}` (`:298`), the Rarity cell is `:311-313`:

  ```tsx
  <td className="px-3 py-2">
    <RarityBadge difficulty={card.difficulty} />
  </td>
  ```

  `RarityBadge` (`frontend/src/components/RarityBadge.tsx:8-26`) is a pill `inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border`. Existing page tests (`cardListPageDelete`, `cardListPageQueryWiring`, `cardListPageRace`) read rows by question text and never pin the Rarity cell's markup.
- `frontend/src/components/CardForm.tsx` (609 lines): `CardFormValues` `:33-43` (nine fields, no `Card` object reaches the form), `CardFormProps` `:45-67` (`mode, deck, initialValues, onSubmit, onCancel, recoveryLabel?`), `export function CardForm(props: CardFormProps)` at `:225`, destructuring at `:226`. Layout tail: RealWorldUsage block `:570-582`, blank `:583`, Cancel/Submit row `:584-605`, `</form>` `:608`. Imports from `../lib/cardRules` (`:6-13`) are pinned by `tests/cardRulesWiring.test.ts:173-196` (the consumer table) — they must not change.
- `frontend/src/pages/EditCardPage.tsx`: `handleSubmit` builds the `updateCardMutation.mutateAsync({...})` literal at `:260-284` from form values + `card.id/deckId/stableUid/version` — no `mcq`, and it stays that way (an absent key leaves the server's blob intact). The `<CardForm …/>` mount is `:340-347`. `NewCardPage.tsx:253-259` mounts `CardForm` with no card and needs no change.
- Census tests that fence this issue: `tests/cardRulesWiring.test.ts:157-167` (export list of `cardRules.ts`) and `:173-196` (consumer table); `tests/apiSurfaceCensus.test.ts:72-77`, `:123-126` (every export of `authoring.ts` must have an importer — add none); `tests/consoleDirectoryLayout.test.ts:97` (`src/pages/` == the App.tsx route set — no new page file); `tests/hookWiring.test.ts` (nine hooks, no more); `tests/uiLanguage.test.ts:117` (no Chinese characters anywhere under `src/`, comments included); `tests/singleTheme.test.ts` (no Tailwind `dark:` under `src/`); `tests/typeGateFileSet2.test.ts:180-199` (every `tests/**/*.ts(x)` compiles under `tsc -b`); `tests/runnerSeparation.test.ts:107-168` (a vitest file is `*.test.tsx`, never `*.spec.*`).
- Tooling (`frontend/package.json:7-14`): `lint = eslint .` (lints `tests/` too), `build = tsc -b && vite build` (compiles `tests/` through `tsconfig.test.json:51`), `test = vitest run`. `eslint.config.js:9-23`: `tseslint.configs.recommended` (`no-explicit-any` is an error — cast to `Record<string, unknown>`, never `any`), `reactHooks.configs.flat.recommended` v7 (compiler rules on), `reactRefresh.configs.vite` (a `.tsx` that exports a component must not gain a non-component export). `vitest.config.ts:12-31`: `environment: 'node'`, opt into the DOM with a `// @vitest-environment jsdom` docblock on line 1; `globals: false`.

What C00 decided (binding):

- §2.11, last paragraph, is the whole contract: `types/card.ts` `mcq?: McqBlob | null;` (`import type` from `./mcq`); `authoring.ts` `createCard`/`updateCard` params `mcq?: McqBlob | null`, guard `if (params.mcq !== undefined) body.mcq = params.mcq;` (forwards `null`); `CardListPage.tsx`: `<span data-testid="card-mcq-badge">MCQ</span>` beside `<RarityBadge/>` in the Rarity cell when `card.mcq`; `CardForm.tsx`: optional prop `mcq?: McqBlob | null` rendering a read-only `<fieldset data-testid="card-form-mcq">` between RealWorldUsage and the button row; `EditCardPage` passes `card.mcq`, its submit never sends `mcq`.
- §3.1 C12: `frontend/tests/authoringRequestBody.test.ts` gains `mcq` in both "sends every optional field" objects, both "absent" lists, plus one case proving `mcq: null` is sent as an own key with value `null`. §3.2: `frontend/tests/cardMcqConsole.test.tsx` (jsdom): badge present/absent; read-only panel present on edit with mcq, absent on new; `EditCardPage` submit body has no `mcq` key.
- §0 do-not-touch: `frontend/src/lib/cardRules.ts`, the `src/pages/` file set, the `src/hooks/` barrel. §0 banned literals and the no-suppression rule. The only MCQ example text any test may quote is the two §4.3 cards of `docs/mcq-card-type-plan-2026-09-18.md:177-253`; this brief's fixture uses neutral placeholder option text instead, and never anything that reads like an exam question.
- **Gap in C00, resolved here:** §1.3's C12 row lists `types/card.ts`, `api/authoring.ts`, `CardForm.tsx`, `CardListPage.tsx` and the two test files, but §2.11 requires "EditCardPage passes card.mcq" and §3.2 tests the panel *on the edit page*. Neither is possible without touching `frontend/src/pages/EditCardPage.tsx`. Decision: `EditCardPage.tsx` is in scope for exactly one prop line at the `<CardForm …/>` mount (`:340-347`); `handleSubmit` (`:260-284`) is not edited. The verify script's allow-list includes it.

Why the form is read-only: the blob is authored and validated in the Markdown importer (C11, `mcqRules.ts`) and re-validated by the API (C08). A second editing surface would need the full rule set on a form that today asks nothing the importer asks (see the "one kernel, two severities" note at `CardForm.tsx:83-124`), and Wave C has no budget for it. The panel shows what the server holds so an editor can see that a card is MCQ and what its options are, and the save path leaves the blob alone.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.3 (the console file map), §2.11 (the contract — its last paragraph is C12), §3.1 "C12" and §3.2 (`cardMcqConsole.test.tsx`), §5 (verify conventions), §6 #15 (why the blob type lives in `types/mcq.ts`).
2. `frontend/src/types/mcq.ts` (whole, from C11) and `frontend/src/types/card.ts:1-24`.
3. `frontend/src/api/authoring.ts:1-8` (imports), `:86-99` (`normalizeCard`), `:382-424` (`createCard`), `:426-489` (`updateCard`).
4. `frontend/src/components/CardForm.tsx:33-67` (values + props), `:225-240` (component head), `:570-608` (the tail you insert into).
5. `frontend/src/pages/CardListPage.tsx:1-18` (imports), `:280-345` (the table).
6. `frontend/src/pages/EditCardPage.tsx:249-284` (`handleSubmit` — read, do not edit; the `mutateAsync` literal is `:260-284`), `:338-348` (the mount).
7. `frontend/tests/authoringRequestBody.test.ts` (whole, 157 lines on the base; C06 added `topic` to both "sends" objects and both "absent" lists).
8. Harness models for the new test: `frontend/tests/cardListPageDelete.test.tsx:24-150` (mount at `:105-116`: `renderWithQuery` + `ConfirmDialogProvider` + `signInAsSuperAdmin`, `Deck`/`Card` literals, `ok()`), `frontend/tests/cardEntryDefects.test.tsx:26-110` and `:205-240` (`mountEdit` at `:210-216`) (plain `render` + `MemoryRouter` for `NewCardPage`/`EditCardPage`, the `console.error` spy, reading `api.updateCard.mock.calls[0][0]`), `frontend/tests/editCardVersionConflict.test.tsx:36-97` (`saveButton` `:86-88`, `mountLoaded` `:90-97`).
9. `frontend/tests/cardRulesWiring.test.ts:150-196`, `frontend/tests/apiSurfaceCensus.test.ts:60-80`, `frontend/tests/consoleDirectoryLayout.test.ts:90-100` — the fences.
10. `docs/mcq-card-type-plan-2026-09-18.md:118-120` (§3.6 — why the API returns `mcq` as an object and the console does no defensive parsing) and `:122-124` (§3.7, the console paragraph this issue implements; note it writes `Card.mcq: McqBlob | null` — required — while C00 §2.11 and the fixtures make it optional, and C00 wins).

## Constraints

- **Scope (the ONLY files that may change):** `frontend/src/types/card.ts`, `frontend/src/api/authoring.ts`, `frontend/src/components/CardForm.tsx`, `frontend/src/pages/CardListPage.tsx`, `frontend/src/pages/EditCardPage.tsx` (one prop line), `frontend/tests/authoringRequestBody.test.ts`, `frontend/tests/cardMcqConsole.test.tsx` (new). Nothing else: not `types/mcq.ts`, `lib/mcqRules.ts`, `lib/deckImport.ts`, `lib/deckImportRunner.ts` (C11 owns them), not `NewCardPage.tsx`, not `hooks/useCards.ts` (its param types derive from `Parameters<typeof createCard>[0]`, `useCards.ts:29-30`), not `lib/cardRules.ts`, not `ContentIntelligencePage.tsx` (C13), not `package.json`/`package-lock.json`, no top-level `docs/*.md`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Nothing under `mobile/`, `src_C/`, `snowflake/` changes.
- **No dependency, no native anything.** Frontend only; `npm install` is not run. (The OTA rule of C00 §0 is about `mobile/`; C12 does not touch it.)
- **Banned literals in any added line:** the six terms of B00 §0 (driver grep — this brief does not spell them out; use "guard", "fallback", "sidestep" if you need such a word). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Existing tests:** `frontend/tests/authoringRequestBody.test.ts` is the only existing test file that changes, and only as §3.1 says (change 6). Every other test file is byte-identical. In particular `cardFormHints`, `cardFormStableUid`, `cardRuleDivergence`, `cardEntryDefects`, `editCardVersionConflict`, `cardListPage*`, `deckImportRunner`, `deckImport*` stay green untouched — the new prop is optional, the new `Card` key is optional, and `toMatchObject` assertions ignore extra keys.
- **Fences you must not trip:** no new export from `authoring.ts` or `CardForm.tsx`; no change to `CardForm.tsx`'s `../lib/cardRules` import list; no import of `../lib/mcqRules` in `CardForm.tsx` (the panel renders, it never validates); no new file under `src/pages/`; no new hook; no `dark:` class; no Chinese character under `src/` (comments included); no `any`.
- **Wire semantics are exact:** `params.mcq === undefined` → no `mcq` key in the body; `params.mcq === null` → `"mcq": null` in the body; a blob → the blob. Do not write `params.mcq ?? null`, `if (params.mcq)`, or `!= null` — each of those either invents a clear or swallows one.
- **The form never learns to edit the blob:** `CardFormValues` (`:33-43`) is unchanged, `handleSubmit` in `CardForm.tsx` is unchanged, `EditCardPage.handleSubmit` is unchanged. The fieldset contains no `<input>`, `<textarea>`, `<select>` or `<button>`.

## Changes required

1. **`frontend/src/types/card.ts`** — add `import type { McqBlob } from './mcq';` as the first line of the file (there is no import today; `verbatimModuleSyntax` requires `import type`). Inside `Card`, directly after the `topic?: string | null;` line C06 added (i.e. before `revision?: number | null;`), add exactly:
   ```ts
   mcq?: McqBlob | null;
   ```
   Optional on purpose: `tests/deckImport.test.ts:40-58`, `tests/deckImportRunner.test.ts:85-101` and the page tests build `Card` literals without it. `null` is what the API returns for a Q/A card (`"mcq": null`, C00 §2.9.3); absent is what older fixtures and a not-yet-deployed server produce.

2. **`frontend/src/api/authoring.ts`**
   a. Add `import type { McqBlob } from '../types/mcq';` next to the other `import type` lines (`:2-4`).
   b. `createCard` params (`:382-395`): append `mcq?: McqBlob | null;` after `realWorldUsage?: string;` (and after C06's `topic?: string;` if that is where C06 put it — the key order inside the type literal is not pinned; the two lines just have to exist). Body guard: directly after the `topic` guard C06 added (which follows `if (params.realWorldUsage !== undefined) body.realWorldUsage = params.realWorldUsage;`, `:406` on the base), add verbatim:
      ```ts
      if (params.mcq !== undefined) body.mcq = params.mcq;
      ```
   c. `updateCard` params (`:426-448`): append `mcq?: McqBlob | null;`. Body guard: directly after C06's `topic` guard (which follows the `realWorldUsage` guard, `:469` on the base), the same line verbatim:
      ```ts
      if (params.mcq !== undefined) body.mcq = params.mcq;
      ```
   d. A short comment above the create-side param is welcome (why `null` is forwarded: `Helpers.cs:58` drops absent keys, so a clear can only travel as an explicit `null`). No other change: `normalizeCard`, `fetchCardsByDeck`, the endpoints, `ensureStableUid` untouched; the export list is identical to the base (`tests/apiSurfaceCensus.test.ts`).

3. **`frontend/src/pages/CardListPage.tsx`** — in the Rarity cell (`:311-313`), directly after `<RarityBadge difficulty={card.difficulty} />`, add on one line:
   ```tsx
   {card.mcq ? <span data-testid="card-mcq-badge" className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200">MCQ</span> : null}
   ```
   A plain `<span>` (the `ui/Badge` component takes no `data-testid`). The text is exactly `MCQ` and the closing `</span>` stays on the same line as the text (the verify greps `>MCQ</span>`). `card.mcq ?` is a truthiness test on the object: `null` and absent both mean no badge. Column count, header (`:283-292`) and `colSpan={8}` (`:298`) unchanged; no new import.

4. **`frontend/src/components/CardForm.tsx`**
   a. Add `import type { McqBlob } from '../types/mcq';` next to `import type { Deck } from '../types/deck';` (`:5`).
   b. `CardFormProps` (`:45-67`) gains one optional prop, appended after `recoveryLabel?: string | null;`, with a doc comment in the file's voice (why read-only — see Context):
      ```ts
      /**
       * The card's MCQ block as the server holds it, shown read-only below the
       * text fields. The form never edits or sends it: options, answers and WHY
       * notes are authored through the deck Markdown import (OPT:/WHY:/QUALIFIER:)
       * and validated there and at the API. Absent or null on a Q/A card and on
       * the create page.
       */
      mcq?: McqBlob | null;
      ```
   c. Destructure it at `:226`: `const { mode, deck, initialValues, onSubmit, onCancel, recoveryLabel, mcq } = props;`.
   d. Between the RealWorldUsage block (`:582`) and the button row (`:584`) render, only when `mcq` is non-null:
      ```tsx
      {mcq ? (
        <fieldset
          data-testid="card-form-mcq"
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        >
          <legend className="px-1 text-sm font-medium text-slate-700">Multiple choice</legend>
          <p className="text-xs text-slate-500">
            Read-only here. Options, answers and WHY notes change through the deck Markdown import.
          </p>
          <p data-testid="card-form-mcq-required" className="mt-1 text-xs text-slate-600">
            {mcqRequiredCount === 1 ? 'Single answer' : `Choose ${mcqRequiredCount}`}
          </p>
          {mcq.qualifier ? (
            <p data-testid="card-form-mcq-qualifier" className="mt-1 text-xs text-slate-600">
              Qualifier: {mcq.qualifier}
            </p>
          ) : null}
          <ol className="mt-2 space-y-1">
            {mcq.options.map(option => (
              <li key={option.key} data-testid={`card-form-mcq-option-${option.key}`} className="text-slate-800">
                <span className="font-mono text-xs text-slate-500">{option.key}</span> {option.text}
                {option.correct ? (
                  <span
                    data-testid="card-form-mcq-correct"
                    className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200"
                  >
                    correct
                  </span>
                ) : null}
                {option.why ? <div className="text-xs text-slate-500">Why: {option.why}</div> : null}
              </li>
            ))}
          </ol>
        </fieldset>
      ) : null}
      ```
      with `const mcqRequiredCount = mcq ? mcq.options.filter(option => option.correct).length : 0;` computed in the component body before `return` (plain expression; no hook, no state, no effect). Options render in stored order (`key` a, b, c… is the stored order by C00 §2.9.1; the console shows the stored key, it is not a display letter). `Multiple choice</legend>` stays on one line (verify greps it). The fieldset has no form control inside it.
   e. Nothing else moves: `CardFormValues`, `handleSubmit`, the hints, the highlight block, the button row are byte-identical. No new export from this file (`react-refresh/only-export-components`).

5. **`frontend/src/pages/EditCardPage.tsx`** — one line in the `<CardForm …/>` mount (`:340-347`), after `recoveryLabel={…}`:
   ```tsx
   mcq={card.mcq ?? null}
   ```
   `handleSubmit` (`:260-284`) is not edited — it never mentions `mcq`, so a plain edit leaves the server's blob intact (absent key → `Helpers.cs:58` skips the column). After a `VERSION_CONFLICT` re-read (`:307`) the panel shows the re-read card's blob, which is the honest thing to show; the form values are untouched as today.

6. **`frontend/tests/authoringRequestBody.test.ts`** — exactly what C00 §3.1 lists:
   a. A module-level fixture, typed, with neutral placeholder text:
      ```ts
      import type { McqBlob } from '../src/types/mcq';
      const MCQ: McqBlob = {
        v: 1,
        qualifier: null,
        shuffle: true,
        options: [
          { key: 'a', text: 'First option', why: 'Why the first option is wrong.', correct: false },
          { key: 'b', text: 'Second option', why: null, correct: true },
          { key: 'c', text: 'Third option', why: 'Why the third option is wrong.', correct: false },
        ],
      };
      ```
   b. `createCard` "sends every optional field that was supplied" (`:54-80`): add `mcq: MCQ` to the call and to the `toMatchObject` literal. "leaves out what was not supplied…" (`:82-92`): add `'mcq'` to the absent list (`:89`).
   c. `updateCard` "sends every optional field that was supplied" (`:96-126`): add `mcq: MCQ` to both literals. "omits the fields the caller left alone" (`:128-138`): add `'mcq'` to the absent list (`:134`).
   d. One new case inside the `updateCard` describe, title verbatim:
      `it('sends mcq: null as an own key with value null, which is how a clear reaches the server', …)` — `await updateCard({ id: 101, deckId: 7, question: 'q', expectedVersion: 4, mcq: null })`; `const body = bodyOf(httpMock.put)`; `expect(Object.hasOwn(body, 'mcq')).toBe(true)`; `expect(body.mcq).toBeNull()`. A two-line comment: an absent key is "leave alone" on the server (`Helpers.cs:58`), so `null` is the only spelling of "clear".
   e. The five existing `it` titles stay verbatim — `sends every optional field that was supplied` (twice), `leaves out what was not supplied, rather than sending undefined`, `omits the fields the caller left alone`, `sends no expectedVersion at all when the caller did not supply one` — and `bodyOf`/`response`/the mocks are unchanged.

7. **`frontend/tests/cardMcqConsole.test.tsx` (new)** — line 1 is `// @vitest-environment jsdom`. Harness: `vi.hoisted` api object with `fetchDeckById`, `fetchCardsByDeck`, `createCard`, `updateCard`; `vi.mock('../src/api/authoring', async importOriginal => ({ ...(await importOriginal<typeof import('../src/api/authoring')>()), ...api }))`; `const { CardListPage } = await import('../src/pages/CardListPage');` and the same for `EditCardPage`, `NewCardPage`; `renderWithQuery` from `./support/queryTestClient` + `ConfirmDialogProvider` from `../src/components/ui/ConfirmDialog` for the list (copy `cardListPageDelete.test.tsx:105-116`), plain `render` + `MemoryRouter` for the two form pages (copy `cardEntryDefects.test.tsx:210-216`); `signInAsSuperAdmin`/`signOut` from `./support/consoleSession`; `ok` from `./support/apiResult`; a full `Deck` literal as in `cardListPageDelete.test.tsx:56-66`; a `card(over: Partial<Card> = {}): Card` builder like `cardEntryDefects.test.tsx:66-81` (id 101, version 4); the same `MCQ: McqBlob` fixture as change 6 (`import type { McqBlob } from '../src/types/mcq';`) but with `qualifier: 'LEAST operational overhead'` (the qualifier of §4.3 card 1 — the only MCQ phrase this file quotes; the panel does not validate that it appears in the question). `beforeEach`: `signOut(); signInAsSuperAdmin();` mock the two fetches, `api.updateCard.mockResolvedValue(ok(card()))`, `vi.spyOn(console, 'error').mockImplementation(() => {})`. `afterEach`: `cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); signOut();`. No `any` — read mock arguments as `Record<string, unknown>`. Six cases, each its own `it`, titles verbatim:
   1. `it('shows an MCQ badge in the Rarity cell of a card that carries mcq', …)` — `fetchCardsByDeck` → `[card(), card({ id: 102, stableUid: 'card-mcq', question: MCQ_QUESTION, mcq: MCQ })]`; mount the list; `await screen.findByText(MCQ_QUESTION)`; `screen.getAllByTestId('card-mcq-badge')` has length 1, its `textContent` is `MCQ`, and `badge.closest('tr')` contains `MCQ_QUESTION` (use `within`).
   2. `it('shows no MCQ badge on a Q/A card, whether mcq is null or absent', …)` — `[card({ mcq: null }), card({ id: 103, stableUid: 'card-qa-2', question: OTHER_QUESTION })]` (the second has no `mcq` key at all); after both questions are on screen, `screen.queryAllByTestId('card-mcq-badge')` is empty.
   3. `it('renders the read-only MCQ panel on the edit page when the card carries mcq', …)` — `fetchCardsByDeck` → `[card({ mcq: MCQ })]`; mount `EditCardPage` at `/decks/cards/edit?deckId=7&cardId=101`; `await screen.findByRole('button', { name: /save changes/i })`; `const panel = screen.getByTestId('card-form-mcq')`; `[...panel.querySelectorAll('[data-testid^="card-form-mcq-option-"]')].map(n => n.getAttribute('data-testid'))` equals `['card-form-mcq-option-a', 'card-form-mcq-option-b', 'card-form-mcq-option-c']`; exactly one `card-form-mcq-correct` in the panel and it sits inside `card-form-mcq-option-b`; `card-form-mcq-qualifier` text contains `LEAST operational overhead`; `card-form-mcq-required` text is `Single answer`; option a's text contains `Why the first option is wrong.`; `panel.querySelectorAll('input, textarea, select, button')` has length 0.
   4. `it('renders no MCQ panel on the edit page for a Q/A card', …)` — `[card({ mcq: null })]`; after the save button is on screen, `screen.queryByTestId('card-form-mcq')` is `null`.
   5. `it('renders no MCQ panel on the new-card page', …)` — mount `NewCardPage` at `/decks/cards/new?deckId=7`; `await screen.findByRole('button', { name: /create card/i })`; `screen.queryByTestId('card-form-mcq')` is `null`.
   6. `it('saving an MCQ card from the edit page sends no mcq key', …)` — `[card({ mcq: MCQ })]`; mount `EditCardPage`; wait for the save button; `await userEvent.click(saveButton)`; `await waitFor(() => expect(api.updateCard).toHaveBeenCalledTimes(1))`; `const sent = api.updateCard.mock.calls[0][0] as Record<string, unknown>`; `expect(sent).toMatchObject({ id: 101, expectedVersion: 4 })`; `expect(Object.hasOwn(sent, 'mcq')).toBe(false)`. A short comment: this is the page → function half; the function → wire half (an explicit `null` is forwarded) is in `authoringRequestBody.test.ts`.

Estimated size: `card.ts` +2, `authoring.ts` +5, `CardListPage.tsx` +1, `CardForm.tsx` ~+50, `EditCardPage.tsx` +1, `authoringRequestBody.test.ts` ~+30, `cardMcqConsole.test.tsx` ~190 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C12.verify.sh` re-runs exactly these.

1. Scope files exist: `frontend/tests/cardMcqConsole.test.tsx`; C11 prerequisite `frontend/src/types/mcq.ts` with `export interface McqBlob` and `export interface McqOption`.
2. Literal guards (all `grep -F`, exit 0):
   - `types/card.ts`: `import type { McqBlob } from './mcq';`, `mcq?: McqBlob | null;`.
   - `authoring.ts`: `import type { McqBlob } from '../types/mcq';`; `mcq?: McqBlob | null;` occurs exactly twice; `if (params.mcq !== undefined) body.mcq = params.mcq;` occurs exactly twice; no `params.mcq ??`, `params.mcq ||`, `if (params.mcq)`, `params.mcq != null`, `params.mcq !== null`; the number of `^export ` lines equals the base's.
   - `CardListPage.tsx`: `data-testid="card-mcq-badge"`, `>MCQ</span>`, `card.mcq ?`; `colSpan={8}`; exactly 8 `<th ` lines; the `RarityBadge` import line (`:8`, `import { RarityBadge } from '../components/RarityBadge';`) unchanged.
   - `CardForm.tsx`: `import type { McqBlob } from '../types/mcq';`, `mcq?: McqBlob | null;`, `data-testid="card-form-mcq"` (once), `Multiple choice</legend>`, `data-testid="card-form-mcq-required"`, `data-testid="card-form-mcq-qualifier"`, `card-form-mcq-option-`, `data-testid="card-form-mcq-correct"`; the `CardFormValues` block (`export interface CardFormValues {` … `}`) contains no `mcq`; the `../lib/cardRules` import lines are byte-identical to the base; no `mcqRules`; the number of `^export ` lines equals the base's; the text between `data-testid="card-form-mcq"` and `</fieldset>` contains no `<input`, `<textarea`, `<select`, `<button`.
   - `EditCardPage.tsx`: `mcq={card.mcq ?? null}`; no line matching `^\s*mcq:` (the submit literal never gains the key).
   - `authoringRequestBody.test.ts`: `'mcq'` at least twice (the two absent lists), `mcq: MCQ` at least four times, `mcq: null`, the new title, `.mcq).toBeNull()`, `'mcq')).toBe(true)`; the five existing titles present.
   - `cardMcqConsole.test.tsx`: line 1 `// @vitest-environment jsdom`; the six titles; `vi.mock('../src/api/authoring'`; imports of `CardListPage`, `EditCardPage`, `NewCardPage`, `McqBlob`; `card-mcq-badge`, `card-form-mcq`, `'mcq')).toBe(false)`; ≥ 6 `it(` blocks; no `examtopics` / `Question #N` text.
   - No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in the seven scope files.
3. `cd frontend && npm run lint && npm run build` — exit 0 (`build` is `tsc -b` over `src/` and `tests/` plus `vite build`).
4. `cd frontend && npx vitest run tests/cardMcqConsole.test.tsx tests/authoringRequestBody.test.ts tests/cardEntryDefects.test.tsx tests/editCardVersionConflict.test.tsx tests/cardFormHints.test.tsx tests/cardRuleDivergence.test.tsx tests/cardListPageDelete.test.tsx tests/cardListPageQueryWiring.test.tsx tests/deckImportRunner.test.ts tests/cardRulesWiring.test.ts tests/apiSurfaceCensus.test.ts tests/consoleDirectoryLayout.test.ts tests/hookWiring.test.ts tests/uiLanguage.test.ts tests/singleTheme.test.ts tests/typeGateFileSet2.test.ts --reporter=dot` — exit 0.
5. Scope + frozen guard: `git diff --name-only $(git merge-base HEAD delivery/r16-c-economy)` ∪ `git ls-files --others --exclude-standard -- frontend/src frontend/tests docs` ⊆ the seven scope files ∪ `docs/delivery/r16-issues/*`; the three frozen mobile files are zero-diff.

## Verify

```
bash docs/delivery/r16-issues/C12.verify.sh        # BASE=delivery/r16-c-economy is exported by the driver
```

The driver then runs the full frontend root gate on top of this — `cd frontend && npm run lint && npx vitest run && npm run build` — plus the diff-scoped banned-term grep and the suppression scan. The verify script is the targeted part; it does not replace the root gate.

## Do NOT

- Do NOT make the MCQ block editable in `CardForm` (no inputs in the fieldset, no `mcq` in `CardFormValues`, no `mcq` in either page's submit literal). The importer is the editor.
- Do NOT validate the blob in the console (`CardForm.tsx` must not import `../lib/mcqRules`; `mcqRules` is the importer's and stays out of the wiring tables).
- Do NOT drop or coerce `null`: `if (params.mcq !== undefined) body.mcq = params.mcq;` is the guard, verbatim, in both functions.
- Do NOT touch `frontend/src/types/mcq.ts`, `lib/deckImport.ts`, `lib/deckImportRunner.ts`, `lib/cardRules.ts`, `hooks/*`, `NewCardPage.tsx`, `ContentIntelligencePage.tsx`, or any file outside `frontend/`.
- Do NOT add a table column (header + `colSpan` would both move); the badge lives inside the Rarity cell.
- Do NOT add an export to `authoring.ts` or `CardForm.tsx`, a file under `src/pages/`, a hook, a `dark:` class, a Chinese character under `src/`, or an `any`.
- Do NOT edit any existing test other than `authoringRequestBody.test.ts`, and that one only as change 6 says.
- Do NOT quote exam-dump content anywhere; the fixtures use neutral placeholder option text, and the only MCQ phrase quoted is the §4.3 card-1 qualifier.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `npm install`, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`).

# F02 — r24bx fix round: home and library copy (issue #680)

Fixes ledger for the review findings on W02 (R24B plain words: Home, Library, Card detail).

### h-tests-1

Status: fixed

Finding: the Library no-draws banner (LibraryHeader) and the Card detail locked-card button (CardDetailScreen) were
only checked as source text in `mobile/tests/unit/homePlainWords.spec.ts`, never rendered.

Confirmed: searching `mobile/tests` for `Earn draws`, `card-detail-locked-cta` and the `library-open-first-pack-cta`
banner found only the readFileSync + toContain checks in homePlainWords.spec. No test rendered either surface.

Fix (test-only; the shipped copy was already correct, so no source file changes):
- Added `mobile/tests/integration/plain-words-rendered.screen.test.tsx`, a react-test-renderer test that:
  - renders LibraryHeader with ownedCount=0, totalCount=10, onOpenFirstPack set and openFirstPackHasPulls=false, and
    checks the banner title "Earn draws in a session, then open your first pack" and the accessibilityLabel
    "Earn draws in a session to open your first pack" (with no "pull" wording);
  - renders the openFirstPackHasPulls=true branch and checks "Open your first pack to start collecting" in both the
    title and the label, and that no "Earn draws" line shows;
  - checks the banner is hidden once a card is owned;
  - renders CardDetailScreen on a locked card and checks that testID `card-detail-locked-cta` has the
    accessibilityLabel "Open reward pack" and exactly the Text "Open reward pack", and that an owned card shows no
    such button.
- The source search in homePlainWords.spec stays as a backstop.
- `docs/delivery/r24b-issues/W02-notes.md` "How it is tested" no longer presents the source search as coverage of the
  shipped wording, and points to the new rendered test.

Proof that the new test catches the reviewer's scenarios (mutations applied locally, run, then reverted):
- Swapped the two LibraryHeader ternary branches: the 2 banner-branch tests failed; homePlainWords.spec still passed.
- Moved "Open reward pack" into a JSX comment in CardDetailScreen and rendered a different label: the locked-button
  test failed; homePlainWords.spec still passed.
On the current code the new test passes, since the finding is a coverage gap and not a copy defect.

Files changed:
- `mobile/tests/integration/plain-words-rendered.screen.test.tsx` (new)
- `docs/delivery/r24b-issues/W02-notes.md`
- `docs/delivery/r24bx-issues/F02-fixes.md` (this ledger)

Test: `cd mobile && npx vitest run tests/integration/plain-words-rendered.screen.test.tsx`

## Gate repair outside the findings: plainWordsGuard PENDING list

`F02.verify.sh` step 3 (`npx vitest run`) failed on the unchanged base (`delivery/r24bx-h`) in
`mobile/tests/unit/plainWordsGuard.test.ts` > "keeps PENDING honest". That check fails once a PENDING module holds no
jargon, and W01 #669, W02 #670 and W03 #671 are all merged into release/r24b, so `ceremonyCopy.ts`,
`homeSelectors.ts`, `summaryMapper.ts`, `rewardResolver.ts` and `mcqConstants.ts` are all clean. The test's own comment
says the release merge empties the list. PENDING is now empty, so the five modules go from "still holds jargon" to the
full per-module "uses plain words" guard. That adds coverage and removes none.

File changed: `mobile/tests/unit/plainWordsGuard.test.ts`. Test: `cd mobile && npx vitest run tests/unit/plainWordsGuard.test.ts` (15 passed).

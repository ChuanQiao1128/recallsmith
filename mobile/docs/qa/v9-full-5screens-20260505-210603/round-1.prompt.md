Work only in /Users/qc/Desktop/DeveloperCards/recallsmith/mobile.
Do not run any git command. Ignore all ../frontend changes.

Goal: implement FINAL v9 (not sprint) for these 5 screens:
- src/screens/HomeScreen.tsx
- src/screens/DrawScreen.tsx
- src/screens/DrawCeremonyScreen.tsx
- src/screens/DrawResultScreen.tsx
- src/screens/LibraryScreen.tsx

Read and follow as source-of-truth:
1) docs/design/v9-reference-aligned-spec.md
2) docs/design/v9-screen-diff.md
3) docs/design/v9-copy-delta.md
4) docs/design/v9-test-impact.md
5) docs/design/v9.1-mechanism-spec.md (for draw mechanism consistency)

Required final behavior:
- Home: pack-first entry, open-cta priority, study link downgraded.
- Draw: hero + only two action buttons (Open 10 / Open 1), no extra explanatory cards.
- Ceremony: full 5-phase cadence (approach/hold/tear-flip/flash-reveal/settle), skip gate after reveal lock.
- Result: collection bar + single primary CTA routing by remaining pulls + Done link.
- Library: All/Owned/Missing as primary axis, owned bright / missing dim visual semantics, focusSlug+scrollToNew behavior.

Constraints:
- No new dependencies unless strictly unavoidable.
- Keep existing route graph; only optional params already allowed for Library/DrawResult.
- Keep stable testIDs unless v9 docs explicitly require rename/addition.
- Do not touch auth/premium/sync/api/notifications modules.
- No edits outside mobile/.

Execution:
1) Implement all 5 pages end-to-end.
2) Update related tests accordingly.
3) Run:
   - npm run test:typecheck
   - npx vitest run tests/integration/home.screen.test.tsx tests/integration/draw.screen.test.tsx tests/integration/draw-ceremony.screen.test.tsx tests/integration/draw-result.screen.test.tsx tests/integration/library-final.screen.test.tsx tests/unit/homeSelectors.spec.ts tests/unit/draw.test.ts tests/unit/library.test.ts
   - npm run test:integration
4) If any fail, self-repair and rerun up to completion.

Final output must include:
- changed files
- what reached final v9
- what still not fully done
- exact test results

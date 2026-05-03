# RecallSmith Mobile v6 Final Polish Plan

> For Hermes: use subagent-driven-development skill to implement this plan task-by-task.

Goal: finish the remaining RecallSmith mobile v6 tail work so the app feels like a coherent, commercially polished product shell rather than a mostly-complete prototype with uneven support surfaces.

Architecture: keep the existing v6/v6.1 in-place React Native structure, preserve the passing test gate, and focus on the remaining tail work in small batches: cleanup, remaining support/auth/deck productization, final consistency pass, and launch verification. Do not reopen core route/session architecture unless a blocking bug is discovered.

Tech stack: Expo, React Native, TypeScript, React Navigation, Vitest, react-test-renderer, Xcode iOS Simulator.

---

## Phase 1: workspace and artifact cleanup

### Task 1: remove duplicate planning/docs artifacts with ` 2` suffix
Objective: clean the workspace so later audits and searches do not overcount stale duplicates.

Files:
- Delete: `mobile/* 2.md`
- Delete: `mobile/* 2.html`
- Delete: `mobile/src/**/** 2.ts`
- Delete: `mobile/src/**/** 2.tsx`
- Delete: `mobile/vitest.config 2.ts`

Step 1: list duplicate artifacts
Run: `find mobile -name '* 2.*' | sort`
Expected: duplicate docs/config artifacts are listed

Step 2: delete only the duplicate ` 2` artifacts
Run: `find mobile -name '* 2.*' -print -delete`
Expected: duplicates removed, canonical files remain

Step 3: verify cleanup
Run: `find mobile -name '* 2.*' | wc -l`
Expected: `0`

Step 4: run typecheck
Run: `cd mobile && npm run test:typecheck`
Expected: pass

### Task 2: commit cleanup checkpoint
Objective: keep the branch readable before more UI edits.

Files:
- Modify: git index only

Step 1: review status
Run: `git status --short -- mobile`
Expected: only intended mobile changes appear

Step 2: commit
Run:
`git add mobile && git commit -m "chore: clean duplicate mobile artifacts"`

---

## Phase 2: finish remaining productization gaps

### Task 3: productize auth/account-adjacent support screens
Objective: remove leftover spec/prototype tone from sign-in/sign-up/confirm/about/help/support surfaces.

Files:
- Modify: `mobile/src/screens/SignInScreen.tsx`
- Modify: `mobile/src/screens/SignUpScreen.tsx`
- Modify: `mobile/src/screens/ConfirmSignUpScreen.tsx`
- Modify: `mobile/src/screens/AboutScreen.tsx`
- Modify: `mobile/src/screens/HelpFAQScreen.tsx`
- Test: `mobile/tests/integration/phase-c-complete.screen.test.tsx`
- Test: `mobile/tests/integration/me-final.screen.test.tsx`

Step 1: add or tighten failing expectations for more product-grade copy
Step 2: run narrow integration tests and verify failure
Run: `cd mobile && npm run test:integration -- phase-c-complete.screen.test.tsx me-final.screen.test.tsx`

Step 3: update copy/layout minimally to satisfy the tests
Guidelines:
- avoid internal phrases like “spec note”, “full app”, “mock-backed”
- keep auth wording adult, calm, and commercially believable
- preserve route behavior

Step 4: rerun narrow tests
Expected: pass

Step 5: commit
`git add mobile/src/screens/SignInScreen.tsx mobile/src/screens/SignUpScreen.tsx mobile/src/screens/ConfirmSignUpScreen.tsx mobile/src/screens/AboutScreen.tsx mobile/src/screens/HelpFAQScreen.tsx mobile/tests/integration/phase-c-complete.screen.test.tsx mobile/tests/integration/me-final.screen.test.tsx && git commit -m "feat: polish auth and support surfaces"`

### Task 4: finish deck/paywall late-stage language cleanup
Objective: make locked/unavailable/premium surfaces feel intentional instead of placeholder-like.

Files:
- Modify: `mobile/src/screens/DeckScreen.tsx`
- Modify: `mobile/src/screens/PaywallScreen.tsx`
- Test: add/update targeted integration assertions if needed under `mobile/tests/integration/`

Step 1: add failing expectations for locked/premium wording if current tests do not already guard it
Step 2: run narrow tests
Step 3: replace prototype-ish copy with release-quality copy
Guidelines:
- unavailable decks should sound gated/release-scoped, not fake
- premium should sound valuable and stable, not “coming soon” heavy
- preserve business logic and gating rules

Step 4: rerun narrow tests and `npm run test:typecheck`
Step 5: commit

### Task 5: finish system/support route consistency
Objective: ensure error/debug/offline/support pages all feel like one coherent product support lane.

Files:
- Modify: `mobile/src/screens/DebugMenuScreen.tsx`
- Modify: `mobile/src/screens/ErrorNetworkScreen.tsx`
- Modify: `mobile/src/screens/ErrorGenericScreen.tsx`
- Modify: `mobile/src/screens/OfflineBannerScreen.tsx`
- Modify: `mobile/src/screens/ToastHostScreen.tsx`
- Modify: `mobile/src/screens/CoachOverlayScreen.tsx`
- Test: `mobile/tests/integration/phase-c-complete.screen.test.tsx`

Step 1: tighten tests around visible support/system phrasing where missing
Step 2: run narrow test to verify failure
Step 3: align titles, support copy, and next actions across these screens
Step 4: rerun test
Step 5: commit

---

## Phase 3: final consistency and regression pass

### Task 6: final copy sweep for remaining phase/prototype leftovers
Objective: eliminate residual `Phase`, `placeholder`, `coming soon`, `mock-backed` style copy in shipped user-facing surfaces where not intentionally required.

Files:
- Scan: `mobile/src/screens/*.tsx`
- Modify only files with user-facing residue

Step 1: grep for residual phrases
Run: `cd mobile && rg -n "Phase A|Phase B|Phase C|placeholder|coming soon|mock-backed" src/screens`

Step 2: patch only user-facing residues that still matter
Step 3: rerun `npm run test:typecheck`
Step 4: commit

### Task 7: full automated gate
Objective: verify no regression after the polish pass.

Files:
- Modify: none expected

Step 1: run full gate
Run:
- `cd mobile && npm test`
- `cd mobile && npm run test:coverage`
Expected: all passing

Step 2: if failures occur, fix minimally and rerun until green

Step 3: commit
`git add mobile && git commit -m "test: pass final mobile polish gate"`

### Task 8: iOS simulator verification
Objective: verify the polished app still launches in the iOS simulator and connects to Metro.

Files:
- Modify: none expected unless a launch issue is found

Step 1: run iOS app
Run: `cd mobile && npm run ios -- --device "iPhone 16 Pro"`

Step 2: verify simulator boot/install
Run:
- `xcrun simctl list devices | grep Booted || true`
- `open -a Simulator`

Step 3: verify Metro is alive
Run:
- `lsof -nP -iTCP:8081 -sTCP:LISTEN || true`
- `curl -I http://127.0.0.1:8081 || true`

Step 4: if needed, restart Metro cleanly
Run: `cd mobile && npm start -- --clear`
Then reopen dev client on simulator with localhost URL.

Step 5: commit only if code changed during recovery

---

## Final verification checklist
- [ ] no `* 2.*` duplicate artifacts remain under `mobile/`
- [ ] auth/support/deck/paywall pages use release-quality copy
- [ ] support/system route family feels consistent
- [ ] `npm test` passes
- [ ] `npm run test:coverage` passes
- [ ] iOS simulator launches and Metro responds on 8081
- [ ] branch is ready for concentrated human review

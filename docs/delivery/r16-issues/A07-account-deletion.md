# A07 — account-deletion: real in-app account deletion (R4, App Store 5.1.1(v))

## Context

The app supports Cognito sign-up (`mobile/App.tsx:257-259`, `mobile/src/auth/authStore.ts:143-166`) but the only reachable settings tree — `Settings` → `mobile/src/features/gacha/settings/account/AccountSection.tsx:7-17` — offers Sign out and Fresh Start, never deletion; the only "Delete account" button lives in the unreachable mock island (`mobile/src/screens/DeleteAccountConfirmScreen.tsx:35-36` navigates to Welcome and deletes nothing, fed by `DELETE_PREVIEW` in `mobile/src/mock/settings.ts:14-19`). This issue adds a real, typed-confirmation delete row to `AccountSection` that calls Amplify `deleteUser()`, purges the deleted account's user-scoped AsyncStorage partition, signs out, and removes the fake delete path (`SettingsAccountScreen`, `DeleteAccountConfirmScreen`, `DELETE_PREVIEW`) plus its route registrations. Spec: `mobile/docs/qa/1.5.0-preflight-findings.md:14-26` (first finding, 建议修法), `docs/release-1.6.0-plan-2026-09-19.md:239` (R4), `docs/delivery-wave-1.6-plan-2026-09-19.md:72` (A07), `docs/home-review-and-launch-copy-2026-09-17.md:416` ("App 内删账号 | 是不可达的 mock").

Read first, in this order: `AccountSection.tsx` (whole file, 145 lines), `authStore.ts:255-274` (`signOutNow` — the deletion action mirrors its teardown), `authStore.ts:108-120` (store factory: it is `create<AuthState>((set) => …)` today; you will need `get`), `mobile/src/features/debug/resetProgress.ts:8-15,55-63` (the existing prefix sweep + the two cache invalidations that MUST follow any prefix delete), `mobile/src/sync/progressSync.ts:147-149,727-760` (the `devcards:u:{sub}:` partition and `setActiveUserSub`; frozen — read only), `mobile/src/screens/SettingsScreen.tsx:96-100,176-179,302-310` (how AccountSection is mounted; NOT in scope), `mobile/tests/integration/settings.screen.test.tsx:25-45,62-66,95-103` (mocks that constrain AccountSection: no `TextInput`, no `useNavigation`, authStore mocked without `getState`), `mobile/tests/unit/settings-copy.spec.ts` (forbids `wipe` / `delete all` in `ACCOUNT_COPY`, and imports AccountSection under a react-native mock with only View/Text/Pressable/StyleSheet), `mobile/tests/integration/auth-polish.screen.test.tsx:5-20` (the react-native mock shape to copy for the new test, including `TextInput`).

## Constraints

- Scope (only these paths may change; nothing else):
  - `mobile/src/features/gacha/settings/account/AccountSection.tsx` (edit)
  - `mobile/src/auth/authStore.ts` (edit — A08 also edits this file: keep your change to ONE new action `deleteAccountNow` + ONE module-level helper `purgeUserScopedStorage` + the extra imports; do not reorder or reformat existing code)
  - `mobile/src/screens/SettingsMainScreen.tsx` (edit: lines 49-50 only)
  - `mobile/src/mock/settings.ts` (edit: remove `DELETE_PREVIEW`, keep `SETTINGS_SNAPSHOT`)
  - `mobile/src/screens/SettingsAccountScreen.tsx` (DELETE)
  - `mobile/src/screens/DeleteAccountConfirmScreen.tsx` (DELETE)
  - `mobile/App.tsx` (edit: lines 58-59 imports, 220-221 routes)
  - `mobile/src/navigation/types.ts` (edit: lines 68-69)
  - `mobile/tests/integration/account-deletion.test.tsx` (CREATE)
  - `mobile/tests/integration/me-final.screen.test.tsx` (test-only scope extension, forced by the deletions: it imports both deleted screens at lines 33 and 36. Allowed edits are exactly the removals listed in change 8 — nothing else in that file.)
- Why the island is only partly deleted: `SettingsMainScreen` is imported by four out-of-scope test files (`me-final`, `phase-c-complete`, `phase-c-shells`, `support-pool-polish`) and `SETTINGS_SNAPSHOT` / `navigate('SettingsMain')` are used by the out-of-scope `SettingsNotifications|Audience|Pools|Appearance` screens. Deleting them is a separate hygiene issue. This issue removes the fake delete PATH (SettingsAccount → DeleteAccountConfirm) and cuts the only link into it (`SettingsMainScreen.tsx:49-50`).
- Frozen files (gacha-v7.md §2.1) — must show zero lines in `git diff --numstat`: `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Import from `progressSync` (`setSyncAccessToken` is already imported in authStore); never edit it.
- `mobile/src/auth/authStore.ts` sits under gacha-v7 §2.1's wider `src/auth/*` glob (`mobile/gacha-v7.md:86`); the wave's frozen list names only the three files above, so editing it is allowed here, but the change is confined to one new action (`deleteAccountNow`) + one module-level helper (`purgeUserScopedStorage`) + their imports — no other line of that file moves.
- Scope size: 10 paths (8 non-test + 2 test files) exceeds the brief template's ≤ 8-file guide by two; accepted because the two extra entries are forced, not chosen — deleting the two mock screens breaks `me-final.screen.test.tsx`'s imports (line 33/36), and the new `account-deletion.test.tsx` is the required coverage. Non-test LOC stays well under 400.
- No new dependencies. `aws-amplify/auth` already exports `deleteUser` (Amplify 6.15; `node_modules/@aws-amplify/auth/dist/esm/index.d.ts:1`). `@react-native-async-storage/async-storage` is already a dependency.
- AccountSection must NOT statically import `../../../../auth/authStore` and must NOT call `useNavigation`. Reasons, both verified against the current tests: (1) `tests/unit/settings-copy.spec.ts` imports `ACCOUNT_COPY` from AccountSection under a react-native mock with only View/Text/Pressable/StyleSheet; a static authStore import drags in `progressSync → expo-crypto → expo-modules-core`, which reads `TurboModuleRegistry` from that mock at module scope and throws. (2) `tests/integration/settings.screen.test.tsx:62-66` mocks `@react-navigation/native` with only `useFocusEffect`; vitest's mock proxy throws on any other export access. Use the repo's existing lazy pattern instead — `const { useAuthStore } = await import('../../../../auth/authStore');` inside the press handler (precedent: `mobile/src/features/gacha/draw/drawCommit.ts:43`, `mobile/src/screens/CardDetailScreen.tsx:31-58`). After deletion the store flips to `anonymous`, SettingsScreen re-renders signed-out, and AccountSection shows a local "deleted" notice; there is no navigation.
- `deleteAccountNow` must NOT set `loading: true` on the store: `SettingsScreen.tsx:184` swaps the whole screen for a spinner while `authLoading` is true, which would unmount AccountSection mid-flow and lose the confirmation UI / notice. Progress state lives in the component (`deleting`).
- testIDs to keep unchanged: `screen-settings-root`, `screen-settings-primary-cta` (single anchor — `settings.screen.test.tsx:230` asserts exactly one element carries it; the new delete controls must use the new testIDs below, never `primaryCtaTestID`).
- New testIDs (exact strings): `settings-delete-account-open`, `settings-delete-account-input`, `settings-delete-account-confirm`, `settings-delete-account-cancel`.
- Copy rule: `ACCOUNT_COPY` serialized lowercase must not contain `wipe` or `delete all` (`tests/unit/settings-copy.spec.ts:23`). Do not claim server-side data is erased — `deleteUser()` removes the Cognito user only; the sync rows are a backend follow-up.
- Existing test literals that change: in `tests/integration/me-final.screen.test.tsx` only — the `'Account & billing'` assertions (lines 141, 225-228) and the `SettingsAccountScreen` / `DeleteAccountConfirmScreen` render blocks (lines 169-177, 197-204) go away because the screens do. Every other test file stays byte-identical.
- No `@ts-ignore` / `@ts-expect-error` / `eslint-disable`; no tsconfig changes.

## Changes required

1. `mobile/src/auth/authStore.ts` — add the deletion action.
   - Line 4-12: add `deleteUser` to the existing `from 'aws-amplify/auth'` import list (keep it one import statement).
   - Add imports: `import AsyncStorage from '@react-native-async-storage/async-storage';`, `import { invalidateProgressQueueCache } from '../sync/progressQueueCache';`, `import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';` (both are leaf modules with type-only imports — no cycle).
   - Line 38: add `deleteAccountNow: () => Promise<void>;` to `AuthState` after `signOutNow`.
   - Add a module-level helper (above `useAuthStore`):
     ```ts
     const DEVICE_STREAK_PREFIX = 'recallsmith:streaks:';
     export async function purgeUserScopedStorage(userSub: string | null): Promise<string[]> {
       const scoped = userSub ? `devcards:u:${userSub}:` : null;
       let keys: readonly string[] = [];
       try { keys = await AsyncStorage.getAllKeys(); } catch { return []; }
       const doomed = keys.filter(
         (k) => (scoped !== null && k.startsWith(scoped)) || k.startsWith(DEVICE_STREAK_PREFIX),
       );
       if (doomed.length > 0) { try { await AsyncStorage.multiRemove(doomed); } catch {} }
       invalidateProgressQueueCache(userSub ?? undefined);
       invalidateDrawStateCache();
       return doomed;
     }
     ```
     `devcards:u:{sub}:` is the partition every user-scoped subsystem writes under (`review/storage.ts:23-24,79-81`: deck progress, daily stats, meta; `rewardWallet.ts:26-30`: wallet + seeded flag + session receipts; `drawStateStore.ts:85-89`: draw state + history; `economyFloor.ts:117`; `drawStateSync.ts:180-196`; `progressSync.ts:147-149`: queue, cursor, remote cache). `recallsmith:streaks:` is device-level (`streakTracker.ts:3-4`) and goes with the account per the issue notes. The `anon` partition and other accounts' partitions are NOT touched. The two invalidations are mandatory for the same reason `resetProgress.ts:55-63` gives: both caches would otherwise write the deleted partition back from memory.
   - Line 108: change the factory to `create<AuthState>((set, get) => ({`.
   - After `signOutNow` (line 274), add:
     ```ts
     deleteAccountNow: async () => {
       const sub = get().userSub;
       set({ lastError: null });
       try {
         await deleteUser();
       } catch (err: any) {
         // Account still exists: keep the session, surface the error, purge nothing.
         const msg = err?.message ?? 'Delete account failed';
         set({ lastError: msg });
         throw new Error(msg);
       }
       try { await signOut(); } catch {}
       await setSyncAccessToken(null); // clears activeUserSub + cancels pending sync (frozen helper, unchanged)
       await purgeUserScopedStorage(sub);
       set({ status: 'anonymous', userId: null, email: null, userSub: null, accessToken: null, idToken: null, lastError: null });
     },
     ```
     Order matters: token/sub cleared BEFORE the purge so no sync can be scheduled into the partition being deleted; `loading` is never touched (see Constraints).

2. `mobile/src/features/gacha/settings/account/AccountSection.tsx` — the delete row.
   - Line 2: import `TextInput` alongside the existing react-native imports; line 1: `import React, { useState } from 'react';`.
   - Extend `ACCOUNT_COPY` (lines 7-17) with exactly these keys/values:
     ```ts
     deleteTitle: 'Delete account',
     deleteBody: 'Permanently deletes your sign-in and removes the progress, cards and streak stored on this device for it. This cannot be undone.',
     deleteOpen: 'Delete account',
     deleteConfirmPrompt: 'Type DELETE to confirm',
     deleteConfirmCta: 'Delete my account',
     deleteCancel: 'Keep my account',
     deleting: 'Deleting...',
     deleteError: 'Could not delete your account. Check your connection and try again.',
     deletedNotice: 'Your account was deleted and you are signed out.',
     ```
     and export `export const DELETE_CONFIRM_TOKEN = 'DELETE';`.
   - Props (lines 19-27) are unchanged; SettingsScreen is out of scope and keeps passing the same props. Add component state: `confirmOpen`, `confirmText`, `deleting`, `deleteError` (string | null), `deleted`.
   - Render, after the Fresh Start block and a second `styles.rule`, in this order:
     - If `deleted`: a `<Text>` with `ACCOUNT_COPY.deletedNotice` (rendered regardless of `signedIn`, because the store has already flipped to anonymous by then). Nothing else from this block.
     - Else if `signedIn` and `!confirmOpen`: title `deleteTitle`, body `deleteBody`, and a secondary-style `<Pressable testID="settings-delete-account-open">` with `deleteOpen` that sets `confirmOpen = true`.
     - Else if `signedIn` and `confirmOpen`: `deleteConfirmPrompt`, a `<TextInput testID="settings-delete-account-input" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} placeholder={DELETE_CONFIRM_TOKEN} editable={!deleting} />`, then `<Pressable testID="settings-delete-account-confirm" disabled={!armed || deleting}>` showing `deleting ? ACCOUNT_COPY.deleting : ACCOUNT_COPY.deleteConfirmCta`, then `<Pressable testID="settings-delete-account-cancel" disabled={deleting}>` showing `deleteCancel` (resets `confirmOpen`, `confirmText`, `deleteError`), then `deleteError` as `<Text>` when non-null. `armed = confirmText.trim() === DELETE_CONFIRM_TOKEN` (case-sensitive).
     - Signed out and not deleted: render nothing for this block (no row, no rule).
   - Confirm handler (the guard is in code, not only in `disabled` — the test mocks `Pressable` without honouring `disabled`):
     ```ts
     async function onConfirmDelete() {
       if (deleting || confirmText.trim() !== DELETE_CONFIRM_TOKEN) return;
       setDeleting(true);
       setDeleteError(null);
       try {
         const { useAuthStore } = await import('../../../../auth/authStore');
         await useAuthStore.getState().deleteAccountNow();
         setDeleted(true);
         setConfirmOpen(false);
         setConfirmText('');
       } catch {
         setDeleteError(ACCOUNT_COPY.deleteError);
       } finally {
         setDeleting(false);
       }
     }
     ```
   - Styles: reuse `secondaryButton`/`secondaryButtonText` for open/cancel; add `dangerButton` (filled `#B42318`, minHeight 44, radius `spacing.buttonRadius`) + `dangerButtonText` (`colors.parchmentBg`, `typography.button`, weight '800'), `disabledButton` (opacity 0.45), `confirmInput` (minHeight 44, borderWidth 1, borderColor 'rgba(42,34,24,0.18)', radius `spacing.buttonRadius`, paddingHorizontal `spacing.sm`, fontSize `typography.body`, color `colors.ink`, marginTop `spacing.sm`), `errorText` (`typography.caption`, color '#B42318', marginTop `spacing.xs`), `noticeText` (`typography.bodySmall`, `colors.inkSecondary`, marginTop `spacing.xs`).

3. `mobile/src/screens/SettingsMainScreen.tsx` — delete lines 49-50 (`tertiaryLabel="Account & billing"` and `onTertiary={() => navigation.navigate('SettingsAccount')}`). `AppInfoScreen` treats both as optional (`AppInfoScreen.tsx:29-32,103`). Nothing else changes in this file.

4. `mobile/src/mock/settings.ts` — delete the `DELETE_PREVIEW` export (lines 14-19). Keep `SETTINGS_SNAPSHOT` (still imported by four out-of-scope screens).

5. Delete `mobile/src/screens/SettingsAccountScreen.tsx` and `mobile/src/screens/DeleteAccountConfirmScreen.tsx` (`git rm`).

6. `mobile/App.tsx` — remove the imports at lines 58-59 (`SettingsAccountScreen`, `DeleteAccountConfirmScreen`) and the two `<Stack.Screen>` registrations at lines 220-221 (`name="SettingsAccount"`, `name="DeleteAccountConfirm"`).

7. `mobile/src/navigation/types.ts` — remove lines 68-69 (`SettingsAccount: undefined;`, `DeleteAccountConfirm: undefined;`). Do not leave the routes typed (see the `Review` rationale at `types.ts:154-159`).

8. `mobile/tests/integration/me-final.screen.test.tsx` — removals only: line 33 (`import { SettingsAccountScreen } …`), line 36 (`import { DeleteAccountConfirmScreen } …`), line 141 (`expect(mainBlob).toContain('Account & billing');`), lines 169-177 (the `accountTree` block through its `expect(...).not.toContain('concrete front-end page');` and the blank line), lines 197-204 (the `deleteTree` block), lines 225-228 (the `'Account & billing'` press + `expect(navigate).toHaveBeenCalledWith('SettingsAccount');`) plus the blank line that follows. Do not touch any other assertion.

9. Create `mobile/tests/integration/account-deletion.test.tsx` (vitest + react-test-renderer, same shape as `auth-polish.screen.test.tsx`). Mocks: `react-native` (View/Text/Pressable with `onPress` passthrough/TextInput/StyleSheet/Platform), `aws-amplify/auth` (every name authStore imports: `signUp, confirmSignUp, resendSignUpCode, signIn, signOut, fetchAuthSession, getCurrentUser, deleteUser` — `deleteUser` and `signOut` as `vi.fn()` you can inspect), `@react-native-async-storage/async-storage` (Map-backed `getItem/setItem/removeItem/getAllKeys/multiRemove`), `../../src/sync/progressSync` (`setSyncAccessToken`, `setActiveUserSub`, `forceProgressSync`, `scheduleProgressSync` as `vi.fn(async () => {})`). Use the REAL `useAuthStore` (`useAuthStore.setState({ status: 'signed_in', userId: 'sub-1', userSub: 'sub-1', email: 'a@b.c' })` in `beforeEach`; `vi.clearAllMocks()` + map reset). Cases (all five required):
   1. `deleteAccountNow` happy path: seed keys `devcards:u:sub-1:deck-progress:csharp-basics`, `devcards:u:sub-1:recallsmith:reward-wallet:v1`, `devcards:u:sub-1:devcards:draw-state:csharp-basics`, `recallsmith:streaks:snapshot:v1` (doomed) and `devcards:u:anon:deck-progress:csharp-basics`, `devcards:u:sub-2:deck-progress:csharp-basics`, `recallsmith:onboarding:stage` (keepers). Assert `deleteUser` called once, `signOut` called once, `setSyncAccessToken` called with `null`, the store map now holds exactly the three keepers, `useAuthStore.getState().status === 'anonymous'` and `userSub === null`.
   2. `deleteUser` rejects: `deleteAccountNow` rejects, `multiRemove` not called, `signOut` not called, `status` still `'signed_in'`, `lastError` non-null.
   3. Component happy path: render `<AccountSection signedIn email="a@b.c" resetting={false} onSignIn={vi.fn()} onSignOut={vi.fn()} onResetReviewSchedule={vi.fn()} primaryCtaTestID="screen-settings-primary-cta" />`; press `settings-delete-account-open`; assert `settings-delete-account-input` exists; call its `onChangeText('delete')`; press `settings-delete-account-confirm` → `deleteUser` NOT called; `onChangeText('DELETE')`; press confirm inside `await act(async …)` and flush microtasks → `deleteUser` called once and the text blob contains `ACCOUNT_COPY.deletedNotice`.
   4. Signed out: `findAllByProps({ testID: 'settings-delete-account-open' })` is empty and the blob does not contain `ACCOUNT_COPY.deleteTitle`.
   5. Single-anchor contract: with the confirm panel open, exactly one node has `testID: 'screen-settings-primary-cta'`.

## Acceptance

- `cd mobile && npm run test:typecheck`
- `cd mobile && npx vitest run tests/integration/account-deletion.test.tsx tests/integration/me-final.screen.test.tsx tests/integration/settings.screen.test.tsx tests/unit/settings-copy.spec.ts --reporter=dot`
- `cd mobile && npx vitest run --reporter=dot` (whole suite; 89 files / 529 tests green on base, +1 file after)
- `test ! -e mobile/src/screens/SettingsAccountScreen.tsx && test ! -e mobile/src/screens/DeleteAccountConfirmScreen.tsx && ! grep -rnE "SettingsAccount[S':\"]|DeleteAccountConfirm|DELETE_PREVIEW" mobile/App.tsx mobile/src mobile/tests` (the fake path is gone everywhere)
- `grep -q "deleteAccountNow" mobile/src/auth/authStore.ts && grep -q "deleteUser" mobile/src/auth/authStore.ts && grep -q "recallsmith:streaks:" mobile/src/auth/authStore.ts && grep -q "settings-delete-account-confirm" mobile/src/features/gacha/settings/account/AccountSection.tsx && ! grep -q "useNavigation\|from '../../../../auth/authStore'" mobile/src/features/gacha/settings/account/AccountSection.tsx && [ -z "$(git diff --numstat $(git merge-base HEAD delivery/r16-a-home) -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts)" ]`

`docs/delivery/r16-issues/A07.verify.sh` runs exactly these.

## DO NOT

- Do not push, do not open a PR, never touch `main`, no deploy / `eas update` / `eas build`.
- Do not disable, skip, delete or gut tests beyond the eight enumerated removals in change 8; do not add `@ts-ignore` / `@ts-expect-error` / `eslint-disable`; do not loosen tsconfig.
- Do not edit the frozen files (`deckRepository.ts`, `progressSync.ts`, `review/model.ts`).
- Do not edit `SettingsScreen.tsx`, `settings.screen.test.tsx`, `settings-copy.spec.ts`, `SettingsNotifications|Audience|Pools|Appearance` screens, `phase-c-*`, `support-pool-polish`, `main-tabs` tests, or `accountActions.ts` — out of scope (A06 owns `SettingsScreen.tsx`).
- Do not delete `SettingsMainScreen.tsx` or `SETTINGS_SNAPSHOT` (out-of-scope consumers; separate follow-up issue).
- Do not navigate after deletion (`useNavigation`, `navigationRef`, `reset`) and do not add a new screen/route for the confirmation — the typed confirmation lives inline in AccountSection.
- Do not purge the `anon` partition, other subs' partitions, `devcards:auth:*` keys directly (setSyncAccessToken owns them), onboarding/audience/active-deck keys, or call `resetAllProgress` (it wipes every account on the device).
- Do not add any new dependency, any `Alert.prompt`, or a static authStore import in AccountSection.
- Do not change `primaryCtaTestID` wiring or the Sign in / Sign out / Fresh Start behaviour and copy.

# A05 — R2 notifications: no OS permission request from `syncDailyReminders`; title `DeveloperCards`; one default reminder; permission prompt after the first pack opening

## Context

`mobile/src/notifications/reminders.ts:108-114` (`ensurePermission`) calls `Notifications.requestPermissionsAsync()` and is invoked from `syncDailyReminders` at `reminders.ts:275-276`, which `mobile/src/features/gacha/home/deckActionResolver.ts:251` fires on every Home refresh — so a user who tapped "Not now" on `PermissionPromptScreen` still gets the iOS system sheet seconds later on Home (spec: `docs/home-review-and-launch-copy-2026-09-17.md` §3.1 row 3(c), `docs/release-1.6.0-plan-2026-09-19.md` scope row R2 at line 237). The same file ships two enabled reminders by default (`reminders.ts:24-29`) and the stale brand `title: 'DevCards'` (`reminders.ts:161`). Per §3.2 "通知权限时机", onboarding currently routes Splash → Welcome → AudienceSurvey → PermissionPrompt → Home (`mobile/src/screens/AudienceSurveyScreen.tsx:31`), asking for permission before the user has opened a single pack; this change routes AudienceSurvey → Home directly and pushes `PermissionPrompt` once, from the first `DrawResultScreen` the user leaves via "Done", gated by an AsyncStorage flag.

Read first, in this order: `reminders.ts:24-29, 108-114, 159-170, 267-286`; `AudienceSurveyScreen.tsx:25-35`; `PermissionPromptScreen.tsx:13-63`; `DrawResultScreen.tsx:81-87, 140-158, 167-186, 599-609`; `mobile/src/navigation/types.ts:6-22` (Home params, `PermissionPrompt: undefined`); `mobile/src/screens/HomeScreen.tsx:112-124` (how `firstDrawCoach` / `notice` are consumed); the three existing tests named under Constraints.

## Constraints

- No new dependencies. `mobile/package.json` must not change.
- Files that may change (8 max): `mobile/src/notifications/reminders.ts`, `mobile/src/screens/AudienceSurveyScreen.tsx`, `mobile/src/screens/PermissionPromptScreen.tsx`, `mobile/src/screens/DrawResultScreen.tsx`, `mobile/tests/unit/reminders.test.ts` (NEW), `mobile/tests/integration/onboarding.screen.test.tsx`, `mobile/tests/integration/phase-a-milestones.screen.test.tsx`, `mobile/tests/integration/draw-result.screen.test.tsx`. `mobile/src/screens/SplashScreen.tsx` is in the issue scope but needs NO change (its `getOnboardingStage()` routing at `SplashScreen.tsx:16-20` is already `done → Home`); leave it untouched.
- Frozen (gacha-v7 §2.1) — zero diff lines: `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also do not touch `mobile/src/navigation/types.ts`, `mobile/src/screens/HomeScreen.tsx`, `mobile/src/screens/SettingsScreen.tsx`, `mobile/src/features/gacha/home/deckActionResolver.ts`, `mobile/App.tsx`.
- testIDs that must survive unchanged in `DrawResultScreen.tsx`: `draw-result-done-link`, `screen-draw-result-primary-cta`, `draw-result-earn-pulls-link`, `screen-draw-result-root`. Visible strings that must survive: `Done`, `Continue draw`, `Go to Library`, `Allow reminders`, `Not now`, `Finish setup`, `Skip for now`, `Stay on streak with daily reminders`.
- Exported API of `reminders.ts` that other modules/tests rely on and must keep its names and signatures: `syncDailyReminders`, `refreshDailyRemindersFromCache`, `getReminderPrefs`, `setReminderPrefs`, `ReminderPrefs`. Keep every AsyncStorage key literal in `reminders.ts` unchanged (`notifications:reminders:prefs:v1` etc.) — existing users' stored prefs must still be read.
- Existing test literals you are allowed to change, and ONLY these:
  - `mobile/tests/integration/onboarding.screen.test.tsx:113` — `expect(replace).toHaveBeenCalledWith('PermissionPrompt');` → `expect(replace).toHaveBeenCalledWith('Home', { firstDrawCoach: true });` plus one added line `expect(store.get('notifications:permission-prompt:pending:v1')).toBe('1');`.
  - `mobile/tests/integration/phase-a-milestones.screen.test.tsx:55-69` — the test `'hands permission prompt into first-draw home'`: rename to `'hands permission prompt back into Home without the first-draw coach'`, pass `navigation={{ navigate } as any}` (a `const navigate = vi.fn()`) instead of `{ replace }`, and replace the assertion at line 69 with:
    `expect(navigate).toHaveBeenCalledTimes(1); expect(navigate.mock.calls[0][0]).toBe('Home'); expect(navigate.mock.calls[0][1]?.firstDrawCoach).toBeUndefined();`
  - `mobile/tests/integration/draw-result.screen.test.tsx` — add (do not edit existing tests) a module mock after the `rewardWallet` mock at lines 38-40 and one new `it` (exact text in Change 6).
- Unit tests live under `mobile/tests/unit/` (vitest include globs, `mobile/vitest.config.ts`); environment is `node`, so `react-native`, `expo-notifications`, `react-native-safe-area-context`, `expo-linear-gradient` and `@react-native-async-storage/async-storage` must be `vi.mock`ed in the new test (the real `react-native` fails to parse under vitest: "Flow is not supported").
- No `@ts-ignore`, `@ts-expect-error`, or new `eslint-disable` (the one existing `eslint-disable-next-line @typescript-eslint/no-require-imports` at `PermissionPromptScreen.tsx:15` stays as is).
- Do NOT `import` anything from `expo-notifications` or from `reminders.ts` into `DrawResultScreen.tsx` or `AudienceSurveyScreen.tsx` — `draw-result.screen.test.tsx` does not mock either, and `PermissionPromptScreen.tsx:11-16` already documents that `expo-notifications` is only loadable via the guarded `require`. The shared flag helpers therefore live in `PermissionPromptScreen.tsx` (Change 3).

## Changes required

1. `mobile/src/notifications/reminders.ts:24-29` — `DEFAULT_PREFS` becomes one enabled reminder:
   `morningEnabled: true, morningTime: '09:00', eveningEnabled: false, eveningTime: '20:00'`. Do not change `readPrefs`/`setReminderPrefs`; a user who already saved prefs keeps them (their JSON overrides the default field-by-field at lines 79-83).

2. `mobile/src/notifications/reminders.ts:108-114` — replace `ensurePermission()` with a read-only check and remove every reference to `requestPermissionsAsync` from this file:
   ```ts
   // Read-only: the OS permission request lives solely in PermissionPromptScreen.
   // syncDailyReminders runs on every Home refresh (deckActionResolver.ts:251),
   // so requesting here re-prompted users who had just tapped "Not now".
   async function hasPermission(): Promise<boolean> {
     const { status } = await Notifications.getPermissionsAsync();
     return status === 'granted';
   }
   ```
   and at `reminders.ts:275` call `const ok = await hasPermission();` (keep the early `return` when false). Line 161: `title: 'DevCards'` → `title: 'DeveloperCards'`. The evening notification title at line 251 (`'Evening check‑in'`) stays.

3. `mobile/src/screens/PermissionPromptScreen.tsx` —
   a. Add `import AsyncStorage from '@react-native-async-storage/async-storage';` and export the one-shot flag helpers (place them above the component, after `safeRequestNotificationPermission`):
   ```ts
   // One-shot gate: AudienceSurvey marks it when onboarding completes; the
   // first DrawResult the user leaves via "Done" consumes it and pushes this
   // screen. Existing users (flag never set) are never prompted again.
   export const PERMISSION_PROMPT_PENDING_KEY = 'notifications:permission-prompt:pending:v1';

   export async function markPermissionPromptPending(): Promise<void> {
     try { await AsyncStorage.setItem(PERMISSION_PROMPT_PENDING_KEY, '1'); } catch {}
   }

   export async function isPermissionPromptPending(): Promise<boolean> {
     try { return (await AsyncStorage.getItem(PERMISSION_PROMPT_PENDING_KEY)) === '1'; } catch { return false; }
   }

   export async function clearPermissionPromptPending(): Promise<void> {
     try { await AsyncStorage.removeItem(PERMISSION_PROMPT_PENDING_KEY); } catch {}
   }
   ```
   b. This screen is now reached by a push from `DrawResult` (stack: Home → Draw → DrawResult → PermissionPrompt), so both exits pop back to the existing Home instead of replacing: at lines 50-53 `navigation.replace('Home', { firstDrawCoach: true, notice: ... })` → `navigation.navigate('Home', { notice: resultStatus === 'denied' ? 'notifications-denied' : undefined });` and at lines 59-62 → `navigation.navigate('Home', { notice: 'notifications-skipped' });`. Remove `firstDrawCoach` from this file entirely (the coach is now handed over by AudienceSurvey, Change 4). Update the v3 comment at lines 31-34 accordingly (it no longer "lands in Home with the firstDrawCoach hint"). Copy on screen is unchanged.

4. `mobile/src/screens/AudienceSurveyScreen.tsx:25-35` — `finish()` completes onboarding, marks the pending flag, and goes straight to Home with the first-draw coach:
   ```ts
   await setAudiencePreference(preferenceOverride ?? selected);
   await completeOnboarding();
   await markPermissionPromptPending();
   navigation.replace('Home', { firstDrawCoach: true });
   ```
   with `import { markPermissionPromptPending } from './PermissionPromptScreen';`. Nothing else in the file changes.

5. `mobile/src/screens/DrawResultScreen.tsx` —
   a. `import { clearPermissionPromptPending, isPermissionPromptPending } from './PermissionPromptScreen';`
   b. Next to the state at lines 84-87 add `const [permissionPromptPending, setPermissionPromptPending] = useState(false);` and, after the wallet effect (lines 140-158), a mount effect that reads the flag once (same `cancelled` pattern as the wallet effect; on rejection leave `false`).
   c. Add a sync handler and wire the Done link (line 604 `onPress={() => navigation.navigate('Home')}` → `onPress={handleDone}`):
   ```ts
   // The first pack the user walks away from is where we ask for
   // notifications (home-review §3.2 通知权限时机). Consumed once; Continue
   // draw / Library exits are left alone so the flag survives until a Done.
   const handleDone = () => {
     if (permissionPromptPending) {
       setPermissionPromptPending(false);
       void clearPermissionPromptPending();
       navigation.navigate('PermissionPrompt');
       return;
     }
     navigation.navigate('Home');
   };
   ```
   `handlePrimary` (lines 167-186), the earn-pulls link (586-597), the loading/error/empty branches and every testID stay as they are. The handler must stay synchronous — `draw-result.screen.test.tsx:224-239` presses Done inside a sync `act` and asserts immediately.

6. Tests.
   a. NEW `mobile/tests/unit/reminders.test.ts` — use exactly this file:
   ```ts
   import { beforeEach, describe, expect, it, vi } from 'vitest';

   const h = vi.hoisted(() => {
     const store = new Map<string, string>();
     return {
       store,
       getPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
       requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
       scheduleNotificationAsync: vi.fn(async (_req: unknown) => 'notif-1'),
       cancelScheduledNotificationAsync: vi.fn(async () => {}),
       setNotificationChannelAsync: vi.fn(async () => {}),
     };
   });

   vi.mock('react-native', () => ({
     Platform: { OS: 'ios' },
     StyleSheet: { create: (styles: any) => styles },
     Pressable: () => null,
     ScrollView: () => null,
     Text: () => null,
   }));
   vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }));
   vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
   vi.mock('@react-native-async-storage/async-storage', () => ({
     default: {
       getItem: vi.fn(async (key: string) => h.store.get(key) ?? null),
       setItem: vi.fn(async (key: string, value: string) => {
         h.store.set(key, value);
       }),
       removeItem: vi.fn(async (key: string) => {
         h.store.delete(key);
       }),
     },
   }));
   vi.mock('expo-notifications', () => ({
     getPermissionsAsync: h.getPermissionsAsync,
     requestPermissionsAsync: h.requestPermissionsAsync,
     scheduleNotificationAsync: h.scheduleNotificationAsync,
     cancelScheduledNotificationAsync: h.cancelScheduledNotificationAsync,
     setNotificationChannelAsync: h.setNotificationChannelAsync,
     SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
     AndroidImportance: { DEFAULT: 3 },
   }));

   import { getReminderPrefs, syncDailyReminders } from '../../src/notifications/reminders';
   import {
     PERMISSION_PROMPT_PENDING_KEY,
     clearPermissionPromptPending,
     isPermissionPromptPending,
     markPermissionPromptPending,
   } from '../../src/screens/PermissionPromptScreen';

   const NOW = new Date(2026, 8, 19, 10, 0, 0); // 10:00 local, before the 20:00 evening slot

   describe('reminders (R2): sync is read-only on permission', () => {
     beforeEach(() => {
       h.store.clear();
       h.getPermissionsAsync.mockClear();
       h.requestPermissionsAsync.mockClear();
       h.scheduleNotificationAsync.mockClear();
     });

     it('never calls requestPermissionsAsync and schedules nothing while permission is undetermined', async () => {
       h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
       await syncDailyReminders({ remainingDueCount: 3, now: NOW });
       expect(h.getPermissionsAsync).toHaveBeenCalledTimes(1);
       expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
       expect(h.scheduleNotificationAsync).not.toHaveBeenCalled();
     });

     it('granted: schedules exactly one default reminder titled DeveloperCards, still without requesting', async () => {
       await syncDailyReminders({ remainingDueCount: 3, now: NOW });
       expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
       expect(h.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
       const req = h.scheduleNotificationAsync.mock.calls[0][0] as any;
       expect(req.content.title).toBe('DeveloperCards');
       expect(req.trigger).toMatchObject({ type: 'daily', hour: 9, minute: 0 });
     });

     it('default prefs: morning on, evening off', async () => {
       await expect(getReminderPrefs()).resolves.toMatchObject({
         morningEnabled: true,
         morningTime: '09:00',
         eveningEnabled: false,
         eveningTime: '20:00',
       });
     });
   });

   describe('permission prompt pending flag', () => {
     beforeEach(() => {
       h.store.clear();
     });

     it('is false until marked, true once marked, false again after clear', async () => {
       await expect(isPermissionPromptPending()).resolves.toBe(false);
       await markPermissionPromptPending();
       expect(h.store.get(PERMISSION_PROMPT_PENDING_KEY)).toBe('1');
       await expect(isPermissionPromptPending()).resolves.toBe(true);
       await clearPermissionPromptPending();
       await expect(isPermissionPromptPending()).resolves.toBe(false);
     });
   });
   ```
   b. `mobile/tests/integration/onboarding.screen.test.tsx:113` and `mobile/tests/integration/phase-a-milestones.screen.test.tsx:55-69` — exactly the literal edits listed under Constraints.
   c. `mobile/tests/integration/draw-result.screen.test.tsx` — after the `rewardWallet` mock (lines 38-40) add:
   ```ts
   let permissionPromptPendingFixture = false;
   const clearPermissionPromptPendingMock = vi.fn(async () => {});
   vi.mock('../../src/screens/PermissionPromptScreen', () => ({
     isPermissionPromptPending: vi.fn(async () => permissionPromptPendingFixture),
     clearPermissionPromptPending: () => clearPermissionPromptPendingMock(),
   }));
   ```
   reset `permissionPromptPendingFixture = false; clearPermissionPromptPendingMock.mockClear();` in the existing `beforeEach` (lines 85-90), and add this test directly after `'routes done link back to Home'` (line 239):
   ```ts
   it('routes the first Done into PermissionPrompt once when the onboarding flag is pending', async () => {
     permissionPromptPendingFixture = true;
     const navigate = vi.fn();

     let tree!: renderer.ReactTestRenderer;
     await act(async () => {
       tree = renderer.create(
         <DrawResultScreen navigation={{ navigate } as any} route={{ key: 'result', name: 'DrawResult', params: makeParams() } as any} />,
       );
     });
     await flush();

     act(() => {
       tree.root.findByProps({ testID: 'draw-result-done-link' }).props.onPress();
     });

     expect(navigate).toHaveBeenCalledWith('PermissionPrompt');
     expect(navigate).not.toHaveBeenCalledWith('Home');
     expect(clearPermissionPromptPendingMock).toHaveBeenCalledTimes(1);
   });
   ```

## Acceptance

Run from the worktree root. `A05.verify.sh` (next to this brief) runs exactly these.

- `cd mobile && npx vitest run tests/unit/reminders.test.ts tests/integration/onboarding.screen.test.tsx tests/integration/phase-a-milestones.screen.test.tsx tests/integration/draw-result.screen.test.tsx --reporter=dot` — all green (4 files; reminders.test.ts must exist and contain the three sync tests + the flag test).
- `cd mobile && npm run test:typecheck` — exit 0.
- `! grep -q "requestPermissionsAsync" mobile/src/notifications/reminders.ts && grep -q "title: 'DeveloperCards'" mobile/src/notifications/reminders.ts && ! grep -q "DevCards" mobile/src/notifications/reminders.ts && grep -q "eveningEnabled: false" mobile/src/notifications/reminders.ts && grep -q "getPermissionsAsync" mobile/src/notifications/reminders.ts`
- `grep -q "navigation.replace('Home', { firstDrawCoach: true })" mobile/src/screens/AudienceSurveyScreen.tsx && ! grep -q "replace('PermissionPrompt')" mobile/src/screens/AudienceSurveyScreen.tsx && grep -q "navigate('PermissionPrompt')" mobile/src/screens/DrawResultScreen.tsx && grep -q 'testID="draw-result-done-link"' mobile/src/screens/DrawResultScreen.tsx && ! grep -q "firstDrawCoach" mobile/src/screens/PermissionPromptScreen.tsx && grep -q "requestPermissionsAsync" mobile/src/screens/PermissionPromptScreen.tsx && grep -q "export async function markPermissionPromptPending" mobile/src/screens/PermissionPromptScreen.tsx`
- `git diff --numstat "$(git merge-base HEAD delivery/r16-a-home)" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/screens/SplashScreen.tsx mobile/src/navigation/types.ts mobile/src/screens/HomeScreen.tsx mobile/package.json mobile/package-lock.json | wc -l` prints `0`, and the diff of `mobile/src` against that base adds no line containing `@ts-ignore`, `@ts-expect-error` or `eslint-disable`.

## DO NOT

- No push, no PR, never touch `main`, no deploy (`eas update`, `eas build`, `expo publish` included), no `npm ci`/`npm install`.
- Do not skip, delete, loosen or `.only` any test; do not edit `mobile/vitest.config.ts`, `tsconfig`, or eslint config.
- Do not touch the frozen files (`deckRepository.ts`, `progressSync.ts`, `review/model.ts`), `navigation/types.ts`, `HomeScreen.tsx`, `SettingsScreen.tsx`, `deckActionResolver.ts`, `App.tsx`, `SplashScreen.tsx`.
- Do not redesign the reminder scheduler (evening "smart" logic, storage keys, Android channel) — only the default, the title and the permission read.
- Do not add a permission request anywhere else (Home, Settings, Splash); `Notifications.requestPermissionsAsync` may appear in exactly one source file: `PermissionPromptScreen.tsx`.
- Do not rewrite `SettingsScreen.tsx`'s local `DEFAULT_REMINDER_PREFS` (line 58-63, pre-load placeholder, `eveningEnabled: true`) — out of scope; note it under CONCERNS in your report.
- Do not gate "Continue draw" / "Go to Library" / "Earn more pulls" on the permission flag; only the Done link routes to `PermissionPrompt`.
- Do not change onboarding stage semantics (`onboardingPrefs.ts`) or add a new stage; the pending flag is its own key.

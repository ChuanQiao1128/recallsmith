#!/usr/bin/env bash
# C04 — exam-sweep-mode verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/tests/unit/sweepPlanner.test.ts does not exist on base
#   (step 1 then also checks the C01/C02/C03/C07 prerequisites — C00 §4 makes
#   C04 depend on C03 and C07: tests/unit/sessionRewards.test.ts +
#   settleRatingReward (C01), planner/loadForecast.ts (C02), DeckSummary
#   masteredCount? (C03), library/topics.ts (C07) — none of which exist on the
#   wave base either)
# Step 2 (literal guards) would also fail on base: no 'sweep' in any of the
# four StudyMode unions, no SWEEP_SPREAD_DAYS, no buildSweepRoute, no
# library-sweep-cta. Steps 3/4 are the tsc / targeted-vitest gates and step 5
# is a purely negative scope + frozen + OTA guard; both pass on base by design.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ~1-2 min
# (one tsc --noEmit + eight vitest files).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C04 VERIFY FAIL: $*" >&2; exit 1; }

C=mobile/src/features/gacha/constants.ts
NT=mobile/src/navigation/types.ts
CT=mobile/src/features/gacha/contracts.ts
SP=mobile/src/features/gacha/planner/sessionPlanner.ts
SB=mobile/src/features/gacha/planner/sessionBuilder.ts
RH=mobile/src/features/gacha/session/sessionReviewHelpers.ts
SC=mobile/src/screens/SessionCardScreen.tsx
LH=mobile/src/features/gacha/library/LibraryHeader.tsx
LS=mobile/src/screens/LibraryScreen.tsx
T_SWEEP=mobile/tests/unit/sweepPlanner.test.ts
T_PLAN=mobile/tests/unit/planner.test.ts
T_REW=mobile/tests/unit/sessionRewards.test.ts
T_LIB=mobile/tests/integration/library-final.screen.test.tsx
# prerequisites (deps landed on the integration branch)
P_REWARDS=mobile/src/features/gacha/rewards/sessionRewards.ts
P_FORECAST=mobile/src/features/gacha/planner/loadForecast.ts
P_TOPICS=mobile/src/features/gacha/library/topics.ts

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C01/C02/C03/C07 prerequisites)"
[ -f "$T_SWEEP" ] || fail "$T_SWEEP does not exist (base tree fails here)"
for f in "$C" "$NT" "$CT" "$SP" "$SB" "$RH" "$SC" "$LH" "$LS" "$T_PLAN" "$T_LIB"; do
  [ -f "$f" ] || fail "$f does not exist"
done
[ -f "$T_REW" ]     || fail "$T_REW is missing — C01 must be merged before C04 (its R8 case is appended there)"
[ -f "$P_REWARDS" ] || fail "$P_REWARDS is missing — C01 must be merged before C04"
grep -q "export async function settleRatingReward" "$P_REWARDS" || fail "sessionRewards.ts lacks settleRatingReward (C01 incomplete)"
grep -q "export const ZERO_REWARD_STEP" "$P_REWARDS"             || fail "sessionRewards.ts lacks ZERO_REWARD_STEP (C01 incomplete)"
[ -f "$P_FORECAST" ] || fail "$P_FORECAST is missing — C02 must be merged before C04 (the forecast line is skipped in sweep)"
grep -Fq "masteredCount?: number;" "$CT" || fail "contracts.ts lacks DeckSummary.masteredCount? — C03 must be merged before C04"
[ -f "$P_TOPICS" ] || fail "$P_TOPICS is missing — C07 must be merged before C04 (LibraryHeader/LibraryScreen are edited after it, C00 §1.1)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. the four unions + modeLabel + the constant
grep -Fq "export type StudyMode = 'learn-new' | 'review-due' | 'mixed' | 'sweep';" "$NT" || fail "navigation/types.ts: StudyMode union lacks 'sweep' (exact line)"
grep -Fq "  mode: 'mixed' | 'review-due' | 'learn-new' | 'sweep';" "$CT"                  || fail "contracts.ts: ChallengeRoute.mode union lacks 'sweep' (exact line)"
grep -Fq "  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';" "$SP"                  || fail "sessionPlanner.ts: pickNextCard mode union lacks 'sweep' (exact line)"
grep -Fq "  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';" "$RH"                  || fail "sessionReviewHelpers.ts: buildRatedSessionState mode union lacks 'sweep' (exact line)"
grep -Fq "if (mode === 'sweep') return 'Review all';" "$RH"                                || fail "sessionReviewHelpers.ts: modeLabel lacks the 'Review all' branch"
grep -Fq "export const SWEEP_SPREAD_DAYS = 7;" "$C"                                        || fail "constants.ts: SWEEP_SPREAD_DAYS literal missing/changed"
# 2b. sessionBuilder.ts — buildSweepRoute, formula, no elite/boss, summary
for sym in "export function buildSweepRoute(" "SWEEP_SPREAD_DAYS" \
           "Math.ceil(learnedCount / SWEEP_SPREAD_DAYS)" "Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget))" \
           "mode: 'sweep'," "hasElite: false, hasBoss: false" 'a day for ${SWEEP_SPREAD_DAYS} days'; do
  grep -Fq "$sym" "$SB" || fail "sessionBuilder.ts lacks: $sym"
done
# 2c. sessionPlanner.ts — imports, pickSweep, dispatch, planChallengeRoute.mode
for sym in "import type { StudyMode } from '../../../navigation/types';" \
           "import { buildChallengeRoute, buildSweepRoute } from './sessionBuilder';" \
           "mode?: StudyMode;" "const pickSweep = " "if (mode === 'sweep') return pickSweep();" \
           "learnedCount: countLearned(progress, ownedSet)," \
           "owns(entry.card) && isLearnedProgress(entry.progressEntry)"; do
  grep -Fq "$sym" "$SP" || fail "sessionPlanner.ts lacks: $sym"
done
# the three existing dispatch lines are untouched
grep -Fq "if (mode === 'review-due') return pickDue();" "$SP" || fail "sessionPlanner.ts: review-due dispatch changed"
grep -Fq "if (mode === 'learn-new') return pickNew();" "$SP"  || fail "sessionPlanner.ts: learn-new dispatch changed"
grep -Fq "return pickDue() ?? pickUpdated() ?? pickNew();" "$SP" || fail "sessionPlanner.ts: mixed dispatch changed"
# planner + builder stay pure
for f in "$SP" "$SB"; do
  if grep -Eq "from 'react|require\(|Date\.now|Math\.random|AsyncStorage" "$f"; then
    grep -En "from 'react|require\(|Date\.now|Math\.random|AsyncStorage" "$f" >&2 || true
    fail "$f must stay pure (no react / require / clock / randomness / storage)"
  fi
done
# 2d. SessionCardScreen.tsx — mode threaded into all three plans, R8 pay hook, forecast skipped
grep -Fq "newCardEligible: mode !== 'sweep'," "$SC"        || fail "SessionCardScreen.tsx: pay hook must pass newCardEligible: mode !== 'sweep' (R8)"
grep -Fq "newCardEligible: true" "$SC" && fail "SessionCardScreen.tsx still passes newCardEligible: true (C01's literal must become mode !== 'sweep')"
grep -Fq "mode === 'sweep' ? null : forecastLine(" "$SC"     || fail "SessionCardScreen.tsx: C02's forecast line must be skipped in sweep (verbatim: mode === 'sweep' ? null : forecastLine()"
grep -Fq "planChallengeRoute({ deck, progress, now, ownedSet, mode }).minimumGoal" "$SC" || fail "SessionCardScreen.tsx: doneMinimumGoal plan lacks mode"
[ "$(grep -c 'planChallengeRoute({' "$SC" || true)" -eq 3 ] || fail "SessionCardScreen.tsx must contain exactly three planChallengeRoute({ calls"
awk '
  /planChallengeRoute\(\{/ { inblk = 1; has = 0 }
  inblk && /(^|[^A-Za-z_])mode([^A-Za-z_]|$)/ { has = 1 }
  inblk && /\}\)/ { if (!has) bad++; inblk = 0 }
  END { exit bad ? 1 : 0 }
' "$SC" || fail "SessionCardScreen.tsx: a planChallengeRoute({ call does not pass mode"
grep -Fq "mode === 'learn-new' || mode === 'mixed'" "$SC" || fail "SessionCardScreen.tsx: the trial gate condition must be untouched"
# 2e. LibraryHeader.tsx / LibraryScreen.tsx — the Library-only entry point
for sym in "onStartSweep?: () => void;" "sweepCount?: number;" "sweepCount = 0," \
           'testID="library-sweep-cta"' 'accessibilityRole="button"' 'accessibilityLabel="Review all learned cards"' \
           '{`Review all · ${sweepCount}`}' "onStartSweep && sweepCount > 0"; do
  grep -Fq "$sym" "$LH" || fail "LibraryHeader.tsx lacks: $sym"
done
grep -Fq "sweepCount={vm.counts.learningCount + vm.counts.masteredCount}" "$LS" || fail "LibraryScreen.tsx lacks the sweepCount prop (verbatim one-liner)"
grep -Fq "onStartSweep={() => navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug, mode: 'sweep' })}" "$LS" || fail "LibraryScreen.tsx lacks the onStartSweep prop (verbatim one-liner)"
# No Home entry (C00 §6 #8): the only 'sweep' navigation lives in LibraryScreen.
if grep -rl "mode: 'sweep'" mobile/src/screens | grep -v "^$LS$" | grep -q .; then
  grep -rn "mode: 'sweep'" mobile/src/screens | grep -v "^$LS:" >&2 || true
  fail "a screen other than LibraryScreen navigates to a sweep (Library-only entry, C00 §6 #8)"
fi
# 2f. tests — new property suite, add-only cases, pre-existing titles intact
grep -q "from 'fast-check'" "$T_SWEEP" || fail "sweepPlanner.test.ts must use fast-check"
[ "$(grep -c 'fc.assert(' "$T_SWEEP" || true)" -ge 3 ] || fail "sweepPlanner.test.ts needs >= 3 fc.assert properties"
grep -Eq "vi\.mock\(|AsyncStorage" "$T_SWEEP" && fail "sweepPlanner.test.ts must stay pure (no vi.mock / storage)"
for s in \
  'orders a sweep by longest-unseen first over owned learned cards only' \
  'walks the whole learned set once in lastReviewedAt order when each pick is rated' \
  'ignores the due bucket in sweep mode' \
  'spreads the learned count over SWEEP_SPREAD_DAYS days and caps a run at five' \
  'plans a sweep route from deck progress and leaves the other modes untouched' \
  'reschedules a sweep rating exactly like any other mode' \
  'a full sweep run resolves to zero pulls and leaves the wallet untouched' \
  'labels sweep mode Review all'; do
  grep -Fq "it('$s'" "$T_SWEEP" || fail "missing sweepPlanner test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$T_SWEEP" || true)" -ge 8 ] || fail "sweepPlanner.test.ts needs >= 8 it() blocks"
grep -Fq "it('picks the longest-unseen learned card in sweep mode even when another card is due'" "$T_PLAN" || fail "planner.test.ts lacks the sweep case"
for s in \
  'creates a boss-ending route for a real due backlog' \
  'creates a one-node maintenance route when today is clear' \
  'derives counts from deck progress' \
  'does not force a boss node when there is no high-pressure backlog' \
  'counts overdue scheduled cards into today' \
  'prefers due cards in review-due mode' \
  'prefers new cards in learn-new mode' \
  'falls back to updated learned cards in mixed mode when no due cards exist' \
  'reuses the avoided uid only when no better candidate exists'; do
  grep -Fq "it('$s'" "$T_PLAN" || fail "planner.test.ts lost a pre-existing case: $s"
done
grep -Fq "it('never pays a new-card pull in sweep mode however the cards are rated, and pays the due clear at most once'" "$T_REW" || fail "sessionRewards.test.ts lacks the C04 R8 case"
grep -Fq "newCardEligible: false" "$T_REW" || fail "sessionRewards.test.ts: the R8 case must call settleRatingReward with newCardEligible: false"
for s in \
  'shows the Review all CTA with the learned count and starts a sweep' \
  'hides the Review all CTA when nothing has been learned'; do
  grep -Fq "it('$s'" "$T_LIB" || fail "missing library-final test case: $s"
done
grep -Fq "toHaveBeenCalledWith('SessionCard', { slug: 'csharp', mode: 'sweep' })" "$T_LIB" || fail "library-final: the CTA case must assert the sweep navigation"
grep -Fq "'Review all · 2'" "$T_LIB" || fail "library-final: the CTA case must assert the 'Review all · 2' label"
for s in \
  'renders collection bar and primary grid shell ids' \
  'shows only All/New/Learning/Mastered filters in filter sheet' \
  'keeps collection bar invariant across filter toggles' \
  'applies focusSlug route param on initial load' \
  'highlights exactly the cards the caller named, not the first unstudied one' \
  'ignores named uids that are not on screen and falls back to nothing' \
  'highlights first new card when entering with scrollToNew flag' \
  'renders empty-state recovery CTA when deck has no cards'; do
  grep -Fq "it('$s'" "$T_LIB" || fail "library-final.screen.test.tsx lost a pre-existing case: $s"
done
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" \
  "$C" "$NT" "$CT" "$SP" "$SB" "$RH" "$LH" "$LS" "$T_SWEEP" "$T_PLAN" "$T_REW" "$T_LIB" && fail "test gutting / suppression found"
# SessionCardScreen.tsx carries one pre-wave `eslint-disable-next-line react-hooks/exhaustive-deps`
# (base :380); only a NEW suppression there is a failure.
[ "$(grep -c 'eslint-disable' "$SC" || true)" -le 1 ] || fail "SessionCardScreen.tsx gained a suppression comment"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error" "$SC" && fail "SessionCardScreen.tsx: suppression found"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest ─────────────────────────────────────────────────────
echo "[4/5] vitest sweepPlanner / planner / sessionRewards / library-final + planner consumers"
( cd mobile && npx vitest run \
    tests/unit/sweepPlanner.test.ts \
    tests/unit/planner.test.ts \
    tests/unit/sessionRewards.test.ts \
    tests/integration/library-final.screen.test.tsx \
    tests/unit/ownedGatePredicates.test.ts \
    tests/unit/library.test.ts \
    tests/integration/session-card.screen.test.tsx \
    tests/integration/owned-gate-entry-points.spec.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen + OTA guard (purely negative; passes on base) ────────
echo "[5/5] scope + frozen + OTA guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/review/storage.ts mobile/src/screens/HomeScreen.tsx mobile/src/features/gacha/selectors/homeSelectors.ts \
  mobile/src/features/gacha/library/libraryMapper.ts mobile/src/features/gacha/library/libraryScreenStyles.ts \
  mobile/src/features/gacha/rewards mobile/src/features/gacha/session/sessionStore.ts mobile/src/screens/SessionSummaryScreen.tsx \
  mobile/src/config mobile/vitest.config.ts mobile/tests/setup mobile/tests/unit/session-store.test.ts mobile/tests/p2-smoke.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed (OTA runtime 1.6.0)"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version is not 1.6.0"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests; } | sort -u | grep -Ev '^(mobile/src/features/gacha/constants\.ts|mobile/src/navigation/types\.ts|mobile/src/features/gacha/contracts\.ts|mobile/src/features/gacha/planner/sessionPlanner\.ts|mobile/src/features/gacha/planner/sessionBuilder\.ts|mobile/src/features/gacha/session/sessionReviewHelpers\.ts|mobile/src/screens/SessionCardScreen\.tsx|mobile/src/features/gacha/library/LibraryHeader\.tsx|mobile/src/screens/LibraryScreen\.tsx|mobile/tests/unit/sweepPlanner\.test\.ts|mobile/tests/unit/planner\.test\.ts|mobile/tests/unit/sessionRewards\.test\.ts|mobile/tests/integration/library-final\.screen\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C04 scope"; }

echo "C04 VERIFY OK"

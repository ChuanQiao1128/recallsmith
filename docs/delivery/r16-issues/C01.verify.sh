#!/usr/bin/env bash
# C01 — learn-to-earn-rewards verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/rewards/{newCardLedger,sessionRewards}.ts and
#     mobile/tests/unit/{newCardLedger,sessionRewards,rewardOutcome}.test.ts do not
#     exist on base (delivery/r16-c-economy == main@52594fe)
# Step 2 (literal guards) would also fail on base: constants.ts still says
# FREE_PULL_CAP = 30, computeSessionRewardPulls still exists, drawState.ts still
# compares against the literal 30, DebugMenu still seeds 30/5, none of the new
# it('...') titles exist. Steps 3/4 are the tsc / targeted-vitest gates and step 5
# is a purely negative scope + frozen + OTA guard; all three pass on base by design.
#
# The six driver-banned terms are NOT grepped here (C00 §0 keeps them out of every
# Wave C file); the driver's diff-scoped gate (a) covers them after this script.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ~2-3 min (one tsc,
# 19 vitest files).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C01 VERIFY FAIL: $*" >&2; exit 1; }

# Source
CONST=mobile/src/features/gacha/constants.ts
RES=mobile/src/features/gacha/rewards/rewardResolver.ts
WAL=mobile/src/features/gacha/rewards/rewardWallet.ts
LED=mobile/src/features/gacha/rewards/newCardLedger.ts
SREW=mobile/src/features/gacha/rewards/sessionRewards.ts
STORE=mobile/src/features/gacha/session/sessionStore.ts
MAP=mobile/src/features/gacha/session/summaryMapper.ts
DSTATE=mobile/src/features/gacha/draw/drawState.ts
DSYNC=mobile/src/sync/drawStateSync.ts
DEBUG=mobile/src/screens/DebugMenuScreen.tsx
NAV=mobile/src/navigation/types.ts
SUMMARY=mobile/src/screens/SessionSummaryScreen.tsx
CARD=mobile/src/screens/SessionCardScreen.tsx
# Tests (new)
LT=mobile/tests/unit/newCardLedger.test.ts
SRT=mobile/tests/unit/sessionRewards.test.ts
ROT=mobile/tests/unit/rewardOutcome.test.ts
# Tests (edited)
RT=mobile/tests/unit/rewards.test.ts
SMT=mobile/tests/unit/summaryMapper.spec.ts
SHT=mobile/tests/unit/summary-home.test.ts
SST=mobile/tests/integration/session-summary.screen.test.tsx
SCT=mobile/tests/integration/session-card.screen.test.tsx
STT=mobile/tests/unit/session-store.test.ts
DT=mobile/tests/unit/draw.test.ts
DAT=mobile/tests/unit/drawStateAdoption.test.ts
HST=mobile/tests/unit/homeSelectors.spec.ts
HPT=mobile/tests/integration/home-primary-cta.test.tsx
CTT=mobile/tests/unit/ceremonyTuning.test.tsx
SMOKE=mobile/tests/p2-smoke.ts

SRC_FILES=("$CONST" "$RES" "$WAL" "$LED" "$SREW" "$STORE" "$MAP" "$DSTATE" "$DSYNC" "$DEBUG" "$NAV" "$SUMMARY" "$CARD")
TEST_FILES=("$LT" "$SRT" "$ROT" "$RT" "$SMT" "$SHT" "$SST" "$SCT" "$STT" "$DT" "$DAT" "$HST" "$HPT" "$CTT" "$SMOKE")

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist"
for f in "$LED" "$SREW" "$LT" "$SRT" "$ROT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "${SRC_FILES[@]}" "${TEST_FILES[@]}"; do
  [ -f "$f" ] || fail "$f is missing"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. constants.ts — R4, and only R4
grep -Fq 'export const FREE_PULL_CAP = 60;' "$CONST"          || fail "constants.ts: FREE_PULL_CAP must be exactly 60"
grep -Fq 'export const FREE_PULL_OVERFLOW_CAP = 5;' "$CONST"  || fail "constants.ts: FREE_PULL_OVERFLOW_CAP must stay 5"
grep -Fq 'export const SESSION_MAIN_ROUTE_DEFAULT = 5;' "$CONST" || fail "constants.ts: SESSION_MAIN_ROUTE_DEFAULT must stay 5"
grep -Fq 'export const MASTERY_STAGE_THRESHOLD = 4;' "$CONST" || fail "constants.ts: MASTERY_STAGE_THRESHOLD must stay 4"

# 2b. computeSessionRewardPulls is gone everywhere (R1 replaces it, C00 §6 #2)
if grep -rn "computeSessionRewardPulls" mobile/src mobile/tests; then
  fail "computeSessionRewardPulls still referenced (must be deleted, not renamed)"
fi

# 2c. rewardResolver.ts — the outcome API, verbatim signatures
for sym in \
  "export type RewardOutcome = {" \
  "export const EMPTY_REWARD_OUTCOME" \
  "export function accumulateRewardOutcome(prev: RewardOutcome, step: RatingRewardStep, stableUid: string): RewardOutcome" \
  "export function rewardLine(outcome: RewardOutcome): string" \
  "export function rewardBadge(outcome: RewardOutcome): string" \
  "export type ResolvedSessionReward = {" \
  "export function resolveSessionReward(" \
  "reward?: RewardOutcome | null;" \
  "outcome: RewardOutcome;" \
  "import type { RatingRewardStep } from './sessionRewards';" \
  "No free pulls this run" \
  "new card" \
  "cleared today's due" \
  "Progress saved"; do
  grep -Fq "$sym" "$RES" || fail "rewardResolver.ts lacks: $sym"
done
if grep -Eq "from '\.\./session/summaryMapper'|summaryMapper" "$RES"; then
  fail "rewardResolver.ts must not import summaryMapper (circular import)"
fi

# 2d. rewardWallet.ts — append-only, one new export, the old settle path intact
grep -Fq "export async function grantPullsToStoredWallet(count: number)" "$WAL" || fail "rewardWallet.ts lacks grantPullsToStoredWallet(count: number)"
grep -Fq "export async function applySessionRewardToWallet(sessionId: string, rewardPulls: number)" "$WAL" || fail "rewardWallet.ts: applySessionRewardToWallet must stay exported and unchanged"
for sym in "export function applyRewardToWallet(" "export function getRewardWalletMessage(" "export function canAcceptMorePulls(" \
           "export async function adoptAnonRewardWallet()" "export const STARTER_PULL_GRANT = 3;" \
           "import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../constants';"; do
  grep -Fq "$sym" "$WAL" || fail "rewardWallet.ts lost: $sym"
done

# 2e. newCardLedger.ts — R5 key literal, exports, imports
for sym in \
  "export const NEW_CARD_LEDGER_PREFIX = 'recallsmith:newCardPullPaidUids:';" \
  "export const DUE_CLEAR_MARKER_KEY = 'recallsmith:due-clear:v1';" \
  "export type NewCardLedger = Record<string, number>;" \
  "export async function readNewCardLedger(slug: string): Promise<{ ledger: NewCardLedger; present: boolean }>" \
  "export async function seedNewCardLedgerIfAbsent(slug: string, progress: CardProgress[]): Promise<NewCardLedger>" \
  "export async function payNewCardIfUnpaid(slug: string, stableUid: string, nowMs: number): Promise<{ paid: boolean; ledger: NewCardLedger }>" \
  "export function countPaidOnDay(ledger: NewCardLedger, now: Date): number" \
  "export async function markDueClearedIfFirstToday(now: Date): Promise<boolean>" \
  "export type AnonLedgerAdoption = { ledgerDecks: number; uidsAdded: number };" \
  "export async function adoptAnonNewCardLedger(): Promise<AnonLedgerAdoption>" \
  "getUserScopedKey" "ANON_USER_SCOPE_PREFIX" "formatDateKey" "isLearnedProgress" \
  "import AsyncStorage from '@react-native-async-storage/async-storage';"; do
  grep -Fq "$sym" "$LED" || fail "newCardLedger.ts lacks: $sym"
done
if grep -Eq "progressSync|drawStateSync|from 'react'" "$LED"; then
  fail "newCardLedger.ts must not import sync modules or react"
fi

# 2f. sessionRewards.ts — R1/R2/R8 step, verbatim
for sym in \
  "export type RatingRewardInput = {" \
  "export type RatingRewardStep = {" \
  "export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep>" \
  "export const ZERO_REWARD_STEP: RatingRewardStep" \
  "newCardEligible: boolean;" \
  "progressBefore: CardProgress[];" \
  "dueBefore: number;" \
  "remainingDueCount: number;" \
  "newCardsLearnedToday: number;" \
  "seedNewCardLedgerIfAbsent" "payNewCardIfUnpaid" "markDueClearedIfFirstToday" "countPaidOnDay" \
  "grantPullsToStoredWallet"; do
  grep -Fq "$sym" "$SREW" || fail "sessionRewards.ts lacks: $sym"
done
if grep -q "applySessionRewardToWallet" "$SREW"; then
  fail "sessionRewards.ts must not use the per-session receipt path (the ledger is the dedupe)"
fi

# 2g. sessionStore.ts — accumulator
for sym in "rewardOutcome: RewardOutcome;" "recordRewardStep: (step: RatingRewardStep, stableUid: string) => void;" \
           "rewardOutcome: EMPTY_REWARD_OUTCOME" "accumulateRewardOutcome("; do
  grep -Fq "$sym" "$STORE" || fail "sessionStore.ts lacks: $sym"
done

# 2h. navigation/types.ts — one optional param
grep -Fq "reward?: RewardOutcome;" "$NAV" || fail "navigation/types.ts: SessionSummary must gain reward?: RewardOutcome;"
grep -Fq "import type { RewardOutcome } from '../features/gacha/rewards/rewardResolver';" "$NAV" || fail "navigation/types.ts lacks the RewardOutcome type import"
grep -Fq "export type StudyMode = 'learn-new' | 'review-due' | 'mixed';" "$NAV" || fail "navigation/types.ts: StudyMode must stay untouched (C04 adds sweep)"

# 2i. SessionCardScreen.tsx — pay per rating; stake pill gone
for sym in "import { settleRatingReward } from '../features/gacha/rewards/sessionRewards';" \
           "recordRewardStep" "newCardEligible: true," "dueBefore: dueTodayCount," \
           "rewardPulls: outcome.rewardPulls," "reward: outcome," \
           "testID=\"screen-session-card-root\"" "session-card-trial-preview"; do
  grep -Fq "$sym" "$CARD" || fail "SessionCardScreen.tsx lacks: $sym"
done
for bad in "session-card-fullclear-stake" "fullClearReward" "showFullClearStake" "doneRewardPulls" "fullClearStakePill" "fullClearStakeText" "rewardResolver"; do
  if grep -q "$bad" "$CARD"; then fail "SessionCardScreen.tsx still contains: $bad"; fi
done
grep -Fq "doneMinimumGoal" "$CARD" || fail "SessionCardScreen.tsx: doneMinimumGoal must stay (Continue path still passes minimumGoal)"

# 2j. SessionSummaryScreen.tsx — no wallet write at the summary
for bad in "applySessionRewardToWallet" "rewardResolver"; do
  if grep -q "$bad" "$SUMMARY"; then fail "SessionSummaryScreen.tsx still references: $bad"; fi
done
for sym in "loadRewardWalletState" "reward ?? null" "reward?.walletBefore" \
           "testID=\"summary-reward-use-pulls-cta\"" "testID=\"summary-reward-block\""; do
  grep -Fq "$sym" "$SUMMARY" || fail "SessionSummaryScreen.tsx lacks: $sym"
done

# 2k. summaryMapper.ts — copy and the reward param
for sym in "sectionFullClear: 'Run reward'," "noPull: 'No free pulls this run'," "reward?: RewardOutcome | null;" \
           "fullClearLabel: (done: number, total: number) => \`\${done} / \${total} cards · full clear\`," \
           "fullClear: 'Run complete 🎉'," "resolveSessionReward({"; do
  grep -Fq "$sym" "$MAP" || fail "summaryMapper.ts lacks: $sym"
done
if grep -Eq "gained: \(|Full clear reward|free pull\\\$\{" "$MAP"; then
  fail "summaryMapper.ts still carries full-clear-era reward copy (gained / 'Full clear reward' / '+N free pull')"
fi

# 2l. drawState.ts — the constant, not the literal
grep -Fq "import { FREE_PULL_CAP } from '../constants';" "$DSTATE" || fail "drawState.ts lacks the FREE_PULL_CAP import"
grep -Fq "wallet.availablePulls >= FREE_PULL_CAP && wallet.reservePulls > 0" "$DSTATE" || fail "drawState.ts:60 must compare against FREE_PULL_CAP"
if grep -Eq ">= 30\b" "$DSTATE"; then fail "drawState.ts still compares against the literal 30"; fi
grep -Fq "Learn a new card or clear today’s due cards, then come back for new pulls." "$DSTATE" || fail "drawState.ts: has-work locked helper copy missing"
grep -Fq "No reward pulls are waiting yet. Learn a new card to earn one." "$DSTATE" || fail "drawState.ts: no-work locked helper copy missing"

# 2m. drawStateSync.ts — third adoption step
grep -Fq "export type AnonGachaAdoption = AnonDrawStateAdoption & AnonWalletAdoption & AnonLedgerAdoption;" "$DSYNC" || fail "drawStateSync.ts: AnonGachaAdoption must include AnonLedgerAdoption"
grep -Fq "await adoptAnonNewCardLedger()" "$DSYNC" || fail "drawStateSync.ts: adoptAnonGachaState must await adoptAnonNewCardLedger()"
grep -Fq "let _adopting: Promise<AnonGachaAdoption> | null = null;" "$DSYNC" || fail "drawStateSync.ts: _adopting coalescer must stay"

# 2n. DebugMenuScreen.tsx — 60/5
grep -Fq "saveRewardWalletState({ availablePulls: 60, reservePulls: 5 })" "$DEBUG" || fail "DebugMenuScreen.tsx must seed 60/5"
grep -Fq "'Wallet seeded 60/5.'" "$DEBUG" || fail "DebugMenuScreen.tsx lacks 'Wallet seeded 60/5.'"
[ "$(grep -c "Seed wallet 60/5" "$DEBUG" || true)" -ge 2 ] || fail "DebugMenuScreen.tsx needs 'Seed wallet 60/5' twice (a11y label + text)"
if grep -q "30/5" "$DEBUG"; then fail "DebugMenuScreen.tsx still says 30/5"; fi

# 2o. tests — property harness present, contract cases present
for t in "$LT" "$SRT"; do
  grep -q "from 'fast-check'" "$t" || fail "$t must use fast-check"
  grep -q "fc.assert(" "$t"        || fail "$t has no fc.assert property"
done
grep -Fq "devcards:u:anon:recallsmith:newCardPullPaidUids:csharp" "$LT" || fail "newCardLedger.test.ts must pin the resolved anon ledger key"
for s in \
  'pins the ledger key to the anon partition' \
  'pays each uid at most once across any call sequence' \
  'seeds exactly the learned uids with 0 and never overwrites a present ledger' \
  'reads a corrupt ledger as present and empty' \
  'marks the due-clear day once per local day' \
  'adopts the anon ledger into the user partition, unions and clears the anon key' \
  'is a no-op while signed out and on a second run'; do
  grep -Fq "it('$s'" "$LT" || fail "missing newCardLedger test case: $s"
done
grep -Fq "counts only today's positive stamps" "$LT" || fail "missing newCardLedger test case: counts only today's positive stamps"
for s in \
  'never pays on again and pays exactly once on the first hard, good or easy' \
  'never pays for a card that was already learned when the ledger was first seeded' \
  'fires the due-clear pull once per local day and only on a due-to-zero transition' \
  'skips the new-card pull in sweep mode but still evaluates the due clear' \
  'writes the ledger before it touches the wallet' \
  'returns the zero step and leaves the wallet alone when storage fails' \
  'reports pulls with a null wallet when the wallet write fails after the ledger'; do
  grep -Fq "it('$s'" "$SRT" || fail "missing sessionRewards test case: $s"
done
for s in \
  'accumulates steps into an outcome' \
  'renders the four reward lines verbatim' \
  'resolves a session reward from an outcome and from no outcome'; do
  grep -Fq "it('$s'" "$ROT" || fail "missing rewardOutcome test case: $s"
done
for s in "+1 pull · 1 new card learned" "+3 pulls · 3 new cards learned" "+1 · cleared today's due" "+4 pulls · 3 new cards learned · cleared today's due"; do
  grep -Fq "$s" "$ROT" || fail "rewardOutcome.test.ts must pin the line: $s"
done
# rewards.test.ts — kept titles, removed trio, cap at 60
for s in \
  'fills available pulls first, then reserve, then drops overflow' \
  'drops rewards when both available and reserve are already full' \
  'builds a neutral progress summary when no pull reward is earned' \
  'reports whether the wallet can still accept more pulls' \
  'grants 3 starter pulls to a brand-new (empty) wallet on first boot' \
  'persists and deduplicates a session reward application'; do
  grep -Fq "it('$s'" "$RT" || fail "rewards.test.ts lost case: $s"
done
for s in 'computes no pulls when the session is empty' 'computes no pulls for a partial run (below full clear)' 'computes one pull for a full clear'; do
  if grep -Fq "$s" "$RT"; then fail "rewards.test.ts still has the old-rule case: $s"; fi
done
grep -Fq "availablePulls: 59, reservePulls: 4" "$RT" || fail "rewards.test.ts case 1 must start at {59,4}"
grep -Fq "reward: null" "$RT" || fail "rewards.test.ts case 3 must call resolveSessionReward with reward: null"
if grep -Eq "availablePulls: 30\b" "$RT"; then fail "rewards.test.ts still pins the 30 cap"; fi
# summaryMapper.spec.ts / summary-home / session-summary / session-card / session-store
grep -Fq "it('maps 59 → 60 with one new card learned'" "$SMT" || fail "summaryMapper.spec.ts: scenario 3 must be retitled 'maps 59 → 60 with one new card learned'"
grep -Fq "+1 pull · 1 new card learned" "$SMT" || fail "summaryMapper.spec.ts must expect '+1 pull · 1 new card learned'"
grep -Fq "60 ready to use" "$SMT" || fail "summaryMapper.spec.ts must expect '60 ready to use'"
grep -Fq "Free pulls full · 5 pending in reserve" "$SMT" || fail "summaryMapper.spec.ts must keep the wallet-full line"
grep -Fq "it('COPY contains no loss-aversion terms'" "$SMT" || fail "summaryMapper.spec.ts lost the COPY-terms case"
grep -Fq "it('keeps an enabled library CTA when no deck is available'" "$SHT" || fail "summary-home.test.ts lost the buildHomeVM describe"
grep -Fq "unlock after you clear today’s work" "$SHT" || fail "summary-home.test.ts:121 must stay byte-identical"
grep -Fq "it('shows the outcome reward copy and never writes the wallet'" "$SST" || fail "session-summary.screen.test.tsx: case 1 must be retitled 'shows the outcome reward copy and never writes the wallet'"
if grep -Fq "applies the reward to the wallet once and shows wallet-aware copy" "$SST"; then fail "session-summary.screen.test.tsx still has the old case-1 title (the summary no longer applies the reward)"; fi
grep -Fq "+1 pull · 1 new card learned" "$SST" || fail "session-summary.screen.test.tsx case 1 must expect '+1 pull · 1 new card learned'"
grep -Fq "1 ready to use" "$SST" || fail "session-summary.screen.test.tsx case 1 must expect '1 ready to use'"
grep -Fq "vi.spyOn(rewardWallet, 'loadRewardWalletState')" "$SST" || fail "session-summary.screen.test.tsx cases 2/3 must spy loadRewardWalletState"
if grep -q "applySessionRewardToWallet" "$SST"; then fail "session-summary.screen.test.tsx must no longer spy applySessionRewardToWallet"; fi
for s in 'uses neutral empty-state library copy without session setup language' 'shows an extra milestone count when multiple milestones unlock' \
         'shows an error branch and retries reward resolution without navigating away' 'keeps the primary CTA disabled while reward resolution is loading'; do
  grep -Fq "it('$s'" "$SST" || fail "session-summary.screen.test.tsx lost case: $s"
done
grep -Fq "vi.mock('../../src/features/gacha/rewards/sessionRewards'" "$SCT" || fail "session-card.screen.test.tsx must mock sessionRewards"
grep -Fq "it('settles the rating reward and hands the outcome to Settlement'" "$SCT" || fail "session-card.screen.test.tsx: settlement case must be retitled"
grep -Fq "reward: expect.any(Object)" "$SCT" || fail "session-card.screen.test.tsx: the SessionSummary literal must gain reward: expect.any(Object)"
grep -Fq "it('routes to SessionSummary when Continue is pressed in the route-complete state'" "$SCT" || fail "session-card.screen.test.tsx lost the Continue case"
if grep -q "computes settlement reward pulls through the reward resolver" "$SCT"; then fail "session-card.screen.test.tsx still has the old settlement title"; fi
grep -Fq "it('accumulates reward steps into the session outcome'" "$STT" || fail "session-store.test.ts must add the recordRewardStep case"
for s in 'starts a session with route metadata and counters reset' 'records ratings, advances session progress, and earns streak on first non-again rating' 'resets back to the empty session state'; do
  grep -Fq "it('$s'" "$STT" || fail "session-store.test.ts lost case: $s"
done
# literal moves
grep -Fq "ledgerDecks: 0, uidsAdded: 0" "$DAT" || fail "drawStateAdoption.test.ts: ZERO must gain ledgerDecks: 0, uidsAdded: 0"
grep -Fq "availablePulls: 58, reservePulls: 0" "$DAT" || fail "drawStateAdoption.test.ts: user wallet fixture must move 28 → 58"
grep -Fq "toEqual({ availablePulls: 60, reservePulls: 5 })" "$DAT" || fail "drawStateAdoption.test.ts must expect {60,5}"
grep -Fq "expectedDrawBadge: 'Wallet full (60 + 5)'" "$HPT" || fail "home-primary-cta.test.tsx must expect 'Wallet full (60 + 5)'"
grep -Fq "Wallet seeded 60/5" "$CTT" || fail "ceremonyTuning.test.tsx must expect 'Wallet seeded 60/5'"
grep -Fq "toHaveBeenCalledWith({ availablePulls: 60, reservePulls: 5 })" "$CTT" || fail "ceremonyTuning.test.tsx must expect the 60/5 seed"
for f in "$DT" "$HST" "$HPT" "$CTT" "$SMOKE" "$SMT"; do
  if grep -Eq "availablePulls: 30, reservePulls: 5\b|availablePulls: 30, reservePulls: 2\b|availablePulls: 30, reservePulls: 1\b|availablePulls: 30, reservePulls: 4\b|\(30 \+ 5\)|30/5" "$f"; then
    grep -En "availablePulls: 30|\(30 \+ 5\)|30/5" "$f" >&2 || true
    fail "$f still pins the 30 cap"
  fi
done
grep -Fq "reward:" "$SMOKE" || fail "p2-smoke.ts must pass reward outcomes to resolveSessionReward"

# 2p. suppression / gutting — diff-scoped for tracked files (SessionCardScreen.tsx:380 pre-dates the wave), whole-file for new ones
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
added="$(git diff -U0 "$mb" -- "${SRC_FILES[@]}" "${TEST_FILES[@]}" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added" | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable"; then
  printf '%s\n' "$added" | grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" >&2 || true
  fail "test gutting / suppression found in an added line"
fi
if grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$LED" "$SREW" "$LT" "$SRT" "$ROT"; then
  fail "test gutting / suppression found in a new file"
fi
if grep -En "JSX\.Element" "${SRC_FILES[@]}" | grep -v "React\.JSX\.Element" | grep -q .; then
  grep -En "JSX\.Element" "${SRC_FILES[@]}" | grep -v "React\.JSX\.Element" >&2 || true
  fail "bare JSX.Element in a signature (B00 §9 #19)"
fi

# ── 3. Typecheck (also compiles tests/p2-smoke.ts) ─────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new + edited + the byte-identical neighbours) ──────
echo "[4/5] vitest rewards / ledger / summary / session / cap literals"
( cd mobile && npx vitest run \
    tests/unit/newCardLedger.test.ts \
    tests/unit/sessionRewards.test.ts \
    tests/unit/rewardOutcome.test.ts \
    tests/unit/rewards.test.ts \
    tests/unit/summaryMapper.spec.ts \
    tests/unit/summary-home.test.ts \
    tests/unit/session-store.test.ts \
    tests/unit/draw.test.ts \
    tests/unit/drawStateAdoption.test.ts \
    tests/unit/homeSelectors.spec.ts \
    tests/unit/ceremonyTuning.test.tsx \
    tests/unit/rewardWalletOrdering.test.ts \
    tests/unit/gachaUserScope.test.ts \
    tests/unit/economyFloor.test.ts \
    tests/integration/session-summary.screen.test.tsx \
    tests/integration/session-card.screen.test.tsx \
    tests/integration/home-primary-cta.test.tsx \
    tests/integration/economy-floor.spec.tsx \
    tests/integration/home-economy-floor.spec.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen + OTA guard (purely negative; passes on base) ────────
echo "[5/5] scope + frozen + OTA guard"
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/features/gacha/rewards/economyFloor.ts mobile/src/review/storage.ts \
  mobile/src/features/gacha/draw/drawStateStore.ts mobile/src/features/gacha/components/RewardSummaryCard.tsx \
  mobile/src/features/gacha/selectors/homeSelectors.ts mobile/src/screens/HomeScreen.tsx mobile/src/content/faq.ts \
  mobile/src/features/gacha/planner mobile/src/config \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/vitest.config.ts mobile/tests/setup \
  mobile/tests/unit/rewardWalletOrdering.test.ts mobile/tests/unit/gachaUserScope.test.ts mobile/tests/unit/economyFloor.test.ts \
  mobile/tests/integration/economy-floor.spec.tsx mobile/tests/integration/home-economy-floor.spec.tsx \
  mobile/tests/unit/planner.test.ts mobile/tests/unit/ownedGatePredicates.test.ts mobile/tests/integration/home.screen.test.tsx)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen / byte-identical / out-of-scope file modified"; }
# rewardWallet.ts is append-only: numstat deletions must be 0
walnum="$(git diff --numstat "$mb" -- "$WAL" | awk '{print $2}')"
[ -z "$walnum" ] || [ "$walnum" = "0" ] || fail "rewardWallet.ts must be append-only (numstat deletions = $walnum)"
# OTA guard
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail 'mobile/package.json must keep "expo-updates": "~29.0.15"'
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail 'mobile/app.json must keep "version": "1.6.0"'
grep -Fq '"vite": "7.2.4"' mobile/package.json            || fail 'mobile/package.json must keep "vite": "7.2.4"'
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (Sentry is out of 1.6.0)"; fi
[ ! -d mobile/src/observability ] || fail "mobile/src/observability must not exist"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests; } | sort -u | grep -Ev '^(mobile/src/features/gacha/constants\.ts|mobile/src/features/gacha/rewards/rewardResolver\.ts|mobile/src/features/gacha/rewards/rewardWallet\.ts|mobile/src/features/gacha/rewards/newCardLedger\.ts|mobile/src/features/gacha/rewards/sessionRewards\.ts|mobile/src/features/gacha/session/sessionStore\.ts|mobile/src/features/gacha/session/summaryMapper\.ts|mobile/src/features/gacha/draw/drawState\.ts|mobile/src/sync/drawStateSync\.ts|mobile/src/screens/DebugMenuScreen\.tsx|mobile/src/navigation/types\.ts|mobile/src/screens/SessionSummaryScreen\.tsx|mobile/src/screens/SessionCardScreen\.tsx|mobile/tests/unit/newCardLedger\.test\.ts|mobile/tests/unit/sessionRewards\.test\.ts|mobile/tests/unit/rewardOutcome\.test\.ts|mobile/tests/unit/rewards\.test\.ts|mobile/tests/unit/summaryMapper\.spec\.ts|mobile/tests/unit/summary-home\.test\.ts|mobile/tests/integration/session-summary\.screen\.test\.tsx|mobile/tests/integration/session-card\.screen\.test\.tsx|mobile/tests/unit/session-store\.test\.ts|mobile/tests/unit/draw\.test\.ts|mobile/tests/unit/drawStateAdoption\.test\.ts|mobile/tests/unit/homeSelectors\.spec\.ts|mobile/tests/integration/home-primary-cta\.test\.tsx|mobile/tests/unit/ceremonyTuning\.test\.tsx|mobile/tests/p2-smoke\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C01 scope"; }

echo "C01 VERIFY OK"

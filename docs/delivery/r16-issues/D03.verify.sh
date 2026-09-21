#!/usr/bin/env bash
# D03 — planner-kind-hint verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/mcq/mcqRotation.ts,
#     mobile/tests/unit/mcqRotation.test.ts and
#     mobile/tests/unit/plannerKindHint.test.ts do not exist on base
#   (step 1 then also checks the D01/D02 prerequisites: normalizeMcq.ts with
#   its pinned signature, CardExport.Mcq? on deckExport.ts and mcqVerdict.ts
#   must be on the integration branch, because D00 §4 orders D01 → D02 → D03
#   and the planner imports normalizeMcq)
# Step 2 (literal guards: the mcqRotation.ts signatures, the kindHint key on
# both param objects, the pinned pickNew lines, the untouched bucket/owns/
# dispatch lines, the it('…') titles, the four-file .Mcq reader set) would also
# fail on base. Steps 3/4 are the tsc / targeted-vitest gates and step 5 is a
# scope + frozen + OTA guard; both pass on base by design.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (D00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 1–2 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D03 VERIFY FAIL: $*" >&2; exit 1; }

ROT=mobile/src/features/gacha/mcq/mcqRotation.ts
PLANNER=mobile/src/features/gacha/planner/sessionPlanner.ts
HELPERS=mobile/src/features/gacha/session/sessionReviewHelpers.ts
RT=mobile/tests/unit/mcqRotation.test.ts
PT=mobile/tests/unit/plannerKindHint.test.ts
NORM=mobile/src/features/gacha/mcq/normalizeMcq.ts
VERDICT=mobile/src/features/gacha/mcq/mcqVerdict.ts
EXPORT=mobile/src/types/deckExport.ts

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ D01/D02 prerequisites)"
for f in "$ROT" "$RT" "$PT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$PLANNER" "$HELPERS" "$EXPORT"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$NORM" ] || fail "$NORM is missing — D01 must be merged before D03 (D00 §4)"
grep -Fq "export function normalizeMcq(raw: unknown): McqExport | null" "$NORM" || fail "normalizeMcq.ts lacks the pinned normalizeMcq signature (D01 incomplete)"
grep -Fq "Mcq?: McqExport | null;" "$EXPORT" || fail "deckExport.ts lacks 'Mcq?: McqExport | null;' (D01 incomplete)"
[ -f "$VERDICT" ] || fail "$VERDICT is missing — D02 must be merged before D03 (D00 §4)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# 2a. mcqRotation.ts — five exports with pinned signatures, three pinned imports, pure, no .Mcq
for sym in "export type McqKindHint = { mcqAllowed: boolean; preferMcq: boolean };" \
           "export type McqRunState = { served: number; lastNewKind: 'mcq' | 'qa' | null };" \
           "export const EMPTY_MCQ_RUN_STATE: McqRunState = Object.freeze({ served: 0, lastNewKind: null });" \
           "export function buildKindHint(state: McqRunState, flags: Pick<FeatureFlags, 'mcq'>): McqKindHint | null" \
           "export function noteServedCard(state: McqRunState, progress: CardProgress, isMcq: boolean): McqRunState" \
           "import { isNewProgress } from '../selectors/progressSelectors';" \
           "import type { FeatureFlags } from '../../../config/featureFlags';" \
           "import type { CardProgress } from '../../../review/model';"; do
  grep -Fq "$sym" "$ROT" || fail "mcqRotation.ts lacks: $sym"
done
[ "$(grep -c '^export ' "$ROT" || true)" = "5" ] || fail "mcqRotation.ts must have exactly five exports (two types, one const, two functions)"
if grep -Eq "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|getFeatureFlags|\.Mcq\b|console\.|export default" "$ROT"; then
  grep -En "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|getFeatureFlags|\.Mcq\b|console\.|export default" "$ROT" >&2 || true
  fail "mcqRotation.ts must stay pure (no react / require / storage / clock / randomness / flag reads / .Mcq / console / default export)"
fi

# 2b. sessionPlanner.ts — the hint key, the pinned pickNew, everything else byte-identical
for sym in "import type { McqKindHint } from '../mcq/mcqRotation';" \
           "import { normalizeMcq } from '../mcq/normalizeMcq';" \
           "  kindHint?: McqKindHint | null;" \
           "  const { deck, progress, now, mode, avoidUid, index, ownedSet = null, kindHint = null } = params;" \
           "const isMcq = (card: CardExport) => normalizeMcq(card.Mcq) !== null;" \
           "const isNew = (card: CardExport, p: CardProgress) => owns(card) && isNewProgress(p);" \
           "if (!kindHint) return pickWith(isNew);" \
           "if (!kindHint.mcqAllowed) return pickWith((card, p) => isNew(card, p) && !isMcq(card));" \
           "kindHint.preferMcq ? isMcq(card) : !isMcq(card)" \
           "return preferred ?? pickWith(isNew);" \
           "const owns = (card: CardExport) => isOwned(card.StableUid, ownedSet);" \
           "const pickDue = () => pickWith((card, progressEntry) => owns(card) && isDueTodayBucket(progressEntry, now));" \
           "const pickUpdated = () => pickWith((card, progressEntry) => owns(card) && isUpdatedCard(card, progressEntry));" \
           "const pickSweep = () => {" \
           "if (avoidUid && card.StableUid === avoidUid) continue;" \
           "if (mode === 'sweep') return pickSweep();" \
           "if (mode === 'review-due') return pickDue();" \
           "if (mode === 'learn-new') return pickNew();" \
           "return pickDue() ?? pickUpdated() ?? pickNew();"; do
  grep -Fq "$sym" "$PLANNER" || fail "sessionPlanner.ts lacks: $sym"
done
grep -Eq "^\s*//.*kindHint" "$PLANNER" || fail "sessionPlanner.ts: the :131-139 comment block must gain one sentence naming kindHint as the fourth pick"
[ "$(grep -c '\.Mcq\b' "$PLANNER" || true)" = "1" ] || fail "sessionPlanner.ts must reference .Mcq exactly once (the pinned isMcq line)"
if grep -Eq "featureFlags|getFeatureFlags|console\.|from 'react|Date\.now|Math\.random|require\(" "$PLANNER"; then
  grep -En "featureFlags|getFeatureFlags|console\.|from 'react|Date\.now|Math\.random|require\(" "$PLANNER" >&2 || true
  fail "sessionPlanner.ts must not read flags / log / import react / touch the clock (the hint arrives as a value)"
fi
planner_removed="$(git diff -U0 "$mb" -- "$PLANNER" | grep '^-' | grep -v '^---' || true)"
if printf '%s\n' "$planner_removed" | grep -Eq 'pickWith = |const owns|pickDue|pickUpdated|pickSweep|if \(avoidUid|mode === '; then
  printf '%s\n' "$planner_removed" >&2
  fail "sessionPlanner.ts: a removed line touches pickWith / owns / pickDue / pickUpdated / pickSweep / the dispatch — only pickNew may change"
fi
planner_ns="$(git diff --numstat "$mb" -- "$PLANNER" | cut -f1,2)"
[ -n "$planner_ns" ] || fail "sessionPlanner.ts is unchanged against the base"
[ "$(printf '%s' "$planner_ns" | cut -f1)" -le 18 ] && [ "$(printf '%s' "$planner_ns" | cut -f2)" -le 5 ] \
  || fail "sessionPlanner.ts numstat '$planner_ns' is beyond the +18/-5 envelope of a pickNew-only change"

# 2c. sessionReviewHelpers.ts — the pass-through and nothing else
for sym in "import type { McqKindHint } from '../mcq/mcqRotation';" \
           "  kindHint?: McqKindHint | null;" \
           "ownedSet = null, kindHint = null } = params;" \
           "          kindHint," \
           "const nextDone = sessionDone + 1;" \
           "avoidUid: updatedOne.stableUid," \
           "          ownedSet,"; do
  grep -Fq "$sym" "$HELPERS" || fail "sessionReviewHelpers.ts lacks: $sym"
done
if grep -Eq "featureFlags|getFeatureFlags|console\.|from 'react|Date\.now|Math\.random|require\(|\.Mcq\b" "$HELPERS"; then
  grep -En "featureFlags|getFeatureFlags|console\.|from 'react|Date\.now|Math\.random|require\(|\.Mcq\b" "$HELPERS" >&2 || true
  fail "sessionReviewHelpers.ts must not read flags / log / import react / touch the clock / read .Mcq"
fi
helpers_removed="$(git diff -U0 "$mb" -- "$HELPERS" | grep '^-' | grep -v '^---' || true)"
if printf '%s\n' "$helpers_removed" | grep -Eq 'nextDone|scheduleNextReview|avoidUid|remaining|countDueToday|prevLearnedCount'; then
  printf '%s\n' "$helpers_removed" >&2
  fail "sessionReviewHelpers.ts: a removed line touches the rating math — only the kindHint pass-through may change"
fi
helpers_ns="$(git diff --numstat "$mb" -- "$HELPERS" | cut -f1,2)"
[ -n "$helpers_ns" ] || fail "sessionReviewHelpers.ts is unchanged against the base"
[ "$(printf '%s' "$helpers_ns" | cut -f1)" -le 6 ] && [ "$(printf '%s' "$helpers_ns" | cut -f2)" -le 2 ] \
  || fail "sessionReviewHelpers.ts numstat '$helpers_ns' is beyond the +6/-2 envelope of a pass-through"

# 2d. tests — titles, harnesses, property test, spy, fixture provenance, counts
grep -Fq "from '../../src/features/gacha/mcq/mcqRotation'" "$RT" || fail "mcqRotation.test.ts must import mcqRotation.ts"
grep -Fq "Object.isFrozen(" "$RT" || fail "mcqRotation.test.ts must pin EMPTY_MCQ_RUN_STATE as frozen"
for s in \
  'answers null under the kill switch' \
  'caps at maxPerRun and alternates on the last new kind' \
  'counts served MCQ cards from any bucket'; do
  grep -Fq "it('$s'" "$RT" || fail "missing mcqRotation test case: $s"
done
grep -Fq "from 'fast-check'" "$PT" || fail "plannerKindHint.test.ts must use fast-check (D00 §3.7: hint-null equivalence)"
grep -Fq "fc.assert(" "$PT"        || fail "plannerKindHint.test.ts has no fc.assert property"
grep -Fq "from '../../src/features/gacha/planner/sessionPlanner'" "$PT" || fail "plannerKindHint.test.ts must import sessionPlanner.ts"
grep -Fq "from '../../src/features/gacha/session/sessionReviewHelpers'" "$PT" || fail "plannerKindHint.test.ts must import sessionReviewHelpers.ts"
grep -Fq "importOriginal" "$PT" || fail "plannerKindHint.test.ts must spy on pickNextCard through the importOriginal pass-through mock"
grep -Fq "mock.calls" "$PT"      || fail "plannerKindHint.test.ts must assert the forwarded kindHint from mock.calls"
grep -Fq "'LEAST operational overhead'" "$PT" || fail "plannerKindHint.test.ts must carry the plan §4.3 card-1 blob (qualifier 'LEAST operational overhead')"
grep -Fq "1540" "$PT" || fail "plannerKindHint.test.ts must place MCQ cards at OrderInDeck 1540+ (the ordering problem)"
for s in \
  'is a no-op without a hint' \
  'keeps the due → updated → new bucket order under a hint' \
  'keeps the owns guard under a hint' \
  'never deals an MCQ new card when mcqAllowed is false' \
  'prefers an MCQ new card that sorts after every Q/A card' \
  'alternates back to Q/A and falls back to MCQ' \
  'ignores the hint in review-due and sweep' \
  'buildRatedSessionState forwards the hint'; do
  grep -Fq "it('$s'" "$PT" || fail "missing plannerKindHint test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$RT" || true)" -ge 3 ] || fail "mcqRotation.test.ts needs >= 3 it() blocks"
[ "$(grep -cE "^\s*it\(" "$PT" || true)" -ge 8 ] || fail "plannerKindHint.test.ts needs >= 8 it() blocks"
# Suppression scan: whole new files + the added lines of the two edited files (D00 §5).
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$ROT" "$RT" "$PT" \
  && fail "test gutting / suppression found in a new file"
added_lines="$(git diff -U0 "$mb" -- "$PLANNER" "$HELPERS" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added_lines" | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable"; then
  fail "suppression token in an added line of sessionPlanner.ts / sessionReviewHelpers.ts"
fi
# 2e. Existing planner / helper suites are zero-diff against the base (D03 is add-only on tests)
git diff --quiet "$mb" -- \
  mobile/tests/unit/planner.test.ts \
  mobile/tests/unit/ownedGatePredicates.test.ts \
  mobile/tests/unit/sweepPlanner.test.ts \
  mobile/tests/unit/featureFlags.test.ts \
  mobile/tests/integration/session-card.screen.test.tsx \
  mobile/tests/integration/challenge.screen.test.tsx \
  mobile/tests/p2-smoke.ts \
  || fail "an existing planner / helper / flag test file changed — D03 is add-only on tests (D00 §1.1)"
# 2f. .Mcq readers: exactly the four of the brief (D00 §0's three + the pinned isMcq line in the planner)
readers="$(grep -rln '\.Mcq\b' mobile/src | grep -Ev '^(mobile/src/types/deckExport\.ts|mobile/src/content/deckRepository\.ts|mobile/src/features/gacha/mcq/normalizeMcq\.ts|mobile/src/features/gacha/planner/sessionPlanner\.ts)$' || true)"
[ -z "$readers" ] || { echo "$readers" >&2; fail "a file outside the four allowed readers references .Mcq"; }

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the planner / helper suites they sit beside) ──
echo "[4/5] vitest mcqRotation / plannerKindHint / planner suites"
( cd mobile && npx vitest run \
    tests/unit/mcqRotation.test.ts \
    tests/unit/plannerKindHint.test.ts \
    tests/unit/planner.test.ts \
    tests/unit/ownedGatePredicates.test.ts \
    tests/unit/sweepPlanner.test.ts \
    tests/integration/session-card.screen.test.tsx \
    tests/integration/challenge.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The three frozen files are zero-diff (D01's signed exception is already on the base)
git diff --quiet "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen file changed (deckRepository.ts / progressSync.ts / model.ts must be zero-diff in D03)"
# 5b. The do-not-touch neighbours and the OTA manifest set
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts \
  mobile/src/features/gacha/planner/sessionBuilder.ts mobile/src/features/gacha/planner/sessionRoles.ts \
  mobile/src/features/gacha/session/sessionStore.ts mobile/src/features/gacha/session/reviewContentHelpers.ts \
  mobile/src/features/gacha/rewards mobile/src/features/gacha/selectors/progressSelectors.ts \
  mobile/src/features/gacha/contracts.ts mobile/src/features/gacha/constants.ts \
  mobile/src/features/gacha/mcq/normalizeMcq.ts mobile/src/features/gacha/mcq/mcqVerdict.ts \
  mobile/src/features/gacha/mcq/mcqShuffle.ts mobile/src/features/gacha/mcq/mcqConstants.ts \
  mobile/src/types/deckExport.ts mobile/src/config/featureFlags.ts mobile/src/config/remoteConfig.ts \
  mobile/src/config/forceUpdateGate.ts mobile/src/screens mobile/src/navigation/types.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
if grep -rq "from 'expo-updates'" mobile/src/features/gacha; then fail "static expo-updates import under features/gacha (C00 §6 #17)"; fi
# 5c. Every changed or untracked path is one of the five scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/features/gacha/mcq/mcqRotation\.ts|mobile/src/features/gacha/planner/sessionPlanner\.ts|mobile/src/features/gacha/session/sessionReviewHelpers\.ts|mobile/tests/unit/mcqRotation\.test\.ts|mobile/tests/unit/plannerKindHint\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D03 scope"; }

echo "D03 VERIFY OK"

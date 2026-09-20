#!/usr/bin/env bash
# B09 — ceremony-screen-wiring verify. cwd = worktree root. Re-runs the brief's
# Acceptance steps 0-10 verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO:
#   - at step 0 on delivery/r16-b-ceremony as cut from main (no Wave B issue merged):
#     the deps guard finds no `export const CEREMONY_COPY_V10` in ceremonyCopy.ts (B10),
#     no `GLOW_9SLICE` in packArt.ts (B12) and none of the B05-B08 modules, and stops
#     with "deps not merged" — B09 must never be scheduled before B05, B06, B07, B08,
#     B10 and B12 have merged (B00 §5, §9 #2);
#   - at step 1 on the integration branch once those six have merged but B09 has not:
#     mobile/src/components/ceremony/FallbackStage.tsx, SpillSampler.tsx and
#     FeaturedCard.tsx do not exist (all three are created by this issue). Were step 1
#     skipped, step 2 would fail because the base test file (787 lines) does not begin
#     with the 596-line de-Lottied prefix this script derives from it (line 518 of the
#     base is the first deleted Lottie case), and steps 5-8 would fail on the base
#     DrawCeremonyScreen.tsx (imports CeremonyLottie, mounts <CeremonyLottie
#     onAnimationFinish>, runs the orbit setInterval). Steps 4, 9 and 10 are
#     baseline/negative guards and pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B09 VERIFY FAIL: $*" >&2; exit 1; }

scr=mobile/src/screens/DrawCeremonyScreen.tsx
tst=mobile/tests/integration/draw-ceremony.screen.test.tsx
fb=mobile/src/components/ceremony/FallbackStage.tsx
sp=mobile/src/components/ceremony/SpillSampler.tsx
fc=mobile/src/components/ceremony/FeaturedCard.tsx
cs=mobile/src/components/ceremony/ceremonyStyles.ts
TMP="${TMPDIR:-/tmp}/b09-verify-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# ── 0. Deps merged (FAILS ON THE PRE-WAVE BASE) ────────────────────────────
echo "[0/10] deps merged (B05 B06 B07 B08 B10 B12)"
grep -q 'export const CEREMONY_COPY_V10' mobile/src/features/gacha/draw/ceremonyCopy.ts \
  || fail "deps not merged: CEREMONY_COPY_V10 missing from ceremonyCopy.ts (B10 must merge before B09; B00 §5, §9 #2)"
grep -q 'GLOW_9SLICE' mobile/src/theme/packArt.ts \
  || fail "deps not merged: GLOW_9SLICE missing from packArt.ts (B12 must merge before B09; B00 §5)"
for dep in mobile/src/components/ceremony/StageCanvas.tsx mobile/src/components/ceremony/PackTear.tsx \
           mobile/src/components/ceremony/useCeremonyTimeline.ts mobile/src/components/ceremony/TapCard.tsx; do
  [ -f "$dep" ] || fail "deps not merged: $dep missing (B05/B06/B07/B08 must merge before B09; B00 §5)"
done

# ── 1. New leaves exist (FAILS ON BASE) ────────────────────────────────────
echo "[1/10] scope files exist"
for f in "$fb" "$sp" "$fc"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here by design)"
done
[ -f "$scr" ] && [ -f "$tst" ] && [ -f "$cs" ] || fail "scope file missing ($scr / $tst / $cs)"

# ── 2. Integration test prefix is byte-exact (B00 §4.2) ────────────────────
echo "[2/10] draw-ceremony.screen.test.tsx prefix"
if ! git rev-parse --verify -q "$BASE_REF" >/dev/null; then
  git rev-parse --verify -q "origin/$BASE_REF" >/dev/null || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE)"
  BASE_REF="origin/$BASE_REF"
fi
git show "$BASE_REF:$tst" > "$TMP/base.tsx" || fail "cannot read $tst from $BASE_REF"
BASE_LINES=$(wc -l < "$TMP/base.tsx" | tr -d ' ')
[ "$BASE_LINES" = 787 ] || fail "base $tst has $BASE_LINES lines, expected 787 (B10 must keep the line count; the transform below is line-addressed)"
# The transform of B00 §4.2, all addresses in ORIGINAL line numbers (sed applies them to input lines);
# the ten literal substitutions are idempotent when B10 already applied them.
sed \
  -e '518,635d' -e '637,652d' -e '730,732d' -e '734,787d' \
  -e '636s/keeps normal-motion lottie multi choreography and cadence parity/keeps normal-motion multi choreography and cadence parity/' \
  -e '657s/<DrawCeremonyScreenWithLottie/<DrawCeremonyScreen/' \
  -e "680s/\\.toBe('lottie')/.toBe('fallback')/" \
  -e "152s/'Legendary inbound'/'Pack inbound'/" -e "166s/'Legendary inbound'/'Pack inbound'/" -e "667s/'Legendary inbound'/'Pack inbound'/" \
  -e "243s/'Rare inbound'/'Pack inbound'/" -e "258s/'Rare inbound'/'Pack inbound'/" \
  -e "197s/'Card revealed'/'Pack open'/" -e "204s/'Card revealed'/'Pack open'/" -e "288s/'Card revealed'/'Pack open'/" \
  -e "378s/'Card revealed'/'Pack open'/" -e "384s/'Card revealed'/'Pack open'/" \
  "$TMP/base.tsx" > "$TMP/expected_prefix.tsx"
PREFIX_LINES=$(wc -l < "$TMP/expected_prefix.tsx" | tr -d ' ')
[ "$PREFIX_LINES" = 596 ] || fail "internal: derived prefix has $PREFIX_LINES lines, expected 596"
if grep -Eq "[Ll]ottie|'Legendary inbound'|'Rare inbound'|'Card revealed'" "$TMP/expected_prefix.tsx"; then
  fail "internal: derived prefix still contains a Lottie/rarity literal"
fi
head -n "$PREFIX_LINES" "$tst" > "$TMP/actual_prefix.tsx"
cmp -s "$TMP/expected_prefix.tsx" "$TMP/actual_prefix.tsx" \
  || { diff -u "$TMP/expected_prefix.tsx" "$TMP/actual_prefix.tsx" | head -40 >&2; fail "$tst does not begin with the byte-exact §4.2 prefix (base tree fails here by design)"; }
[ "$(tail -n 1 "$tst")" = "});" ] || fail "$tst must end with '});'"
IT_COUNT=$(grep -cE "^\s*it(\.each\([^)]*\))?\(" "$tst" || true)
[ "$IT_COUNT" -ge 17 ] || fail "$tst has $IT_COUNT it() blocks, need >= 17 (9 retained + 8 new)"
for s in \
  'reaches the tap-to-flip table by timer when tapFlow is on and flips only on the table' \
  'keeps the rarity word out of every text before a card is face up' \
  'reduced motion with tapFlow keeps the reveal on the table with no flash' \
  'exposes the pack as an accessible button whose activate action starts the ceremony' \
  'renders the fallback stage when motion is unavailable and still reaches settle' \
  'spills exactly as many cards as were drawn' \
  'lets a repeat user compress from hold without leaving the ceremony' \
  'never shows a fast-forward control on a first-ever ceremony before settle'; do
  grep -Fq -- "it('$s'" "$tst" || fail "missing new test case: $s"
done
if grep -En "CeremonyLottie|mock-ceremony-lottie|'Legendary inbound'|'Rare inbound'|'Card revealed'|DrawCeremonyScreenWithLottie" "$tst"; then
  fail "forbidden literal in $tst (see lines above)"
fi

# ── 3. Targeted vitest ─────────────────────────────────────────────────────
echo "[3/10] vitest ceremony integration + result + consumed unit suites"
( cd mobile && npx vitest run \
    tests/integration/draw-ceremony.screen.test.tsx \
    tests/integration/draw-result.screen.test.tsx \
    tests/unit/ceremonyTimings.test.ts \
    tests/unit/useCeremonyTimeline.test.ts \
    tests/unit/tapCard.test.tsx \
    tests/unit/stageCanvas.test.tsx \
    tests/unit/packTear.test.tsx \
    tests/unit/skipPolicy.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 4. Typecheck ───────────────────────────────────────────────────────────
echo "[4/10] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 5. Screen positive guards (FAILS ON BASE) ──────────────────────────────
echo "[5/10] DrawCeremonyScreen.tsx positive guards"
for s in \
  "'../components/ceremony/StageCanvas'" \
  "'../components/ceremony/PackTear'" \
  "'../components/ceremony/TapCard'" \
  "'../components/ceremony/FallbackStage'" \
  "'../components/ceremony/SpillSampler'" \
  "'../components/ceremony/useCeremonyTimeline'" \
  "'../components/ceremony/reanimatedGuard'" \
  "'../components/ceremony/ceremonyStyles'" \
  "'../features/gacha/draw/ceremonyTimings'" \
  "'../features/gacha/draw/spillSchedule'" \
  "'../features/gacha/draw/skipPolicy'" \
  "'../features/gacha/draw/ceremonyPrefs'" \
  "'../config/featureFlags'" \
  'resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable })' \
  'route.params.tapFlow ??' \
  'flags.ceremony.seamOfLight' \
  'flags.ceremony.forceFallback' \
  'dev.forceFallback' \
  'compressTimings(' \
  'skipPolicy(' \
  'readCeremoniesCompleted(' \
  'markCeremonyCompleted(' \
  'effectiveCeremoniesCompleted(' \
  'buildSpillSchedule(' \
  'featuredCardIndex(' \
  'useCeremonyTimeline(' \
  'tableSlotLayout(' \
  'seamProgressFromDelta(' \
  'REDUCED_MOTION_FLASH_MS' \
  'REDUCED_MOTION_SETTLE_MS' \
  'SWIPE_TRIGGER_DISTANCE' \
  'FAST_FORWARD_FROM_HOLD_FRACTION' \
  'FAST_FORWARD_TEAR_FACTOR' \
  'revealedUids:' \
  'tableReached:' \
  'CEREMONY_COPY_V10.leaveCeremony' \
  'CEREMONY_COPY_V10.speedUp' \
  'CEREMONY_COPY_V10.showResult' \
  'CEREMONY_COPY_V10.continueCta' \
  'CEREMONY_COPY_V10.skipProgress(' \
  'rareTitles[peakRarity]' \
  'STAGE_TESTID' \
  '<StageCanvas' \
  '<PackTear' \
  '<FallbackStage' \
  '<SpillSampler' \
  '<TapCard' \
  '<FeaturedCard' \
  'flashHiddenBehindCanvas' \
  'Reanimated.useAnimatedStyle(' \
  '<Reanimated.View' \
  'timeline.cameraScale.value' \
  'timeline.cameraRot.value' \
  'accessibilityLiveRegion="polite"' \
  'onPress={ctaPress}' \
  'testID="draw-ceremony-leave"' \
  'testID="draw-ceremony-fast-forward"' \
  'testID="draw-ceremony-reveal-flash"' \
  'draw-ceremony-cards-on-table' \
  'testID="draw-ceremony-footer-rarity"' \
  'testID="screen-draw-ceremony-primary-cta"' \
  'nativeID="draw-ceremony-skip-hint"' \
  'testID="draw-ceremony-stage"' \
  'testID="draw-ceremony-phase-copy"' \
  'testID="draw-ceremony-phase-body-copy"' \
  'testID="draw-ceremony-backdrop"' \
  'testID="screen-draw-ceremony-root"' \
  'draw-ceremony-hold-marker' \
  'onStartShouldSetResponder' \
  'onMoveShouldSetResponder' \
  'onResponderGrant' \
  'onResponderMove' \
  'onResponderRelease' \
  'onResponderTerminate' \
  'flashColor(peakRarity)' \
  "phase === 'flash-reveal' && !reduceMotion ? 0.85 : 0"; do
  grep -Fq -- "$s" "$scr" || fail "missing literal in $scr: $s (base tree fails here by design)"
done

# ── 6. Screen negative guards (FAILS ON BASE) ──────────────────────────────
echo "[6/10] DrawCeremonyScreen.tsx negative guards"
if grep -En "[Ll]ottie|HolographicLayer|SparkleField|ParticleBurst|MultiPackFlyIn|buildParticles|RevealCard|onAnimationFinish|orbitTimerRef|setInterval\(|hasAnimated|TIMING_SCALE|readRN\(|\bAnimated\b|A\.Value|rarityHaloColor|Skip ceremony|Swipe right to rip open|swipeTrack|flashCore|draw-ceremony-orbit-center|function phaseDurations\(|const SWIPE_TRIGGER_DISTANCE|const REDUCED_MOTION_|accessibilityElementsHidden|from '@shopify/react-native-skia'|from 'react-native-reanimated'|<Canvas|Skia\.Canvas" "$scr"; then
  fail "banned import/identifier still present in $scr (base tree fails here by design)"
fi
[ "$(grep -c 'Date.now()' "$scr" || true)" -le 2 ] || fail "$scr reads Date.now() more than twice (only the elapsed-in-phase reads for compress are allowed)"

# ── 7. Leaves ──────────────────────────────────────────────────────────────
echo "[7/10] SpillSampler / FallbackStage / FeaturedCard guards"
for s in 'export const SPILL_SAMPLE_MS = 100' 'setInterval(' 'React.memo(' \
  'testID="draw-ceremony-orbit-stage"' 'testID="draw-ceremony-orbit-progress"' 'testID="draw-ceremony-orbit-samples"' \
  'testID="draw-ceremony-orbit-focus"' 'testID="draw-ceremony-orbit-mode"' 'accessibilityLiveRegion="polite"' \
  'pointerEvents="none"' 'ceremonyStyles.spillSampler' 'CEREMONY_COPY_V10.dealing('; do
  grep -Fq -- "$s" "$sp" || fail "missing literal in $sp: $s"
done
if grep -n "orbitStage" "$sp"; then
  fail "$sp must use the invisible 1x1 spillSampler style, not the 248x260 orbitStage (see lines above)"
fi
for s in "export const FALLBACK_STAGE_TESTID = 'draw-ceremony-fallback-stage'" 'draw-ceremony-swipe-pack' 'draw-ceremony-multi-flyin' \
  'draw-ceremony-single-pack-flyin' 'draw-ceremony-spill-card-' 'draw-ceremony-hold-marker' 'PACK_A11Y_LABEL' 'PACK_A11Y_HINT' \
  'PACK_ACTIVATE_ACTION' 'onAccessibilityAction' 'spillSlotOffset(' 'tableSlotLayout(' '<FeaturedCard'; do
  grep -Fq -- "$s" "$fb" || fail "missing literal in $fb: $s"
done
if grep -En "reanimatedGuard|StageCanvas|TapCard|@shopify|react-native-reanimated|setInterval\(|setTimeout\(" "$fb"; then
  fail "FallbackStage.tsx must stay a plain-RN leaf (see lines above)"
fi
for s in 'export function FeaturedCard(' 'testID="draw-ceremony-reveal-rarity"' 'testID="draw-ceremony-reveal-question"' "rotateY: '180deg'" 'readRN('; do
  grep -Fq -- "$s" "$fc" || fail "missing literal in $fc: $s"
done
if grep -En "\bAnimated\b|reanimatedGuard|@shopify" "$fc"; then fail "FeaturedCard.tsx must be static (see lines above)"; fi
INTERVAL_FILES=$(grep -l "setInterval(" "$scr" mobile/src/components/ceremony/*.ts mobile/src/components/ceremony/*.tsx 2>/dev/null || true)
[ "$INTERVAL_FILES" = "$sp" ] || fail "setInterval( must appear only in $sp within the ceremony tree; found in: ${INTERVAL_FILES:-<none>}"

# ── 8. Styles ──────────────────────────────────────────────────────────────
echo "[8/10] ceremonyStyles.ts screen entries + shadowRadius"
for k in safeArea gradient backdrop content stage holdMarker phaseCopyHidden footerRarity footerRarityHidden skipButton skipText flash flashHiddenBehindCanvas ceremonySkipX ceremonySkipXText orbitStage flipCard flipCardRevealed flipFront flipBackGradient cardRarityChip cardRarity cardQuestion cardBackText swipePack swipePackInner stageCard stageCardBack stageCardTear leaveButton spillCard fallbackStage fallbackRim tapTableFrom spillSampler tapTable tapCardSlot tapCardShadow; do
  grep -Eq "^\s*${k}: " "$cs" || fail "style key missing in $cs: $k"
done
if grep -rnE "shadowRadius: *(1[6-9]|[2-9][0-9])" "$scr" mobile/src/components/ceremony; then
  fail "shadowRadius >= 16 in the ceremony tree (B00 §7.4)"
fi

# ── 9. Suppression + deps pin ──────────────────────────────────────────────
echo "[9/10] suppression + deps pin"
if grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$scr" "$tst" "$fb" "$sp" "$fc" "$cs"; then
  fail "test gutting / suppression found"
fi
# Driver Gate 1 mirror (case-insensitive; the gesture-handler host's library name trips it, B00 §9 #15)
if grep -Ein "humanizer|bypass|undetect|\bdetector|evade|Gemini said" "$scr" "$tst" "$fb" "$sp" "$fc" "$cs"; then
  fail "driver-banned term present in a B09 scope file (see lines above)"
fi
grep -q '"vite": "7.2.4"' mobile/package.json || fail 'mobile/package.json must keep "vite": "7.2.4"'
if grep -q "@sentry" mobile/package.json; then fail "@sentry must not be in mobile/package.json"; fi

# ── 10. Scope + frozen-file guard (purely negative; passes on base) ────────
echo "[10/10] scope + frozen guard"
mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve merge-base with $BASE_REF; refusing to diff the tree against itself"
git diff --quiet "$mb" HEAD -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/components/CeremonyLottie.tsx mobile/src/components/HolographicLayer.tsx \
  mobile/src/features/gacha/draw/ceremonyCopy.ts mobile/src/navigation/types.ts \
  || fail "frozen/out-of-scope file modified (frozen trio, CeremonyLottie.tsx, HolographicLayer.tsx, ceremonyCopy.ts or types.ts)"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; \
              git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
            | sort -u \
            | grep -Ev '^(mobile/src/screens/DrawCeremonyScreen\.tsx|mobile/tests/integration/draw-ceremony\.screen\.test\.tsx|mobile/src/components/ceremony/FallbackStage\.tsx|mobile/src/components/ceremony/SpillSampler\.tsx|mobile/src/components/ceremony/FeaturedCard\.tsx|mobile/src/components/ceremony/ceremonyStyles\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B09 scope"; }

echo "B09 VERIFY OK"

#!/usr/bin/env bash
# B10 — copy-result-preheat verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   ceremonyCopy.ts has no `export const CEREMONY_COPY_V10` (the first grep),
#   no CEREMONY_FLASH_REVEAL_SINGLE, no 'Pack open', only 2 'Pack inbound'
#   literals instead of 4, and still carries 'Rare inbound' / 'Legendary
#   inbound' / 'Card revealed' (ceremonyCopy.ts:72-76, :86-89).
# Were step 1 skipped, step 2 (types.ts has no tapFlow/revealedUids), step 3
# (DrawResultScreen.tsx has no readRN('Image' / chip testIDs), step 4
# (DrawScreen.tsx never calls prewarmCeremonyAudio), step 5 (the ceremony test
# still holds the old literals) and step 6 (the four new draw-result cases are
# absent) would each fail on base as well. Step 7 (tsc) and step 8
# (scope/frozen, purely negative) pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B10 VERIFY FAIL: $*" >&2; exit 1; }

f=mobile/src/features/gacha/draw/ceremonyCopy.ts
t=mobile/src/navigation/types.ts
r=mobile/src/screens/DrawResultScreen.tsx
d=mobile/src/screens/DrawScreen.tsx
rt=mobile/tests/integration/draw-result.screen.test.tsx
ct=mobile/tests/integration/draw-ceremony.screen.test.tsx
for x in "$f" "$t" "$r" "$d" "$rt" "$ct"; do [ -f "$x" ] || fail "scope file missing: $x"; done

# ── 1. ceremonyCopy.ts literal guards (FAILS ON BASE) ──────────────────────
echo "[1/8] ceremonyCopy.ts guards"
grep -q "export const CEREMONY_COPY_V10" "$f"                 || fail "CEREMONY_COPY_V10 missing (base tree fails here)"
grep -q "CEREMONY_FLASH_REVEAL_SINGLE" "$f"                   || fail "CEREMONY_FLASH_REVEAL_SINGLE missing"
# counts and the absence grep below are taken over code only (`//` comments stripped),
# so a worker's `// was 'Rare inbound'` note cannot skew them
f_code="$(sed -E 's#//.*$##' "$f")"
[ "$(printf '%s\n' "$f_code" | grep -c "title: 'Pack open'")" = 2 ] || fail "expected exactly 2 \"title: 'Pack open'\" (multi + single)"
[ "$(printf '%s\n' "$f_code" | grep -c "'Pack inbound'")" = 4 ]     || fail "expected exactly 4 'Pack inbound' (approach.title + COM/RAR/LEG rareTitles)"
grep -q "body: 'Your cards are sliding out.'" "$f"            || fail "multi flash-reveal body missing"
grep -q "body: 'Your card is sliding out.'" "$f"              || fail "single flash-reveal body missing"
grep -q "body: 'Your card is spinning into place.'" "$f"      || fail "CEREMONY_TEAR_FLIP_SINGLE body changed (test:455 depends on it)"
grep -q "body: 'Ten cards are spinning into place.'" "$f"     || fail "multi tear-flip body changed"
grep -q "title: 'Cards in place'" "$f"                        || fail "settle title changed"
grep -q "title: 'Hold steady'" "$f"                           || fail "hold title changed"
grep -q "title: 'Swipe to open'" "$f"                         || fail "swipe title changed"
for lit in "packA11yLabel: 'Reward pack'" "packA11yHint: 'Swipe right or double-tap to open'" \
           "activateAction: 'Open pack'" "leaveCeremony: 'Leave ceremony'" "speedUp: 'Speed up'" \
           "showResult: 'Show result'" "continueCta: 'Continue'" "unrevealedChip: 'Not flipped'" \
           "shareCta: 'Share this pull'" 'Skip · ${revealed}/${total}' 'Card ${n} of ${total}, face down' \
           'Card ${n} of ${total}, ${rarity} revealed' 'Dealing cards, ${percent} percent'; do
  grep -Fq "$lit" "$f" || fail "CEREMONY_COPY_V10 literal missing: $lit"
done
if printf '%s\n' "$f_code" | grep -Eq "Rare inbound|Legendary inbound|Card revealed|featured card is visible"; then
  printf '%s\n' "$f_code" | grep -En "Rare inbound|Legendary inbound|Card revealed|featured card is visible" >&2 || true
  fail "rarity-spoiling / stale copy still present in ceremonyCopy.ts (code lines)"
fi
# CEREMONY_COPY (the scanned block, :5-62) must not have grown the V10 strings.
awk '/^export const CEREMONY_COPY = \{/,/^\} as const;/' "$f" | grep -Eq "Not flipped|Skip ·|Share this pull|Leave ceremony" \
  && fail "V10 strings leaked into CEREMONY_COPY (jargon scan rejects '·')"

# ── 2. navigation/types.ts params (FAILS ON BASE) ──────────────────────────
echo "[2/8] navigation/types.ts guards"
grep -q "tapFlow?: boolean" "$t"                   || fail "DrawCeremony.tapFlow?: boolean missing (base tree fails here)"
grep -q "pityThreshold?: number" "$t"              || fail "DrawCeremony.pityThreshold?: number missing"
grep -q "pityCardIndex?: number | null" "$t"       || fail "DrawCeremony.pityCardIndex?: number | null missing"
grep -q "poolExhausted?: boolean" "$t"             || fail "DrawCeremony.poolExhausted?: boolean missing"
grep -q "revealedUids?: string\[\]" "$t"           || fail "DrawResult.revealedUids?: string[] missing"
grep -Eq "tableReached\??: boolean" "$t"           || fail "DrawResult.ceremonyEcho.tableReached missing"
grep -q "phaseCue: string" "$t"                    || fail "ceremonyEcho.phaseCue removed"

# ── 3. DrawResultScreen.tsx guards (FAILS ON BASE) ─────────────────────────
echo "[3/8] DrawResultScreen.tsx guards"
grep -q "readRN('Image'" "$r"                               || fail "DrawResult must read Image via readRN (base tree fails here)"
grep -q "revealedUids" "$r"                                 || fail "revealedUids never read"
grep -q 'draw-result-unrevealed-chip-' "$r"                 || fail "strip chip testID missing"
grep -q 'draw-result-featured-unrevealed-chip' "$r"         || fail "featured chip testID missing"
grep -q 'draw-result-featured-frame' "$r"                   || fail "featured frame testID missing"
grep -q 'draw-result-featured-glow' "$r"                    || fail "featured glow testID missing"
grep -q "cardFrameForRarity(" "$r"                          || fail "cardFrameForRarity not used"
grep -q "GLOW_9SLICE" "$r"                                  || fail "GLOW_9SLICE not used"
grep -q "CEREMONY_COPY_V10.unrevealedChip" "$r"             || fail "chip text must come from CEREMONY_COPY_V10.unrevealedChip"
grep -Eq "import \{[^}]*\bImage\b[^}]*\} from 'react-native'" "$r" && fail "Image imported by name from react-native (test mock has none)"
grep -q "CeremonyLottie" "$r" && fail "DrawResult must not import CeremonyLottie"
for id in screen-draw-result-root screen-draw-result-primary-cta draw-result-header draw-result-guarantee-badge \
          draw-result-collection-bar screen-draw-result-featured-card draw-result-summary-strip draw-result-open-all-cards \
          draw-result-all-cards-sheet draw-result-earn-pulls-link draw-result-done-link draw-result-confetti \
          screen-draw-result-detail-close; do
  grep -q "$id" "$r" || fail "existing DrawResult testID removed: $id"
done
grep -q 'screen-draw-result-grid-card-${index}' "$r"        || fail "grid card testID changed"
grep -q "snapPoints: \['92%'\]" "$r"                        || fail "sheet snapPoints changed"
# no motion changes
grep -q "registerOpacityRef" "$r" && grep -q "featuredEntryRef" "$r" || fail "DrawResult entry animations removed"

# ── 4. DrawScreen.tsx guards (FAILS ON BASE) ───────────────────────────────
echo "[4/8] DrawScreen.tsx guards"
grep -q "prewarmCeremonyAudio()" "$d"                       || fail "DrawScreen never calls prewarmCeremonyAudio() (base tree fails here)"
grep -q "prewarmFoilShader()" "$d"                          || fail "DrawScreen never calls prewarmFoilShader()"
grep -q "from '../components/ceremonyAudio'" "$d"           || fail "prewarmCeremonyAudio must be a static import from ../components/ceremonyAudio"
grep -q "components/ceremony/FoilLayer" "$d"                || fail "FoilLayer never referenced"
grep -q "poolExhausted: result.poolExhausted" "$d"          || fail "poolExhausted not forwarded"
grep -q "pityThreshold: ready.pityThreshold" "$d"           || fail "pityThreshold not forwarded"
grep -q "pityCardIndex: pityCardIndexFor(" "$d"             || fail "pityCardIndex not forwarded"
grep -q "function pityCardIndexFor(" "$d"                   || fail "pityCardIndexFor helper missing"
grep -q "pityThreshold: number;" "$d"                       || fail "DrawReady.pityThreshold missing"
grep -Eq "import \{[^}]*\bImage\b[^}]*\} from 'react-native'" "$d" && fail "Image imported by name from react-native in DrawScreen"
# draw-first / charge-second ordering untouched
L_COMMIT=$(grep -n "await commitDraw(ready.slug, drawCount)" "$d" | head -1 | cut -d: -f1)
L_CHARGE=$(grep -n "await consumePullsFromStoredWallet(" "$d" | head -1 | cut -d: -f1)
L_NAV=$(grep -n "navigation.navigate('DrawCeremony'" "$d" | head -1 | cut -d: -f1)
[ -n "$L_COMMIT" ] && [ -n "$L_CHARGE" ] && [ -n "$L_NAV" ] || fail "open() anchors moved"
[ "$L_COMMIT" -lt "$L_CHARGE" ] && [ "$L_CHARGE" -lt "$L_NAV" ] || fail "open() ordering changed (commit < charge < navigate)"

# ── 5. draw-ceremony test: exactly the ten literal substitutions ───────────
echo "[5/8] draw-ceremony.screen.test.tsx literal rule"
[ "$(wc -l < "$ct" | tr -d "[:space:]")" -eq 787 ] || fail "draw-ceremony.screen.test.tsx must stay 787 lines (B09 derives its prefix by line number)"
base_ct="$(git show "$BASE_REF:$ct" 2>/dev/null || git show "origin/$BASE_REF:$ct" 2>/dev/null)" \
  || fail "cannot read $ct from $BASE_REF"
if printf '%s\n' "$base_ct" | grep -q "Legendary inbound"; then
  printf '%s\n' "$base_ct" \
    | sed -e "s/'Legendary inbound'/'Pack inbound'/g" -e "s/'Rare inbound'/'Pack inbound'/g" -e "s/'Card revealed'/'Pack open'/g" \
    | cmp -s - "$ct" || fail "draw-ceremony.screen.test.tsx differs from base by more than the ten literal substitutions"
else
  # Base already carries the substitutions (a hand run after B09 merged): the file must simply be unchanged.
  printf '%s\n' "$base_ct" | cmp -s - "$ct" || fail "draw-ceremony.screen.test.tsx changed but base already carries the new literals"
fi
grep -Eq "Legendary inbound|Rare inbound|Card revealed" "$ct" && fail "old literals still in the ceremony test"
[ "$(grep -c "'Pack inbound'" "$ct")" -ge 5 ] || fail "expected >= 5 'Pack inbound' in the ceremony test"
[ "$(grep -c "'Pack open'" "$ct")" -ge 5 ]    || fail "expected >= 5 'Pack open' in the ceremony test"

# ── 6. targeted vitest (FAILS ON BASE: new cases absent) ───────────────────
echo "[6/8] vitest draw-result / draw-ceremony / draw / draw-wallet-atomicity / pity-visibility / ceremony-copy / packArt"
for s in \
  'marks cards missing from revealedUids with a Not flipped chip' \
  'shows no unrevealed chips when revealedUids is absent' \
  'shows no unrevealed chips when every card was flipped' \
  'marks a single unflipped pull on the featured card'; do
  grep -Fq "it('$s'" "$rt" || fail "missing draw-result test case: $s (base tree fails here)"
done
for s in \
  'renders collection bar, featured card, single primary CTA and done link' \
  'renders rarity strip in COM, RAR, LEG order' \
  'routes primary action to Draw when pulls remain' \
  'routes primary action to Library naming the cards just drawn when pulls are empty' \
  'keeps primary CTA non-routable until wallet pulls resolve' \
  'routes done link back to Home' \
  'routes the first Done into PermissionPrompt once when the onboarding flag is pending' \
  'opens and closes detail modal from grid card' \
  'keeps sheet testID with single snap point and handles empty draw state' \
  'opens all-cards sheet from explicit trigger and keeps 92% snap point metadata'; do
  grep -Fq "it('$s'" "$rt" || fail "existing draw-result case removed: $s"
done
grep -Fq "'keeps W-BASE, W-CTA, and W-MODAL contracts at %ipt width'" "$rt" || fail "width contract case removed"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$rt" "$ct" "$f" "$t" "$r" "$d" && fail "test gutting / suppression found"
# draw-wallet-atomicity.spec.tsx and pity-visibility.test.tsx import the two screens through
# their own react-native mocks (no Image/Platform either) — a named import that is missing
# from any of the four mocks throws at import time, so they run here, not only in the driver gate.
( cd mobile && npx vitest run \
    tests/integration/draw-result.screen.test.tsx \
    tests/integration/draw-ceremony.screen.test.tsx \
    tests/integration/draw.screen.test.tsx \
    tests/integration/draw-wallet-atomicity.spec.tsx \
    tests/integration/pity-visibility.test.tsx \
    tests/unit/ceremony-copy.test.ts \
    tests/unit/packArt.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 7. Typecheck ───────────────────────────────────────────────────────────
echo "[7/8] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 8. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[8/8] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/theme/packArt.ts mobile/src/features/gacha/components/drawResultStyles.ts mobile/src/screens/DrawCeremonyScreen.tsx \
  mobile/src/theme/colors.ts mobile/package.json mobile/package-lock.json mobile/tests/unit/ceremony-copy.test.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite pin changed"
grep -rq "@sentry" mobile/package.json mobile/src 2>/dev/null && fail "@sentry reference found"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/src/features/gacha/draw/ceremonyCopy\.ts|mobile/src/navigation/types\.ts|mobile/src/screens/DrawResultScreen\.tsx|mobile/src/screens/DrawScreen\.tsx|mobile/tests/integration/draw-result\.screen\.test\.tsx|mobile/tests/integration/draw-ceremony\.screen\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B10 scope"; }

echo "B10 VERIFY OK"

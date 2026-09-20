#!/usr/bin/env bash
# B11 — cleanup-lottie verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/src/components/CeremonyLottie.tsx still exists (the first `[ ! -e ]`
#   check), as do HolographicLayer.tsx, scripts/gen_lottie.py and assets/lottie/.
# Were step 1 skipped, step 2 (DrawCeremonyScreen.tsx imports CeremonyLottie /
# HolographicLayer; `lottie` occurs under mobile/src; package.json still lists
# lottie-react-native + expo-av before B01) and step 3 (5 shadowRadius >= 16
# sites inside the paths step 3 greps: DrawScreen.tsx:893 and :993,
# drawResultStyles.ts:138 and :559, RewardSummaryCard.tsx:108 — the seven in
# CeremonyLottie.tsx die with the file and live outside those paths; the
# ceremony directory does not exist on base, so its grep is silenced) would
# each fail on base as well; step 4 fails on base because
# ceremony/ceremonyStyles.ts and ceremony/FeaturedCard.tsx do not exist before
# B08/B09. Steps 5 (canvas count), 6 (diff shape), 7 (foilLayer.test.tsx shape
# is skipped when the file is absent; tsc + vitest) and 8 (scope/frozen,
# purely negative) pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B11 VERIFY FAIL: $*" >&2; exit 1; }

CS=mobile/src/components/ceremony/ceremonyStyles.ts
FC=mobile/src/components/ceremony/FeaturedCard.tsx
DCS=mobile/src/screens/DrawCeremonyScreen.tsx
DS=mobile/src/screens/DrawScreen.tsx
DRS=mobile/src/features/gacha/components/drawResultStyles.ts
RSC=mobile/src/features/gacha/components/RewardSummaryCard.tsx
CER=mobile/src/components/ceremony
FLT=mobile/tests/unit/foilLayer.test.tsx
BANNED_TERMS='humanizer|bypass|undetect|detector|evade|Gemini said'

# ── 1. Deletions (FAILS ON BASE) ───────────────────────────────────────────
echo "[1/8] deletions"
[ ! -e mobile/src/components/CeremonyLottie.tsx ]   || fail "mobile/src/components/CeremonyLottie.tsx still exists (base tree fails here)"
[ ! -e mobile/src/components/HolographicLayer.tsx ] || fail "mobile/src/components/HolographicLayer.tsx still exists"
[ ! -e mobile/scripts/gen_lottie.py ]                || fail "mobile/scripts/gen_lottie.py still exists"
[ ! -e mobile/assets/lottie ]                        || fail "mobile/assets/lottie/ still exists"
# no tombstones / relocations
for x in mobile/assets/animations mobile/src/components/LegacyCeremony.tsx mobile/src/components/ceremony/CeremonyLottie.tsx; do
  [ ! -e "$x" ] || fail "deleted content was recreated at $x"
done

# ── 2. No survivors (FAILS ON BASE) ────────────────────────────────────────
echo "[2/8] lottie / holographic survivors"
if grep -rin "lottie" mobile/src mobile/scripts >/dev/null 2>&1; then
  grep -rin "lottie" mobile/src mobile/scripts >&2 || true
  fail "'lottie' still occurs under mobile/src or mobile/scripts (base tree fails here)"
fi
if grep -rn "expo-av" mobile/src >/dev/null 2>&1; then
  grep -rn "expo-av" mobile/src >&2 || true
  fail "'expo-av' still referenced under mobile/src"
fi
SURVIVORS='CeremonyLottie|HolographicLayer|SparkleField|ParticleBurst|MultiPackFlyIn|buildParticles|ceremonyLottieAvailable|lottie-react-native|assets/lottie'
if grep -rnE "$SURVIVORS" mobile/src mobile/App.tsx mobile/tests >/dev/null 2>&1; then
  grep -rnE "$SURVIVORS" mobile/src mobile/App.tsx mobile/tests >&2 || true
  fail "a deleted module / identifier is still referenced"
fi
grep -Eq '"(lottie-react-native|expo-av)"' mobile/package.json && fail "package.json still lists lottie-react-native / expo-av (B01 owns that removal — report, do not fix)"
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite pin changed"
grep -rq "@sentry" mobile/package.json mobile/src 2>/dev/null && fail "@sentry reference found"

# ── 3. Shadow budget (FAILS ON BASE) ───────────────────────────────────────
echo "[3/8] shadowRadius budget"
if grep -rnE "shadowRadius: *(1[6-9]|[2-9][0-9])" mobile/src/screens/Draw*.tsx "$CER" mobile/src/features/gacha >/dev/null 2>&1; then
  grep -rnE "shadowRadius: *(1[6-9]|[2-9][0-9])" mobile/src/screens/Draw*.tsx "$CER" mobile/src/features/gacha >&2 || true
  fail "shadowRadius >= 16 still present in the gacha/ceremony tree (base tree fails here)"
fi
# ceremony tree: every `shadowRadius: N` (code only — `//` comments stripped) has N <= 8.
# No count limit: design :133's "<= 3 shadowed RN views" is a rendered-view count
# reviewed on device under B14's rubric, not a style-key count (B11 brief, Context).
tree_sites="$( { grep -rn "shadowRadius" "$DCS" "$CER" 2>/dev/null || true; } | sed -E 's#//.*$##' | grep -E "shadowRadius: *[0-9]" || true)"
while read -r v; do
  [ -z "$v" ] && continue
  awk -v v="$v" 'BEGIN { exit (v + 0 <= 8) ? 0 : 1 }' || { printf '%s\n' "$tree_sites" >&2; fail "ceremony tree shadowRadius $v > 8"; }
done < <(printf '%s\n' "$tree_sites" | grep -oE "shadowRadius: *[0-9]+(\.[0-9]+)?" | grep -oE "[0-9]+(\.[0-9]+)?$" || true)
# the five named blocks outside the ceremony tree are capped at exactly 8
awk '/^  stateCard: \{/,/^  \},/'  "$DS"  | grep -q "shadowRadius: 8" || fail "DrawScreen.stateCard not capped at shadowRadius: 8"
awk '/^  packShadow: \{/,/^  \},/' "$DS"  | grep -q "shadowRadius: 8" || fail "DrawScreen.packShadow not capped at shadowRadius: 8"
awk '/^  featured: \{/,/^  \},/'  "$DRS" | grep -q "shadowRadius: 8" || fail "drawResultStyles.featured not capped at shadowRadius: 8"
awk '/^  modalCard: \{/,/^  \},/' "$DRS" | grep -q "shadowRadius: 8" || fail "drawResultStyles.modalCard not capped at shadowRadius: 8"
awk '/^  card: \{/,/^  \},/'      "$RSC" | grep -q "shadowRadius: 8" || fail "RewardSummaryCard.card not capped at shadowRadius: 8"
awk '/^  card: \{/,/^  \},/'      "$RSC" | grep -q "elevation" && fail "RewardSummaryCard.card gained an elevation key"
# shadowOffset heights and elevations in those blocks stay <= 4
for spec in "$DS:stateCard" "$DS:packShadow" "$DRS:featured" "$DRS:modalCard" "$RSC:card"; do
  file="${spec%%:*}"; key="${spec##*:}"
  block="$(awk -v k="$key" '$0 ~ "^  "k": \\{" {s=1} s {print} s && /^  \},/ {exit}' "$file")"
  h="$(printf '%s' "$block" | grep -oE "height: *[0-9]+" | head -1 | grep -oE "[0-9]+" || true)"
  e="$(printf '%s' "$block" | grep -oE "elevation: *[0-9]+" | head -1 | grep -oE "[0-9]+" || true)"
  [ -z "$h" ] || [ "$h" -le 4 ] || fail "$file $key shadowOffset.height $h > 4"
  [ -z "$e" ] || [ "$e" -le 4 ] || fail "$file $key elevation $e > 4"
done

# ── 4. ceremonyStyles.ts trim + FeaturedCard.tsx trim (FAILS ON BASE) ──────
echo "[4/8] ceremonyStyles / FeaturedCard trim"
[ -f "$CS" ] || fail "$CS missing (base tree fails here: created by B08)"
[ -f "$FC" ] || fail "$FC missing (created by B09)"
grep -q "export const ceremonyStyles = StyleSheet.create({" "$CS" || fail "ceremonyStyles export shape changed"
consumers="$(grep -rlE "ceremonyStyles'" mobile/src | grep -v "^$CS$" || true)"
[ -n "$consumers" ] || fail "nothing under mobile/src imports ceremonyStyles"
keys="$(grep -oE "^  [A-Za-z0-9_]+: *\{" "$CS" | sed -E 's/^  ([A-Za-z0-9_]+): *\{/\1/')"
[ -n "$keys" ] || fail "no style keys found in $CS"
dead=""
while IFS= read -r k; do
  [ -z "$k" ] && continue
  grep -qE "\.${k}\b" $consumers || dead="$dead $k"
done <<< "$keys"
[ -z "$dead" ] || fail "ceremonyStyles keys referenced by no importer (trim them):$dead"
# every imported theme token is used at least once beyond its import line
for tok in colors spacing typography a11y; do
  if grep -qE "import \{[^}]*\b${tok}\b[^}]*\} from '\.\./\.\./theme/${tok}'" "$CS"; then
    [ "$(grep -c "\b${tok}\." "$CS")" -ge 1 ] || fail "ceremonyStyles imports '$tok' but never uses it"
  fi
done
grep -q "export function FeaturedCard(" "$FC"          || fail "FeaturedCard export missing"
grep -q 'draw-ceremony-reveal-rarity' "$FC"           || fail "FeaturedCard lost testID draw-ceremony-reveal-rarity"
grep -q 'draw-ceremony-reveal-question' "$FC"         || fail "FeaturedCard lost testID draw-ceremony-reveal-question"
grep -q "faceUp" "$FC"                                 || fail "FeaturedCard lost the faceUp prop"
# a member access (`Animated.View`, `A.Value` style leftovers), not the word at the end of a sentence in a comment
grep -Eq "\bAnimated\.[A-Za-z]|readRN\('Animated'" "$FC" && fail "FeaturedCard still carries RN Animated remnants"
grep -rnE "$BANNED_TERMS" "$CS" "$FC" >/dev/null 2>&1 && fail "banned term in ceremonyStyles.ts / FeaturedCard.tsx"

# ── 5. Canvas budget (passes on base: no ceremony dir, no Canvas in the screen)
# B00 §7.3: one Canvas each in StageCanvas.tsx (B05), PackTear.tsx (B06) and
# FoilLayer.tsx (B08, mounted only on the focused card) — three in total.
echo "[5/8] canvas count"
canvas_count="$( { grep -rhoE "<(Skia\.)?Canvas\b" "$CER" "$DCS" 2>/dev/null || true; } | grep -c . || true)"
[ "$canvas_count" -le 3 ] || fail "ceremony tree mounts $canvas_count Canvas elements (> 3: StageCanvas + PackTear + FoilLayer)"

# ── 6. Diff shape of the shadow-only / comment-only files (passes on base) ─
echo "[6/8] diff shape"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
shadow_only=("$DCS" "$DS" "$DRS" "$RSC")
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in "$CS"|"$FC") continue ;; esac
  shadow_only+=("$f")
done < <(git ls-files -- "$CER" ; git ls-files --others --exclude-standard -- "$CER")
for f in "${shadow_only[@]}"; do
  [ -f "$f" ] || continue
  added="$(git diff -U0 "$mb" -- "$f" | grep -E '^\+[^+]' | grep -vE '^\+[[:space:]]*$' | grep -vE '^\+[[:space:]]*(//|/\*|\*)' || true)"
  bad="$(printf '%s\n' "$added" | grep -vE 'shadow|elevation' | grep -v '^$' || true)"
  [ -z "$bad" ] || { printf '%s\n' "$bad" >&2; fail "$f: added lines that are not shadow/elevation keys or comments"; }
done
for f in mobile/src/components/ceremonyAudio.ts mobile/src/components/ceremonyHaptics.ts; do
  [ -f "$f" ] || continue
  added="$(git diff -U0 "$mb" -- "$f" | grep -E '^\+[^+]' | grep -vE '^\+[[:space:]]*$' | grep -vE '^\+[[:space:]]*(//|/\*|\*)' || true)"
  [ -z "$added" ] || { printf '%s\n' "$added" >&2; fail "$f: only comment lines may change in B11"; }
done
# added lines anywhere in the diff must not carry banned terms or suppressions
added_all="$(git diff -U0 "$mb" -- mobile/src mobile/scripts | grep -E '^\+[^+]' || true)"
printf '%s\n' "$added_all" | grep -qE "$BANNED_TERMS" && fail "banned term in an added line"
printf '%s\n' "$added_all" | grep -qE "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" && fail "suppression / test gutting in an added line"

# ── 7. foilLayer.test.tsx shape + typecheck + targeted vitest (passes on base) ─
echo "[7/8] foilLayer.test.tsx shape, tsc --noEmit + vitest"
if [ -f "$FLT" ]; then
  grep -q "HolographicLayer" "$FLT" && fail "$FLT still imports/tests the deleted HolographicLayer shim (delete that one case — B11 brief, Changes 1a)"
  [ "$(grep -cE '^\s*it\(' "$FLT" || true)" -ge 2 ] || fail "$FLT must keep its two non-shim cases"
  grep -Fq "it('renders null under vitest and never touches the Skia clock'" "$FLT" || fail "$FLT lost B08 case 1"
  grep -Fq "it('prewarmFoilShader is a no-op without Skia and never throws'" "$FLT" || fail "$FLT lost B08 case 2"
  flt_added="$(git diff -U0 "$mb" -- "$FLT" | grep -E '^\+[^+]' | grep -vE '^\+[[:space:]]*$' || true)"
  [ -z "$flt_added" ] || { printf '%s\n' "$flt_added" >&2; fail "$FLT: B11 may only delete lines in this test"; }
fi
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"
tests=(tests/integration/draw-ceremony.screen.test.tsx tests/integration/draw-result.screen.test.tsx
       tests/integration/draw.screen.test.tsx tests/integration/home.screen.test.tsx tests/unit/ceremony-copy.test.ts)
for u in tapCard foilLayer stageCanvas packTear useCeremonyTimeline; do
  for ext in ts tsx; do [ -f "mobile/tests/unit/$u.test.$ext" ] && tests+=("tests/unit/$u.test.$ext"); done
done
( cd mobile && npx vitest run "${tests[@]}" --reporter=dot ) || fail "targeted vitest failed"

# ── 8. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[8/8] scope + frozen guard"
# mobile/tests is frozen except the one deletion-only edit in tests/unit/foilLayer.test.tsx (checked in step 7)
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/screens/DrawResultScreen.tsx mobile/src/screens/HomeScreen.tsx mobile/src/theme mobile/package.json mobile/package-lock.json \
  mobile/app.json mobile/App.tsx mobile/tests ":(exclude)$FLT" mobile/docs mobile/vitest.config.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/src/components/CeremonyLottie\.tsx|mobile/src/components/HolographicLayer\.tsx|mobile/assets/lottie/(README\.md|pack-opening\.json|pack-opening\.lottie)|mobile/scripts/gen_lottie\.py|mobile/src/components/ceremony/[^/]+\.tsx?|mobile/src/screens/DrawCeremonyScreen\.tsx|mobile/src/screens/DrawScreen\.tsx|mobile/src/features/gacha/components/drawResultStyles\.ts|mobile/src/features/gacha/components/RewardSummaryCard\.tsx|mobile/src/components/ceremonyAudio\.ts|mobile/src/components/ceremonyHaptics\.ts|mobile/tests/unit/foilLayer\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B11 scope"; }

echo "B11 VERIFY OK"

#!/usr/bin/env bash
# D01 — mcq-types-normalize-mapper verify. cwd = worktree root. Re-runs the
# brief's five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/mcq/normalizeMcq.ts,
#     mobile/tests/unit/normalizeMcq.test.ts and
#     mobile/tests/unit/deckRepositoryMcq.test.ts do not exist on base
#   (step 1 then also checks the prerequisites D01 consumes: C07's signed Topic
#   line must be in deckRepository.ts exactly twice and `Topic?` on CardExport,
#   and Wave A's featureFlags.ts must carry the four mcq defaults)
# Step 2 (literal guards: Mcq? on CardExport, the two interfaces, the two signed
# mapper lines, the normalizeMcq.ts constants and signatures, the it('…')
# titles) would also fail on base. Steps 3/4 are the tsc / targeted-vitest
# gates and step 5 is the scope + frozen + OTA guard (numstat `2 0` on
# deckRepository.ts with the exact added line twice, `3 0` on
# deckRepositoryTopic.test.ts, zero diff on progressSync.ts / model.ts); both
# pass on base by design.
#
# Diffs are working tree vs merge-base (`git diff "$mb" -- …`), as every Wave
# B/C verify does, so an uncommitted edit counts too.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (D00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 1–2 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D01 VERIFY FAIL: $*" >&2; exit 1; }

EXPORT=mobile/src/types/deckExport.ts
REPO=mobile/src/content/deckRepository.ts
NORM=mobile/src/features/gacha/mcq/normalizeMcq.ts
FLAGS=mobile/src/config/featureFlags.ts
NT=mobile/tests/unit/normalizeMcq.test.ts
RT=mobile/tests/unit/deckRepositoryMcq.test.ts
TT=mobile/tests/unit/deckRepositoryTopic.test.ts

# The C07 signed line and the D01 signed line (D00 §0), byte for byte, 6-space indent.
TOPIC_LINE="      Topic: typeof (c as any).topic === 'string' ? (c as any).topic : null,"
MCQ_LINE="      Mcq: typeof (c as any).mcq === 'object' && (c as any).mcq !== null ? (c as any).mcq : null,"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C07 / Wave A prerequisites)"
for f in "$NORM" "$NT" "$RT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$EXPORT" "$REPO" "$FLAGS" "$TT"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ "$(grep -Fxc "$TOPIC_LINE" "$REPO" || true)" = "2" ] \
  || fail "deckRepository.ts must carry the C07 Topic line exactly twice — C07 must be on the base (D00 §0)"
grep -Fq 'Topic?: string | null;' "$EXPORT" || fail "deckExport.ts lacks 'Topic?: string | null;' (C07 incomplete)"
for sym in "enabled: true," "recallFirst: true," "maxPerRun: 2," "answerTelemetry: false,"; do
  grep -Fq "$sym" "$FLAGS" || fail "featureFlags.ts lacks the mcq default '$sym' (Wave A A01 incomplete)"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
# 2a. CardExport.Mcq? directly after Topic?, the two interfaces verbatim, the old lines intact
grep -Fq 'Mcq?: McqExport | null;' "$EXPORT" || fail "deckExport.ts lacks 'Mcq?: McqExport | null;'"
grep -A1 -F 'Topic?: string | null;' "$EXPORT" | grep -Fq 'Mcq?: McqExport | null;' \
  || fail "deckExport.ts: Mcq? must be the line directly after Topic?"
grep -Fq "export interface McqOption { key: string; text: string; why: string | null; correct: boolean }" "$EXPORT" \
  || fail "deckExport.ts lacks the McqOption interface line (D00 §2.1, verbatim)"
grep -Fq "export interface McqExport { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }" "$EXPORT" \
  || fail "deckExport.ts lacks the McqExport interface line (D00 §2.1, verbatim)"
for sym in "export interface DeckExport {" "export interface CardExport {" "OrderInDeck: number;" "Topic?: string | null;"; do
  grep -Fq "$sym" "$EXPORT" || fail "deckExport.ts lost: $sym"
done
# 2b. The frozen file: 1707 lines, both signed lines exactly twice, Mcq right after Topic, Topic right after
#     OrderInDeck, no normaliser call, no import added, no raw mcq key
[ "$(wc -l < "$REPO" | tr -d ' ')" = "1707" ] || fail "deckRepository.ts must be exactly 1707 lines (1705 + the two signed Mcq lines)"
[ "$(grep -Fxc "$MCQ_LINE" "$REPO" || true)" = "2" ] || fail "deckRepository.ts must contain the signed Mcq line exactly twice, byte for byte"
[ "$(grep -Fxc "$TOPIC_LINE" "$REPO" || true)" = "2" ] || fail "deckRepository.ts must still contain the C07 Topic line exactly twice"
[ "$(grep -n -A1 -F "$TOPIC_LINE" "$REPO" | grep -c -F 'Mcq: typeof (c as any).mcq' || true)" = "2" ] \
  || fail "deckRepository.ts: each Mcq line must directly follow the Topic line"
[ "$(grep -n -A1 -F 'OrderInDeck: order,' "$REPO" | grep -c -F 'Topic: typeof (c as any).topic' || true)" = "2" ] \
  || fail "deckRepository.ts: each Topic line must still directly follow 'OrderInDeck: order,'"
[ "$(grep -c "normalizeMcq" "$REPO" || true)" = "0" ] || fail "deckRepository.ts must not call or import normalizeMcq (D00 §6 #1: the mapper line is a pass-through)"
[ "$(grep -c "^import " "$REPO" || true)" = "8" ] || fail "deckRepository.ts import count changed (base has 8 at :2-12; the signed exception adds none)"
if grep -Eq "^\s+mcq\??:" "$REPO"; then
  grep -En "^\s+mcq\??:" "$REPO" >&2 || true
  fail "deckRepository.ts: the raw card types must NOT gain an mcq key (the cast is the signed line's point)"
fi
# 2c. normalizeMcq.ts — constants, signatures, exactly two type imports, pure
for sym in "export const MCQ_MIN_OPTIONS = 3;" \
           "export const MCQ_MAX_OPTIONS = 6;" \
           "export const MCQ_MAX_OPTION_TEXT = 600;" \
           "export const MCQ_MAX_REQUIRED = 3;" \
           "export const MCQ_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;" \
           "export const QUALIFIER_IS_CHOOSE_N = /choose (two|three)/i;" \
           "export function normalizeMcq(raw: unknown): McqExport | null" \
           "export function mcqRequiredCount(mcq: McqExport): number" \
           "export function resolveMcq(card: Pick<CardExport, 'Mcq'>, flags: Pick<FeatureFlags, 'mcq'>): McqExport | null" \
           "export function isMcqCard(card: Pick<CardExport, 'Mcq'>, flags: Pick<FeatureFlags, 'mcq'>): boolean" \
           "import type { CardExport, McqExport, McqOption } from '../../../types/deckExport';" \
           "import type { FeatureFlags } from '../../../config/featureFlags';"; do
  grep -Fq "$sym" "$NORM" || fail "normalizeMcq.ts lacks: $sym"
done
[ "$(grep -c "^import " "$NORM" || true)" = "2" ]      || fail "normalizeMcq.ts must have exactly two import lines (D00 §2.1)"
[ "$(grep -c "^import type " "$NORM" || true)" = "2" ] || fail "normalizeMcq.ts imports must both be 'import type'"
if grep -Eq "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|console\.|getFeatureFlags|^\s*throw |export default" "$NORM"; then
  grep -En "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|console\.|getFeatureFlags|^\s*throw |export default" "$NORM" >&2 || true
  fail "normalizeMcq.ts must stay pure (no react / require / storage / clock / randomness / console / throw / flag reads / default export)"
fi
# 2d. normalizeMcq.test.ts — property harness, the plan §4.3 fixture, the five titles
for sym in "from 'fast-check'" "fc.assert(" "Proxy(" "Object.isFrozen(" "Object.keys(" "DEFAULT_FEATURE_FLAGS" \
           "LEAST operational overhead" "from '../../src/features/gacha/mcq/normalizeMcq'" "from '../../src/config/featureFlags'"; do
  grep -Fq "$sym" "$NT" || fail "normalizeMcq.test.ts lacks: $sym"
done
for s in \
  'normalises the plan §4.3 cards and is idempotent' \
  'returns null for every single-rule violation' \
  'never throws on junk' \
  'defaults shuffle to true and honours false' \
  'isMcqCard is false under the kill switch and for a card without Mcq'; do
  grep -Fq "it('$s'" "$NT" || fail "missing normalizeMcq test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$NT" || true)" -ge 5 ] || fail "normalizeMcq.test.ts needs >= 5 it() blocks"
# 2e. deckRepositoryMcq.test.ts — install-capable harness, all three install paths, the five titles
for sym in "vi.mock('expo-file-system/legacy'" "vi.resetModules()" "resolveDeckBySlug" "installDeckFromChunkedPackage" \
           "installDeckFromUrl" "Object.keys(" "JSON.stringify(" "LEAST operational overhead" "'Mcq'," \
           "from '../../src/features/gacha/mcq/normalizeMcq'" "moveAsync"; do
  grep -Fq "$sym" "$RT" || fail "deckRepositoryMcq.test.ts lacks: $sym"
done
for s in \
  'passes a server mcq blob through both mappers untouched' \
  'maps absent and non-object mcq to null and keeps the card key order' \
  'lets a garbage blob survive install and normalise to null' \
  'keeps mcq through a chunked install' \
  'keeps mcq through a delta patch'; do
  grep -Fq "it('$s'" "$RT" || fail "missing deckRepositoryMcq test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$RT" || true)" -ge 5 ] || fail "deckRepositoryMcq.test.ts needs >= 5 it() blocks"
# 2f. deckRepositoryTopic.test.ts — the four C07 titles stay, the three fixture lines are present
for s in \
  'surfaces topic from a flat deck file as CardExport.Topic' \
  'surfaces topic from a v1 deck file as CardExport.Topic' \
  'maps a missing topic to null and keeps the card key order' \
  'maps a non-string topic to null'; do
  grep -Fq "it('$s'" "$TT" || fail "deckRepositoryTopic.test.ts lost the C07 case: $s"
done
[ "$(grep -Fc "'Mcq'," "$TT" || true)" = "2" ] || fail "deckRepositoryTopic.test.ts must list 'Mcq', in both Object.keys pins"
[ "$(grep -Fc "Mcq: null," "$TT" || true)" = "1" ] || fail "deckRepositoryTopic.test.ts must carry Mcq: null, in the toEqual object once"
# 2g. Suppression / test gutting: whole new files + the '+' lines of the edited files (C07.verify.sh:151 alternation)
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$NORM" "$NT" "$RT" \
  && fail "test gutting / suppression found in a new file"
plus="$(git diff -U0 "$mb" -- "$EXPORT" "$REPO" "$TT" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$plus" | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable"; then
  fail "test gutting / suppression found in an added line of an edited file"
fi
# 2h. card.Mcq readers: only the three files D00 §0 allows (D01 needs only normalizeMcq.ts)
readers="$(grep -rl '\.Mcq\b' mobile/src | grep -Ev '^(mobile/src/types/deckExport\.ts|mobile/src/content/deckRepository\.ts|mobile/src/features/gacha/mcq/normalizeMcq\.ts)$' || true)"
[ -z "$readers" ] || { echo "$readers" >&2; fail "card.Mcq is read outside the three allowed files (D00 §0)"; }
# 2i. Neighbouring suites are zero-diff against the base
git diff --quiet "$mb" -- \
  mobile/tests/unit/deckRepositoryTimeouts.test.ts \
  mobile/tests/unit/chunkedInstall.test.ts \
  mobile/tests/unit/deckContentV3.test.ts \
  mobile/tests/unit/featureFlags.test.ts \
  mobile/tests/unit/libraryTopics.test.ts \
  mobile/tests/unit/library.test.ts \
  mobile/tests/integration/session-card.screen.test.tsx \
  || fail "an existing neighbouring test file changed — D01 edits only deckRepositoryTopic.test.ts (D00 §3.1)"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the repository / install / flag suites they sit beside) ──
echo "[4/5] vitest normalizeMcq / deckRepositoryMcq / repository + install + flag suites"
( cd mobile && npx vitest run \
    tests/unit/normalizeMcq.test.ts \
    tests/unit/deckRepositoryMcq.test.ts \
    tests/unit/deckRepositoryTopic.test.ts \
    tests/unit/deckRepositoryTimeouts.test.ts \
    tests/unit/chunkedInstall.test.ts \
    tests/unit/deckContentV3.test.ts \
    tests/unit/featureFlags.test.ts \
    tests/unit/libraryTopics.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The signed exception: deckRepository.ts is +2 / -0 and the two + lines are the pinned Mcq line
numstat="$(git diff --numstat "$mb" -- "$REPO" | cut -f1,2)"
[ "$numstat" = "$(printf '2\t0')" ] || fail "deckRepository.ts numstat must be '2 0', got '${numstat:-<no diff>}'"
added="$(git diff -U0 "$mb" -- "$REPO" | grep '^+' | grep -v '^+++' || true)"
[ "$added" = "$(printf '+%s\n+%s' "$MCQ_LINE" "$MCQ_LINE")" ] \
  || { printf '%s\n' "$added" >&2; fail "deckRepository.ts: the only added lines must be the signed Mcq line, twice"; }
# 5b. The bounded test edit: deckRepositoryTopic.test.ts is +3 / -0 and the + lines are the three fixture lines
tns="$(git diff --numstat "$mb" -- "$TT" | cut -f1,2)"
[ "$tns" = "$(printf '3\t0')" ] || fail "deckRepositoryTopic.test.ts numstat must be '3 0', got '${tns:-<no diff>}'"
tadd="$(git diff -U0 "$mb" -- "$TT" | grep -E '^\+[^+]' | sed 's/^+//' | sed 's/^[[:space:]]*//')"
[ "$tadd" = "$(printf "%s\n%s\n%s" "'Mcq'," "Mcq: null," "'Mcq',")" ] \
  || { printf '%s\n' "$tadd" >&2; fail "deckRepositoryTopic.test.ts: the only added lines must be 'Mcq', / Mcq: null, / 'Mcq', in that order"; }
# 5c. The other frozen / do-not-touch files and the OTA manifest set
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/review/storage.ts \
  mobile/src/content/chunkedInstall.ts mobile/src/config/featureFlags.ts mobile/src/config/remoteConfig.ts \
  mobile/src/config/forceUpdateGate.ts mobile/src/sync/clientCapabilities.ts mobile/src/features/gacha/contracts.ts \
  mobile/src/features/gacha/library/topics.ts mobile/src/features/gacha/planner mobile/src/features/gacha/session \
  mobile/src/screens mobile/src/navigation/types.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
if grep -rq "from 'expo-updates'" mobile/src/features/gacha/mcq; then fail "expo-updates must never be statically imported (C00 §6 #17)"; fi
# 5d. Every changed or untracked path is one of the six scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/types/deckExport\.ts|mobile/src/content/deckRepository\.ts|mobile/src/features/gacha/mcq/normalizeMcq\.ts|mobile/tests/unit/normalizeMcq\.test\.ts|mobile/tests/unit/deckRepositoryMcq\.test\.ts|mobile/tests/unit/deckRepositoryTopic\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D01 scope"; }

echo "D01 VERIFY OK"

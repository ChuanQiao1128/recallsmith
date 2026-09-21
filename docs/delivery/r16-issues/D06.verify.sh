#!/usr/bin/env bash
# D06 — mcq-faces-console-warnings verify. cwd = worktree root. Re-runs the
# brief's five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - frontend/src/lib/mcqWarnings.ts,
#     mobile/tests/unit/drawCommitFaces.test.ts,
#     mobile/tests/integration/draw-result-kind.screen.test.tsx,
#     mobile/tests/integration/card-detail-kind.screen.test.tsx,
#     mobile/tests/unit/libraryMcqMark.test.tsx,
#     frontend/tests/mcqWarnings.test.ts and
#     frontend/tests/deckImportPageWarnings.test.tsx do not exist on base
#   (step 1 then also checks the D01/D02/D05 prerequisites: normalizeMcq.ts
#   with isMcqCard, mcqConstants.ts with faceMarkPick, the picks? param on
#   SessionSummary and session-summary-picks.screen.test.tsx must be on the
#   integration branch, because D00 §4 orders D01 → … → D05 → D06)
# Step 2 (literal guards: the VM fields, the three testIDs, the MCQ_COPY
# call sites, the warnings API, the it('…') titles) would also fail on base.
# Step 3 is the mobile tsc + frontend lint/build gate, step 4 the targeted
# vitest runs (both roots) plus an end-to-end run of lint-deck.mts on the two
# plan cards, and step 5 the scope + frozen + OTA guard; those pass on base by
# design and are never reached there.
#
# Diffs are taken against the merge-base on the WORKING TREE (C07/B03 form),
# so the guard sees the worker's edits whether or not they are committed.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (C00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 2–3 min
# (mobile tsc + frontend build dominate).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D06 VERIFY FAIL: $*" >&2; exit 1; }

# mobile scope
DC=mobile/src/features/gacha/draw/drawCommit.ts
NT=mobile/src/navigation/types.ts
DR=mobile/src/screens/DrawResultScreen.tsx
CD=mobile/src/screens/CardDetailScreen.tsx
LM=mobile/src/features/gacha/library/libraryMapper.ts
LC=mobile/src/features/gacha/library/LibraryCardTile.tsx
LS=mobile/src/screens/LibraryScreen.tsx
T_DC=mobile/tests/unit/drawCommitFaces.test.ts
T_DR=mobile/tests/integration/draw-result-kind.screen.test.tsx
T_CD=mobile/tests/integration/card-detail-kind.screen.test.tsx
T_LM=mobile/tests/unit/libraryMcqMark.test.tsx
T_LT=mobile/tests/unit/libraryTopics.test.ts
T_TILE=mobile/tests/unit/libraryCardTile.test.tsx
# console scope
MW=frontend/src/lib/mcqWarnings.ts
DI=frontend/src/lib/deckImport.ts
DP=frontend/src/pages/DeckImportPage.tsx
LD=frontend/scripts/lint-deck.mts
T_MW=frontend/tests/mcqWarnings.test.ts
T_DP=frontend/tests/deckImportPageWarnings.test.tsx
# prerequisites (D01 / D02 / D05)
NM=mobile/src/features/gacha/mcq/normalizeMcq.ts
MC=mobile/src/features/gacha/mcq/mcqConstants.ts
T_SP=mobile/tests/integration/session-summary-picks.screen.test.tsx
MR=frontend/src/lib/mcqRules.ts
PLAN=docs/mcq-card-type-plan-2026-09-18.md

MOBILE_SRC=("$DC" "$NT" "$DR" "$CD" "$LM" "$LC" "$LS")
MOBILE_NEW=("$T_DC" "$T_DR" "$T_CD" "$T_LM")
FRONT_SRC=("$MW" "$DI" "$DP" "$LD")
FRONT_NEW=("$MW" "$T_MW" "$T_DP")

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ D01/D02/D05 prerequisites)"
for f in "$MW" "$T_DC" "$T_DR" "$T_CD" "$T_LM" "$T_MW" "$T_DP"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "${MOBILE_SRC[@]}" "$T_LT" "$T_TILE" "$DI" "$DP" "$LD" "$MR" "$PLAN"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$NM" ] || fail "$NM is missing — D01 must be merged before D06 (D00 §4)"
[ -f "$MC" ] || fail "$MC is missing — D02 must be merged before D06 (D00 §4)"
[ -f "$T_SP" ] || fail "$T_SP is missing — D05 must be merged before D06 (D00 §4)"
grep -Fq "export function isMcqCard" "$NM"        || fail "normalizeMcq.ts lacks isMcqCard (D01 incomplete)"
grep -Fq "export function resolveMcq" "$NM"       || fail "normalizeMcq.ts lacks resolveMcq (D01 incomplete)"
grep -Fq "export function mcqRequiredCount" "$NM" || fail "normalizeMcq.ts lacks mcqRequiredCount (D01 incomplete)"
grep -Fq "faceMarkPick" "$MC"                     || fail "mcqConstants.ts lacks MCQ_COPY.faceMarkPick (D02 incomplete)"
grep -Fq "detailChipPick" "$MC"                   || fail "mcqConstants.ts lacks MCQ_COPY.detailChipPick (D02 incomplete)"
grep -Fq "picks?: { landed: number; answered: number };" "$NT" || fail "navigation/types.ts lacks SessionSummary.picks? (D05 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# 2a. drawCommit.ts — the three VM fields, one flag read, the conditional spreads, no raw .Mcq
for sym in "tag?: string;" "kind?: 'mcq';" "requiredCount?: number;" \
           "import { getFeatureFlags } from '../../../config/featureFlags';" \
           "import { mcqRequiredCount, resolveMcq } from '../mcq/normalizeMcq';" \
           "import { normalizeTopic } from '../library/topics';" \
           "const flags = getFeatureFlags();" \
           "resolveMcq(card, flags)" "mcqRequiredCount(mcq)" "normalizeTopic(card.Topic)" \
           "...(tag !== null ? { tag } : {})," "kind: 'mcq' as const" \
           "rank: ranks.get(card.StableUid) ?? 0,"; do
  grep -Fq "$sym" "$DC" || fail "drawCommit.ts lacks: $sym"
done
grep -Eq '\.Mcq([^A-Za-z0-9_]|$)' "$DC" && fail "drawCommit.ts spells .Mcq — read it through resolveMcq(card, flags) only"
# 2b. navigation/types.ts — both draw card shapes gain the two optional fields; tag? untouched
[ "$(grep -Fc "kind?: 'mcq';" "$NT" || true)" = "2" ]         || fail "types.ts must declare kind?: 'mcq'; exactly twice (DrawCeremony + DrawResult cards)"
[ "$(grep -Fc "requiredCount?: number;" "$NT" || true)" = "2" ] || fail "types.ts must declare requiredCount?: number; exactly twice"
[ "$(grep -Fc "tag?: string;" "$NT" || true)" = "2" ]           || fail "types.ts: tag?: string; must stay exactly twice"
grep -Fq "picks?: { landed: number; answered: number };" "$NT"  || fail "types.ts lost D05's picks? param"
# 2c. DrawResultScreen.tsx — the featured mark inside the art window; everything else intact
for sym in 'testID="draw-result-featured-kind"' "function cardKindText(" "MCQ_COPY.faceMarkPick(" "MCQ_COPY.faceMark" \
           "featuredKindChip" "from '../features/gacha/mcq/mcqConstants'" "const featuredKind = " \
           'testID="draw-result-featured-topic"' 'testID="draw-result-featured-art-window"' \
           "numberOfLines={FEATURED_STEM_LINES}" "export const FEATURED_STEM_LINES = 6;" \
           'testID="draw-result-featured-serial"' "styles.gridTag"; do
  grep -Fq "$sym" "$DR" || fail "DrawResultScreen.tsx lacks: $sym"
done
grep -Eq '\.Mcq([^A-Za-z0-9_]|$)' "$DR" && fail "DrawResultScreen.tsx spells .Mcq"
# 2d. CardDetailScreen.tsx — the hero chip, gated on !isLocked and the flag; no answer text anywhere
for sym in 'testID="card-detail-kind-chip"' "resolveMcq(card, getFeatureFlags())" "MCQ_COPY.detailChipPick(" "MCQ_COPY.detailChip" \
           "heroKindChip" "heroKindChipText" "!isLocked" \
           "import { getFeatureFlags } from '../config/featureFlags';" \
           "import { mcqRequiredCount, resolveMcq } from '../features/gacha/mcq/normalizeMcq';" \
           "import { MCQ_COPY } from '../features/gacha/mcq/mcqConstants';" \
           "const tag = (card as any)?.Tag ?? deck?.Title ?? '';"; do
  grep -Fq "$sym" "$CD" || fail "CardDetailScreen.tsx lacks: $sym"
done
if grep -Eq 'Explanation|RealWorldUsage|\.options|\.Mcq([^A-Za-z0-9_]|$)|McqReviewBody' "$CD"; then
  grep -En 'Explanation|RealWorldUsage|\.options|\.Mcq([^A-Za-z0-9_]|$)|McqReviewBody' "$CD" >&2 || true
  fail "CardDetailScreen.tsx must render no answer / option text (plan §6.8)"
fi
# 2e. libraryMapper.ts — isMcq appended, mcqEnabled on both builders, the single .Mcq read, old rows intact
for sym in "isMcq: boolean;" "import { normalizeMcq } from '../mcq/normalizeMcq';" \
           "isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null," \
           "const rows = buildLibraryCardRows({ deck, progress, now, isTrial, previewTotal, ownedSet, mcqEnabled });" \
           "topic: normalizeTopic(card.Topic)," "rank: ranks.get(card.StableUid) ?? 0," \
           "export type LibraryFilter = 'all' | 'new' | 'learning' | 'mastered' | 'rare' | 'legendary';" \
           "{ key: 'all', label: 'All', count: rows.length }," \
           "{ key: 'new', label: 'New', count: newCount }," \
           "{ key: 'learning', label: 'Learning', count: learningCount }," \
           "{ key: 'mastered', label: 'Mastered', count: masteredCount }," \
           "{ key: 'rare', label: 'Rare', count: rareCount }," \
           "{ key: 'legendary', label: 'Legendary', count: legendaryCount },"; do
  grep -Fq "$sym" "$LM" || fail "libraryMapper.ts lacks: $sym"
done
[ "$(grep -Fc "mcqEnabled?: boolean;" "$LM" || true)" = "2" ] || fail "libraryMapper.ts: mcqEnabled?: boolean; must appear exactly twice (buildLibraryCardRows + buildLibraryVM)"
[ "$(grep -Ec '\.Mcq([^A-Za-z0-9_]|$)' "$LM" || true)" = "1" ] || fail "libraryMapper.ts must read .Mcq exactly once, as normalizeMcq(card.Mcq)"
# 2f. LibraryCardTile.tsx — the MC mark next to the icon; question clamp and status probe intact; no StyleSheet
for sym in 'testID={`library-card-kind-${item.stableUid}`}' "item.isMcq" "MCQ_COPY.faceMark" "KIND_MARK_STYLE" \
           "import { MCQ_COPY } from '../mcq/mcqConstants';" \
           "numberOfLines={2}" 'testID={`library-card-status-${item.stableUid}`}'; do
  grep -Fq "$sym" "$LC" || fail "LibraryCardTile.tsx lacks: $sym"
done
grep -q "StyleSheet" "$LC" && fail "LibraryCardTile.tsx must not import StyleSheet (its react-native import line stays byte-identical; use the plain KIND_MARK_STYLE object)"
# 2g. LibraryScreen.tsx — one param line + the import; the C07 wiring intact
for sym in "mcqEnabled: getFeatureFlags().mcq.enabled," "import { getFeatureFlags } from '../config/featureFlags';" \
           "topicFilter," "keyExtractor={(item) => item.stableUid}" "topics={vm.topics}"; do
  grep -Fq "$sym" "$LS" || fail "LibraryScreen.tsx lacks: $sym"
done
# 2h. mcqWarnings.ts — the pinned API, pure
for sym in "'MCQ_WARN_CORRECT_LONGEST'" "'MCQ_WARN_WHY_SHORT'" "'MCQ_WARN_STEM_LONG'" "'MCQ_WARN_FIRST_SENTENCE_LONG'" \
           "'MCQ_WARN_SHAPE'" "'MCQ_WARN_NO_USAGE'" \
           "export interface ImportWarning { code: McqWarningCode; severity: 'warning'; line: number; message: string; stableUid: string }" \
           "export function warnMcq(" "export function formatWarning(" "export function sortWarnings(" \
           "export function firstSentence(" "export function wordCount(" \
           "export const MCQ_WARN_LONGEST_RATIO = 1.4;" "export const MCQ_WARN_WHY_MIN_CHARS = 40;" \
           "export const MCQ_WARN_STEM_MAX_WORDS = 120;" "export const MCQ_WARN_FIRST_SENTENCE_MAX_CHARS = 140;" \
           "import type { McqBlob } from '../types/mcq';"; do
  grep -Fq "$sym" "$MW" || fail "mcqWarnings.ts lacks: $sym"
done
if grep -En "^import" "$MW" | grep -Ev "from '\.\./types/mcq'"; then
  fail "mcqWarnings.ts may import only type { McqBlob } from '../types/mcq' (cardRulesWiring pins cardRules' consumers)"
fi
grep -Eq "from 'react|require\(|from './cardRules'|from './deckImport'|: any\b|as any\b" "$MW" && fail "mcqWarnings.ts must stay pure and any-free"
# 2i. deckImport.ts — warnings tier wired, formatIssue widened, old comment gone, McqIssueCode untouched
for sym in "warnings: ImportWarning[];" "import { warnMcq, sortWarnings, type ImportWarning } from './mcqWarnings';" \
           "warnMcq({" "severity: 'warning'" "warnings: sortWarnings(warnings) };" \
           "export function formatIssue(issue: Pick<ImportIssue, 'line' | 'message'>): string" \
           "errors.push(...validateCards(cards));"; do
  grep -Fq "$sym" "$DI" || fail "deckImport.ts lacks: $sym"
done
grep -Fq "There is no warning tier in Wave C" "$DI" && fail "deckImport.ts: rewrite the :704-706 comment to point at mcqWarnings.ts"
grep -q "MCQ_WARN" "$MR" && fail "mcqRules.ts must not know the warning codes (deckImport.mcq.test.ts:522 pins McqIssueCode)"
grep -q "MCQ_WARN" "$DI" && fail "deckImport.ts must not spell a warning code — codes live in mcqWarnings.ts only"
# 2j. DeckImportPage.tsx — amber panel below the errors, outside the strip; strip and gate byte-identical
for sym in 'data-testid="import-warnings"' "formatWarning(" "function groupWarnings(" "groupWarnings(preview.parsed.warnings)" \
           "not blocking" "from '../lib/mcqWarnings'" \
           "if (preview.parsed.errors.length > 0) return true;" "in the document" \
           '<Badge label="create" count={preview.plan.creates.length} tone={ACTION_CLASSES.create} />' \
           '<Badge label="update" count={preview.plan.updates.length} tone={ACTION_CLASSES.update} />' \
           '<Badge label="unchanged" count={preview.plan.unchanged.length} tone={ACTION_CLASSES.unchanged} />' \
           '<Badge label="conflict" count={preview.plan.conflicts.length} tone={ACTION_CLASSES.conflict} />' \
           '<Badge label="parse errors" count={preview.parsed.errors.length} tone={ACTION_CLASSES.conflict} />'; do
  grep -Fq "$sym" "$DP" || fail "DeckImportPage.tsx lacks: $sym"
done
[ "$(grep -Fc "<Badge " "$DP" || true)" = "8" ] || fail "DeckImportPage.tsx: <Badge count must stay 8 (five in the preview strip, three in the result step) — no sixth badge"
# 2k. lint-deck.mts — WARN lines, the four-field summary, --strict
for sym in 'WARN ${' "--strict" 'issues, ${result.warnings.length} warnings' "warnings: ImportWarning[];" \
           "import type { ImportWarning } from '../src/lib/mcqWarnings.ts';"; do
  grep -Fq "$sym" "$LD" || fail "lint-deck.mts lacks: $sym"
done
# 2l. tests — titles, harness probes, counts
for s in \
  'tags drawn cards with topic and kind' \
  'drops the kind under the kill switch and keeps the tag'; do
  grep -Fq "it('$s'" "$T_DC" || fail "missing drawCommitFaces test case: $s"
done
for s in \
  'marks the featured MCQ card and leaves Q/A cards alone' \
  'shows a plain MC mark for a single-answer card and nothing for Q/A'; do
  grep -Fq "it('$s'" "$T_DR" || fail "missing draw-result-kind test case: $s"
done
for s in \
  'shows the multiple-choice chip and never the options' \
  'hides the chip on Q/A, locked and kill-switched cards'; do
  grep -Fq "it('$s'" "$T_CD" || fail "missing card-detail-kind test case: $s"
done
for s in \
  'marks MCQ tiles and clears the mark under the kill switch' \
  'keeps the mark off a missing tile'; do
  grep -Fq "it('$s'" "$T_LM" || fail "missing libraryMcqMark test case: $s"
done
for s in \
  'fires each warning code once from a minimal positive case' \
  'sits exactly on each threshold' \
  'stays silent on a well-shaped card' \
  'flags every shape outside 1 of 4, 2 of 5 and 3 of 6' \
  'never throws on a card the blocking rules would refuse' \
  'reports exactly the longest-correct suggestion on the plan card'; do
  grep -Fq "it('$s'" "$T_MW" || fail "missing mcqWarnings test case: $s"
done
for s in \
  'lists suggestions below the errors without blocking the run' \
  'renders no panel for a document without suggestions' \
  'keeps the problem count and the gate untouched beside suggestions'; do
  grep -Fq "it('$s'" "$T_DP" || fail "missing deckImportPageWarnings test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$T_DC" || true)" -ge 2 ] || fail "drawCommitFaces.test.ts needs >= 2 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_DR" || true)" -ge 2 ] || fail "draw-result-kind.screen.test.tsx needs >= 2 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_CD" || true)" -ge 2 ] || fail "card-detail-kind.screen.test.tsx needs >= 2 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_LM" || true)" -ge 2 ] || fail "libraryMcqMark.test.tsx needs >= 2 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_MW" || true)" -ge 6 ] || fail "mcqWarnings.test.ts needs >= 6 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_DP" || true)" -ge 3 ] || fail "deckImportPageWarnings.test.tsx needs >= 3 it() blocks"
grep -Fq "vi.mock('../../src/content/deckRepository'" "$T_DC" || fail "drawCommitFaces.test.ts must mock deckRepository (harness of drawAtomicity.test.ts)"
grep -Fq "applyRemoteFeatures(" "$T_DC"                       || fail "drawCommitFaces.test.ts must flip the kill switch through applyRemoteFeatures"
grep -Fq "Object.keys(" "$T_DC"                               || fail "drawCommitFaces.test.ts must pin the VM key order"
grep -Fq "draw-result-featured-art-window" "$T_DR"            || fail "draw-result-kind test must locate the art window (the mark's parent)"
grep -Fq "draw-result-featured-kind" "$T_DR"                  || fail "draw-result-kind test must probe draw-result-featured-kind"
grep -Fq "vi.mock('../../src/content/deckRepository'" "$T_CD" || fail "card-detail-kind test must mock deckRepository"
grep -Fq "vi.mock('../../src/content/activeDeck'" "$T_CD"     || fail "card-detail-kind test must mock activeDeck"
grep -Fq "vi.mock('../../src/features/gacha/draw/effectiveOwned'" "$T_CD" || fail "card-detail-kind test must control the owned set (locked case)"
grep -Fq "applyRemoteFeatures(" "$T_CD"                       || fail "card-detail-kind test must cover the kill switch"
grep -Fq "card-detail-kind-chip" "$T_CD"                      || fail "card-detail-kind test must probe card-detail-kind-chip"
grep -Fq "library-card-kind-" "$T_LM"                         || fail "libraryMcqMark test must probe library-card-kind-<uid>"
grep -Fq "mcqEnabled: false" "$T_LM"                          || fail "libraryMcqMark test must cover mcqEnabled: false"
grep -Fq "from 'fast-check'" "$T_MW" || fail "mcqWarnings.test.ts must use fast-check"
grep -Fq "fc.assert(" "$T_MW"        || fail "mcqWarnings.test.ts has no fc.assert property"
grep -Fq "parseDeckMarkdown(" "$T_MW" || fail "mcqWarnings.test.ts must pin the plan card through parseDeckMarkdown"
grep -Fq "aws-sqs-order-buffer-mcq-01" "$T_MW" || fail "mcqWarnings.test.ts must use plan §4.3 card 1 (the only quotable MCQ text)"
grep -Fq "@vitest-environment jsdom" "$T_DP" || fail "deckImportPageWarnings.test.tsx must opt into jsdom"
grep -Fq "import-warnings" "$T_DP"           || fail "deckImportPageWarnings.test.tsx must probe import-warnings"
grep -Fq "not blocking" "$T_DP"              || fail "deckImportPageWarnings.test.tsx must pin the heading copy"
grep -Fq "parse errors" "$T_DP"              || fail "deckImportPageWarnings.test.tsx must re-read the five-badge strip"
# 2m. suppression / gutting: whole new files + the added lines of every edited scope file
grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${MOBILE_NEW[@]}" "${FRONT_NEW[@]}" \
  && fail "test gutting / suppression found in a new file"
added_all="$(git diff -U0 "$mb" -- "${MOBILE_SRC[@]}" "$T_LT" "$T_TILE" "$DI" "$DP" "$LD" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added_all" | grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable'; then
  printf '%s\n' "$added_all" | grep -En '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' >&2 || true
  fail "test gutting / suppression found in an added line"
fi
# 2n. no CJK in the frontend/src scope files (tests/uiLanguage.test.ts walks src/)
if perl -CSD -ne 'exit 1 if /[\x{3000}-\x{30ff}\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{ff00}-\x{ffef}]/' "$MW" "$DI" "$DP"; then :; else
  fail "a CJK character in a frontend/src scope file (tests/uiLanguage.test.ts would fail)"
fi
# 2o. Existing suites this issue sits beside are zero-diff against the base
git diff --quiet "$mb" -- \
  mobile/tests/integration/draw-result.screen.test.tsx \
  mobile/tests/integration/draw.screen.test.tsx \
  mobile/tests/integration/library.screen.test.tsx \
  mobile/tests/integration/library-final.screen.test.tsx \
  mobile/tests/integration/library-360-columns.spec.tsx \
  mobile/tests/integration/owned-gate-entry-points.spec.tsx \
  mobile/tests/integration/plan-library-deep-polish.screen.test.tsx \
  mobile/tests/integration/phase-b-deeper.screen.test.tsx \
  mobile/tests/integration/session-summary-picks.screen.test.tsx \
  mobile/tests/integration/session-card-mcq.screen.test.tsx \
  mobile/tests/unit/drawAtomicity.test.ts \
  mobile/tests/unit/draw.test.ts \
  mobile/tests/unit/library.test.ts \
  mobile/tests/unit/ownedGatePredicates.test.ts \
  mobile/tests/unit/cardRank.test.ts \
  mobile/tests/unit/featureFlags.test.ts \
  frontend/tests/deckImport.test.ts \
  frontend/tests/deckImport.mcq.test.ts \
  frontend/tests/deckImport.topic.test.ts \
  frontend/tests/deckImportPageRun.test.tsx \
  frontend/tests/deckImportPageSource.test.tsx \
  frontend/tests/deckImportRunner.test.ts \
  frontend/tests/cardMcqConsole.test.tsx \
  frontend/tests/cardRulesWiring.test.ts \
  frontend/tests/uiLanguage.test.ts \
  frontend/tests/docsPaths.test.ts \
  || fail "an existing test file changed — D06 edits only libraryTopics.test.ts (2 2) and libraryCardTile.test.tsx (1 0)"

# ── 3. Typecheck (mobile) + lint/build (frontend) ──────────────────────────
echo "[3/5] mobile tsc --noEmit; frontend lint + build"
( cd mobile && npm run test:typecheck ) || fail "mobile typecheck failed"
( cd frontend && npm run lint )         || fail "frontend eslint failed"
( cd frontend && npm run build )        || fail "frontend tsc -b && vite build failed"

# ── 4. Targeted vitest (both roots) + lint-deck end to end ─────────────────
echo "[4/5] vitest: D06 suites + the draw / library / import suites they sit beside; lint-deck on the plan cards"
( cd mobile && npx vitest run \
    tests/unit/drawCommitFaces.test.ts \
    tests/integration/draw-result-kind.screen.test.tsx \
    tests/integration/card-detail-kind.screen.test.tsx \
    tests/unit/libraryMcqMark.test.tsx \
    tests/unit/libraryTopics.test.ts \
    tests/unit/libraryCardTile.test.tsx \
    tests/integration/draw-result.screen.test.tsx \
    tests/unit/drawAtomicity.test.ts \
    tests/unit/draw.test.ts \
    tests/unit/library.test.ts \
    tests/unit/ownedGatePredicates.test.ts \
    tests/unit/cardRank.test.ts \
    tests/integration/library.screen.test.tsx \
    tests/integration/library-final.screen.test.tsx \
    tests/integration/library-360-columns.spec.tsx \
    tests/integration/owned-gate-entry-points.spec.tsx \
    tests/integration/plan-library-deep-polish.screen.test.tsx \
    tests/integration/draw.screen.test.tsx \
    --reporter=dot ) || fail "mobile targeted vitest failed"
( cd frontend && npx vitest run \
    tests/mcqWarnings.test.ts \
    tests/deckImportPageWarnings.test.tsx \
    tests/deckImport.test.ts \
    tests/deckImport.mcq.test.ts \
    tests/deckImport.topic.test.ts \
    tests/deckImportPageRun.test.tsx \
    tests/deckImportPageSource.test.tsx \
    tests/deckImportRunner.test.ts \
    tests/cardMcqConsole.test.tsx \
    tests/cardRulesWiring.test.ts \
    tests/uiLanguage.test.ts \
    --reporter=dot ) || fail "frontend targeted vitest failed"
# lint-deck.mts on the two plan cards (docs/mcq-card-type-plan-2026-09-18.md:177-253, preceded by the
# blank :176, under a two-line deck header): card 1 header (:177) lands on line 4, card 2 (:218) on
# line 45; measured 2026-09-22 with the console parser: warnings = 1 + 3, issues = 0.
plan_tmp="$(mktemp -t d06plan.XXXXXX)"
trap 'rm -f "$plan_tmp"' EXIT
{ echo '# deck: aws-associate-architect'; echo; sed -n '176,253p' "$PLAN"; } > "$plan_tmp"
lint_out="$(node "$LD" "$plan_tmp")" || { printf '%s\n' "$lint_out" >&2; fail "lint-deck.mts exited non-zero on the plan cards (warnings must not fail the run)"; }
printf '%s\n' "$lint_out" | grep -Fq "4: WARN MCQ_WARN_CORRECT_LONGEST "      || { printf '%s\n' "$lint_out" >&2; fail "lint-deck: card 1 must warn MCQ_WARN_CORRECT_LONGEST on line 4"; }
printf '%s\n' "$lint_out" | grep -Fq "45: WARN MCQ_WARN_CORRECT_LONGEST "     || { printf '%s\n' "$lint_out" >&2; fail "lint-deck: card 2 must warn MCQ_WARN_CORRECT_LONGEST on line 45"; }
printf '%s\n' "$lint_out" | grep -Fq "45: WARN MCQ_WARN_FIRST_SENTENCE_LONG " || { printf '%s\n' "$lint_out" >&2; fail "lint-deck: card 2 must warn MCQ_WARN_FIRST_SENTENCE_LONG on line 45"; }
printf '%s\n' "$lint_out" | grep -Fq "45: WARN MCQ_WARN_NO_USAGE "            || { printf '%s\n' "$lint_out" >&2; fail "lint-deck: card 2 must warn MCQ_WARN_NO_USAGE on line 45"; }
printf '%s\n' "$lint_out" | grep -Fxq "2 cards, 2 mcq, 0 issues, 4 warnings"  || { printf '%s\n' "$lint_out" >&2; fail "lint-deck: summary must read '2 cards, 2 mcq, 0 issues, 4 warnings'"; }
if node "$LD" --strict "$plan_tmp" >/dev/null 2>&1; then fail "lint-deck.mts --strict must exit non-zero when a warning is present"; fi

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The three frozen files and the do-not-touch set are zero-diff (no signed exception in D06)
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts \
  mobile/src/features/gacha/planner mobile/src/features/gacha/session mobile/src/features/gacha/rewards \
  mobile/src/features/gacha/components mobile/src/features/gacha/mcq \
  mobile/src/features/gacha/draw/poolSelection.ts mobile/src/features/gacha/draw/cardRarity.ts \
  mobile/src/features/gacha/contracts.ts \
  mobile/src/features/gacha/library/LibraryHeader.tsx mobile/src/features/gacha/library/libraryScreenStyles.ts \
  mobile/src/features/gacha/library/topics.ts mobile/src/features/gacha/library/cardRank.ts \
  mobile/src/screens/SessionCardScreen.tsx mobile/src/screens/SessionSummaryScreen.tsx \
  mobile/src/config mobile/src/sync mobile/src/types \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup \
  frontend/src/lib/cardRules.ts frontend/src/lib/mcqRules.ts frontend/src/lib/deckImportRunner.ts \
  frontend/src/types frontend/src/api frontend/src/components frontend/tests/support \
  frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/vitest.config.ts \
  frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/eslint.config.js \
  src_C snowflake)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# 5b. Bounded test edits: libraryTopics.test.ts is exactly the two pinned lines, libraryCardTile.test.tsx exactly one
lt_ns="$(git diff --numstat "$mb" -- "$T_LT" | cut -f1,2)"
[ "$lt_ns" = "$(printf '2\t2')" ] || fail "libraryTopics.test.ts numstat must be '2 2', got '${lt_ns:-<no diff>}'"
lt_hunk="$(git diff -U0 "$mb" -- "$T_LT" | grep -E '^[-+][^-+]' | sed -E 's/^([-+])[[:space:]]*/\1/')"
[ "$(printf '%s\n' "$lt_hunk" | wc -l | tr -d ' ')" = "4" ] || { printf '%s\n' "$lt_hunk" >&2; fail "libraryTopics.test.ts: expected exactly four changed lines"; }
for want in \
  "-expect(rowKeys.length).toBe(14);" \
  "+expect(rowKeys.length).toBe(15);" \
  "-expect(rowKeys.slice(-3)).toEqual(['isUpdated', 'topic', 'rank']);" \
  "+expect(rowKeys.slice(-4)).toEqual(['isUpdated', 'topic', 'rank', 'isMcq']);"; do
  printf '%s\n' "$lt_hunk" | grep -Fxq -- "$want" || { printf '%s\n' "$lt_hunk" >&2; fail "libraryTopics.test.ts: missing pinned change: $want"; }
done
tile_ns="$(git diff --numstat "$mb" -- "$T_TILE" | cut -f1,2)"
[ "$tile_ns" = "$(printf '1\t0')" ] || fail "libraryCardTile.test.tsx numstat must be '1 0', got '${tile_ns:-<no diff>}'"
tile_add="$(git diff -U0 "$mb" -- "$T_TILE" | grep -E '^\+[^+]' | sed -E 's/^\+[[:space:]]*//')"
[ "$tile_add" = "isMcq: false," ] || fail "libraryCardTile.test.tsx: the only added line must be 'isMcq: false,' (got: $tile_add)"
grep -A1 -F 'topic: null,' "$T_TILE" | grep -Fq 'isMcq: false,' || fail "libraryCardTile.test.tsx: isMcq: false, must directly follow topic: null,"
# 5c. Reader guard: .Mcq is read only in the three canonical files and, as normalizeMcq(card.Mcq), in the mapper and the planner
readers="$(grep -rlE '\.Mcq([^A-Za-z0-9_]|$)' mobile/src | grep -Ev '^mobile/src/(types/deckExport\.ts|content/deckRepository\.ts|features/gacha/mcq/normalizeMcq\.ts|features/gacha/library/libraryMapper\.ts|features/gacha/planner/sessionPlanner\.ts)$' || true)"
[ -z "$readers" ] || { echo "$readers" >&2; fail "a new .Mcq reader under mobile/src (D00 §0: read it through resolveMcq / isMcqCard / normalizeMcq)"; }
# 5d. Mock safety: no added mobile line brings a react-native import or a name the screen mocks lack
added_mobile="$(git diff -U0 "$mb" -- "${MOBILE_SRC[@]}" | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added_mobile" | grep -Eq "from 'react-native'|Platform|AccessibilityInfo|Vibration|expo-haptics|expo-updates|@sentry"; then
  printf '%s\n' "$added_mobile" | grep -En "from 'react-native'|Platform|AccessibilityInfo|Vibration|expo-haptics|expo-updates|@sentry" >&2 || true
  fail "an added mobile line imports react-native names or native modules (D00 §5 mock-safety guard)"
fi
# 5e. Every changed or untracked path is one of the 19 scope files. Untracked scan is
# pathspec-scoped: the driver symlinks node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json frontend/src frontend/tests frontend/scripts frontend/package.json frontend/package-lock.json docs src_C snowflake; } | sort -u | grep -Ev '^(mobile/src/features/gacha/draw/drawCommit\.ts|mobile/src/navigation/types\.ts|mobile/src/screens/DrawResultScreen\.tsx|mobile/src/screens/CardDetailScreen\.tsx|mobile/src/features/gacha/library/libraryMapper\.ts|mobile/src/features/gacha/library/LibraryCardTile\.tsx|mobile/src/screens/LibraryScreen\.tsx|mobile/tests/unit/drawCommitFaces\.test\.ts|mobile/tests/integration/draw-result-kind\.screen\.test\.tsx|mobile/tests/integration/card-detail-kind\.screen\.test\.tsx|mobile/tests/unit/libraryMcqMark\.test\.tsx|mobile/tests/unit/libraryTopics\.test\.ts|mobile/tests/unit/libraryCardTile\.test\.tsx|frontend/src/lib/mcqWarnings\.ts|frontend/src/lib/deckImport\.ts|frontend/src/pages/DeckImportPage\.tsx|frontend/scripts/lint-deck\.mts|frontend/tests/mcqWarnings\.test\.ts|frontend/tests/deckImportPageWarnings\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D06 scope"; }

echo "D06 VERIFY OK"

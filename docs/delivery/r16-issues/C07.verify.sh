#!/usr/bin/env bash
# C07 — topic-mobile verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/library/topics.ts,
#     mobile/tests/unit/libraryTopics.test.ts and
#     mobile/tests/unit/deckRepositoryTopic.test.ts do not exist on base
#   (step 1 then also checks the C05 prerequisite: 018_cards_topic.sql and
#   the Worker's `public string? Topic` must be on the integration branch,
#   because C00 §4 orders C05 before C07 — the phone reads what C05 publishes)
# Step 2 (literal guards: Topic?: on CardExport, the two signed mapper lines,
# the topics.ts signatures, the chip testIDs, the it('…') titles) would also
# fail on base. Steps 3/4 are the tsc / targeted-vitest gates and step 5 is a
# scope + frozen + OTA guard; both pass on base by design.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (C00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 1–2 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C07 VERIFY FAIL: $*" >&2; exit 1; }

EXPORT=mobile/src/types/deckExport.ts
REPO=mobile/src/content/deckRepository.ts
TOPICS=mobile/src/features/gacha/library/topics.ts
MAPPER=mobile/src/features/gacha/library/libraryMapper.ts
HEADER=mobile/src/features/gacha/library/LibraryHeader.tsx
SCREEN=mobile/src/screens/LibraryScreen.tsx
LT=mobile/tests/unit/libraryTopics.test.ts
RT=mobile/tests/unit/deckRepositoryTopic.test.ts
MIGRATION=src_C/Vpc/Db/Migrations/018_cards_topic.sql
UPLOADER=src_C/Worker/S3/IS3DeckUploader.cs

# The signed mapper line (C00 §0 #1), byte for byte, 6-space indent.
TOPIC_LINE="      Topic: typeof (c as any).topic === 'string' ? (c as any).topic : null,"
# The FlatList remount key (C00 §2.8.3).
KEY_LINE='key={`${numColumns}-${filter}-${topicFilter ?? '"'"'all'"'"'}-${selectedSlug ?? '"'"'none'"'"'}`}'

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C05 prerequisite)"
for f in "$TOPICS" "$LT" "$RT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$EXPORT" "$REPO" "$MAPPER" "$HEADER" "$SCREEN"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$MIGRATION" ] || fail "$MIGRATION is missing — C05 must be merged before C07 (C00 §4)"
grep -Fq "public string? Topic" "$UPLOADER" || fail "IS3DeckUploader.cs lacks CardExportData.Topic (C05 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. CardExport.Topic? directly after OrderInDeck
grep -Fq 'Topic?: string | null;' "$EXPORT" || fail "deckExport.ts lacks 'Topic?: string | null;'"
grep -A1 -F 'OrderInDeck: number;' "$EXPORT" | grep -Fq 'Topic?: string | null;' \
  || fail "deckExport.ts: Topic? must be the line directly after OrderInDeck"
# 2b. The frozen file: 1705 lines, the pinned line exactly twice, each right after OrderInDeck: order,
[ "$(wc -l < "$REPO" | tr -d ' ')" = "1705" ] || fail "deckRepository.ts must be exactly 1705 lines (1703 + the two signed lines)"
[ "$(grep -Fxc "$TOPIC_LINE" "$REPO" || true)" = "2" ] || fail "deckRepository.ts must contain the signed Topic line exactly twice, byte for byte"
[ "$(grep -n -A1 -F 'OrderInDeck: order,' "$REPO" | grep -c -F 'Topic: typeof (c as any).topic' || true)" = "2" ] \
  || fail "deckRepository.ts: each Topic line must directly follow 'OrderInDeck: order,'"
if grep -Eq "^\s+topic\??:" "$REPO"; then
  grep -En "^\s+topic\??:" "$REPO" >&2 || true
  fail "deckRepository.ts: the raw card types must NOT gain a topic key (the cast is the signed line's point)"
fi
# 2c. topics.ts — four exports, pure
grep -Fq "export function normalizeTopic(raw: unknown): string | null" "$TOPICS" || fail "topics.ts lacks normalizeTopic(raw: unknown): string | null"
grep -Fq "export function topicKey(topic: string): string" "$TOPICS"           || fail "topics.ts lacks topicKey(topic: string): string"
grep -Fq "export const UNTAGGED_TOPIC_KEY = 'untagged';" "$TOPICS"             || fail "topics.ts lacks UNTAGGED_TOPIC_KEY literal"
grep -Fq "export const UNTAGGED_TOPIC_LABEL = 'Untagged';" "$TOPICS"           || fail "topics.ts lacks UNTAGGED_TOPIC_LABEL literal"
if grep -Eq "from 'react|require\(|AsyncStorage|Date\.now|Math\.random" "$TOPICS"; then
  grep -En "from 'react|require\(|AsyncStorage|Date\.now|Math\.random" "$TOPICS" >&2 || true
  fail "topics.ts must stay pure (no react / require / storage / clock / randomness)"
fi
# 2d. libraryMapper.ts — new keys appended, old chips byte-identical, no SectionList
for sym in "from './topics'" \
           "export type LibraryTopicChip = { key: string; label: string; count: number };" \
           "topics: LibraryTopicChip[];" \
           "topicFilter: string | null;" \
           "topicFilter?: string | null;" \
           "topic: string | null;" \
           "topic: normalizeTopic(card.Topic)," \
           "export type LibraryFilter = 'all' | 'new' | 'learning' | 'mastered' | 'rare' | 'legendary';" \
           "{ key: 'all', label: 'All', count: rows.length }," \
           "{ key: 'new', label: 'New', count: newCount }," \
           "{ key: 'learning', label: 'Learning', count: learningCount }," \
           "{ key: 'mastered', label: 'Mastered', count: masteredCount }," \
           "{ key: 'rare', label: 'Rare', count: rareCount }," \
           "{ key: 'legendary', label: 'Legendary', count: legendaryCount },"; do
  grep -Fq "$sym" "$MAPPER" || fail "libraryMapper.ts lacks: $sym"
done
# 2e. LibraryHeader.tsx — three required props, the topic row, old testIDs intact
for sym in "topics: LibraryTopicChip[];" \
           "topicFilter: string | null;" \
           "onSelectTopic: (key: string) => void;" \
           'testID="library-topic-chips"' \
           'testID={`library-topic-chip-${' \
           "topics.length > 0" \
           'testID={`library-filter-chip-${filterChip.key}`}' \
           'testID={`library-sheet-filter-${filterChip.key}`}' \
           "styles.filterChipsRow"; do
  grep -Fq "$sym" "$HEADER" || fail "LibraryHeader.tsx lacks: $sym"
done
# 2f. LibraryScreen.tsx — state, VM param, remount key, header wiring, reset CTA, FlatList intact
grep -Fq "const [topicFilter, setTopicFilter] = useState<string | null>(null);" "$SCREEN" || fail "LibraryScreen.tsx lacks the topicFilter state line"
grep -Fq "$KEY_LINE" "$SCREEN" || fail "LibraryScreen.tsx: FlatList key must be exactly \`\${numColumns}-\${filter}-\${topicFilter ?? 'all'}-\${selectedSlug ?? 'none'}\`"
for sym in "topics={vm.topics}" "topicFilter={vm.topicFilter}" "onSelectTopic=" "setTopicFilter(null)" \
           "keyExtractor={(item) => item.stableUid}" "numColumns={numColumns}"; do
  grep -Fq "$sym" "$SCREEN" || fail "LibraryScreen.tsx lacks: $sym"
done
if grep -q "SectionList" "$MAPPER" "$HEADER" "$SCREEN"; then
  grep -n "SectionList" "$MAPPER" "$HEADER" "$SCREEN" >&2 || true
  fail "grouping is ordering + chips; SectionList / header rows are out (C00 §2.8.3)"
fi
# 2g. tests — titles, harnesses, property tests, counts
grep -Fq "from 'fast-check'" "$LT" || fail "libraryTopics.test.ts must use fast-check"
grep -Fq "fc.assert(" "$LT"        || fail "libraryTopics.test.ts has no fc.assert property"
grep -Fq "from '../../src/features/gacha/library/topics'" "$LT" || fail "libraryTopics.test.ts must import topics.ts"
grep -Fq "from '../../src/features/gacha/library/libraryMapper'" "$LT" || fail "libraryTopics.test.ts must import libraryMapper.ts"
grep -Fq "Object.keys(" "$LT" || fail "libraryTopics.test.ts must pin the row / VM key order"
for s in \
  'normalizes topics: trims, maps blank and non-strings to null' \
  'derives stable chip keys and sidesteps the reserved keys' \
  'exposes no topic chips and keeps deck order for a deck without topics' \
  'lists All, each topic in first-seen deck order, then Untagged' \
  'orders cards by topic group then orderInDeck when any topic exists' \
  'keeps only the selected group and treats an unknown key as All' \
  'composes the topic filter with the status filter' \
  'appends topic last on every row and the two new keys last on the VM' \
  'keeps every row, groups in chip order and orders each group by orderInDeck (property)' \
  'filters each chip down to exactly its group (property)'; do
  grep -Fq "it('$s'" "$LT" || fail "missing libraryTopics test case: $s"
done
grep -Fq "vi.mock('expo-file-system/legacy'" "$RT" || fail "deckRepositoryTopic.test.ts must mock expo-file-system/legacy (harness of deckRepositoryTimeouts.test.ts)"
grep -Fq "vi.resetModules()" "$RT"                  || fail "deckRepositoryTopic.test.ts must reload the repository per test (vi.resetModules)"
grep -Fq "resolveDeckBySlug" "$RT"                  || fail "deckRepositoryTopic.test.ts must go through resolveDeckBySlug (the mappers are private)"
grep -Fq "Object.keys(" "$RT"                       || fail "deckRepositoryTopic.test.ts must pin the mapped card's key order"
for s in \
  'surfaces topic from a flat deck file as CardExport.Topic' \
  'surfaces topic from a v1 deck file as CardExport.Topic' \
  'maps a missing topic to null and keeps the card key order' \
  'maps a non-string topic to null'; do
  grep -Fq "it('$s'" "$RT" || fail "missing deckRepositoryTopic test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$LT" || true)" -ge 10 ] || fail "libraryTopics.test.ts needs >= 10 it() blocks"
[ "$(grep -cE "^\s*it\(" "$RT" || true)" -ge 4 ]  || fail "deckRepositoryTopic.test.ts needs >= 4 it() blocks"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$EXPORT" "$TOPICS" "$MAPPER" "$HEADER" "$SCREEN" "$LT" "$RT" \
  && fail "test gutting / suppression found"
# 2h. Existing Library / repository suites are zero-diff against the base
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet "$mb" -- \
  mobile/tests/unit/library.test.ts \
  mobile/tests/unit/ownedGatePredicates.test.ts \
  mobile/tests/unit/deckRepositoryTimeouts.test.ts \
  mobile/tests/integration/library.screen.test.tsx \
  mobile/tests/integration/library-final.screen.test.tsx \
  mobile/tests/integration/library-360-columns.spec.tsx \
  || fail "an existing Library / repository test file changed — C07 is add-only on tests (C00 §3.1)"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the Library / repository suites they sit beside) ──
echo "[4/5] vitest libraryTopics / deckRepositoryTopic / library suites"
( cd mobile && npx vitest run \
    tests/unit/libraryTopics.test.ts \
    tests/unit/deckRepositoryTopic.test.ts \
    tests/unit/library.test.ts \
    tests/unit/ownedGatePredicates.test.ts \
    tests/unit/deckRepositoryTimeouts.test.ts \
    tests/integration/library.screen.test.tsx \
    tests/integration/library-final.screen.test.tsx \
    tests/integration/library-360-columns.spec.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The signed exception: deckRepository.ts is +2 / -0 and the two + lines are the pinned line
numstat="$(git diff --numstat "$mb" -- "$REPO" | cut -f1,2)"
[ "$numstat" = "$(printf '2\t0')" ] || fail "deckRepository.ts numstat must be '2 0', got '${numstat:-<no diff>}'"
added="$(git diff -U0 "$mb" -- "$REPO" | grep '^+' | grep -v '^+++' || true)"
[ "$added" = "$(printf '+%s\n+%s' "$TOPIC_LINE" "$TOPIC_LINE")" ] \
  || { printf '%s\n' "$added" >&2; fail "deckRepository.ts: the only added lines must be the signed Topic line, twice"; }
# 5b. The other frozen / do-not-touch files and the OTA manifest set
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/review/storage.ts \
  mobile/src/content/chunkedInstall.ts mobile/src/features/gacha/contracts.ts \
  mobile/src/features/gacha/library/LibraryCardTile.tsx mobile/src/features/gacha/library/libraryScreenStyles.ts \
  mobile/src/navigation/types.ts mobile/src/screens/CardDetailScreen.tsx mobile/src/theme/cardIcon.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# 5c. Every changed or untracked path is one of the eight scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/types/deckExport\.ts|mobile/src/content/deckRepository\.ts|mobile/src/features/gacha/library/topics\.ts|mobile/src/features/gacha/library/libraryMapper\.ts|mobile/src/features/gacha/library/LibraryHeader\.tsx|mobile/src/screens/LibraryScreen\.tsx|mobile/tests/unit/libraryTopics\.test\.ts|mobile/tests/unit/deckRepositoryTopic\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C07 scope"; }

echo "C07 VERIFY OK"

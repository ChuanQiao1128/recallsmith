# C07 — L1 topic on mobile (`topic-mobile`)

Surface the server's new `cards.topic` (C05, migration `018_cards_topic.sql`) on the phone: `CardExport.Topic?`, the two signed one-line additions to the frozen `deckRepository.ts` install mappers, a pure `topics.ts` helper, `LibraryCardRow.topic`, topic chips plus topic grouping in the Library view model / header / screen, and two new unit suites. Pure JS/TS shipped as an OTA on runtime 1.6.0 — no dependency, manifest or native change. A deck with no topics must render exactly as it does today: no chip row, same card order, same six status chips, same sheet probes.

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`; every line read on 2026-09-21):

- **Server → disk already works.** C05 emits `topic` as the LAST key of a card in `deck.json`, chunks and delta patches and omits it when null (C00 §2.8.1). On the phone the install validators check only `stableUid` per card (`mobile/src/content/deckRepository.ts:886` and `:907`, inside `:877-926`), `applyDelta` (`:1169-1200`) copies whole card objects, and the chunked assembler pushes whole objects too (`mobile/src/content/chunkedInstall.ts:332` `cards.push(card as ChunkedCard);`). So `topic` reaches the installed file untouched and is dropped only by the two read mappers. Nothing under `content/` other than the two mapper lines needs to change.
- `mobile/src/types/deckExport.ts:15-25` — `CardExport` has nine fields; `OrderInDeck: number;` is `:24`, the last line before `}`. No `Topic`.
- `mobile/src/content/deckRepository.ts` (frozen; blob `1372a606`, 1703 lines): raw card types `:396-408` (v1) and `:419-431` (flat) have no `topic` key, so under `strict: true` `c.topic` is TS2339 — the signed line reads it through `(c as any)`. `resolveDeckBySlug` `:582-653` reads the installed file (`:630-650`) and dispatches to `mapRawDeckV1ToDeckExport` `:1586-1644` (card literal `:1612-1625`) or `mapRawDeckFlatToDeckExport` `:1646-1703` (literal `:1671-1684`). `OrderInDeck: order,` is at `:1620` and `:1679`, each followed by a blank line and `Revision: revision,`. Both literals close with `} as any;`, so the produced object's key order is the literal's order. The mappers are module-private; the only way to test them is through `resolveDeckBySlug`.
- `mobile/src/features/gacha/library/libraryMapper.ts` (266 lines): `LibraryCardRow` `:18-45` (last field `isUpdated` `:44`), `LibraryFilterChip` `:47-51`, `LibraryViewModel` `:58-64` (`cards` `:63` is the last key), `buildLibraryCardRows` `:103-168` (sorts by `OrderInDeck` `:116`; row literal `:140-166`, last key `isUpdated:` `:162-165`), `buildLibraryVM` `:170-266` (`rows` `:192`, status/rarity resolver `:223-236` — note `filter === 'all' ? rows` returns the SAME array, six `filters` `:238-245`, return literal `:247-265`).
- `mobile/src/features/gacha/library/LibraryHeader.tsx` (295 lines): `Props` `:105-126`, destructuring `:128-141`; deck switcher `:207-234`; status chip row `:240-271` (a horizontal `ScrollView` with `contentContainerStyle={styles.filterChipsRow}`, `testID={`library-filter-chip-${filterChip.key}`}` `:250`, active label `${label} · ${count}` `:266`); hidden probes `:275-292` (`library-sheet-filter-${filterChip.key}` `:285`).
- `mobile/src/screens/LibraryScreen.tsx` (421 lines): mapper imports `:24-29`; `filter` / `filterOpen` state `:61-62`; `refresh` `:90-148`; `vm = buildLibraryVM({ deck, progress, filter, now, decks, selectedDeckSlug, ownedSet })` `:164-175` with deps `[deck, progress, filter, deckOptions, selectedSlug, ownedSet]`; `visibleCards = vm?.cards ?? []` `:177`; `FlatList` `:323-414` with `key={`${numColumns}-${filter}-${selectedSlug ?? 'none'}`}` `:326`, `ListHeaderComponent={<LibraryHeader …/>}` `:349-382` (`onSelectFilter` `:363-366`), `ListEmptyComponent` `:383-403` whose "Reset filters" CTA is `onPress={() => setFilter('all')}` `:395`, `keyExtractor={(item) => item.stableUid}` `:404`.
- `mobile/src/features/gacha/library/libraryScreenStyles.ts` (NOT in scope): `pressed` `:61`, `filterChipsRow` `:110-117`, `filterChip` `:118-125`, `filterChipActive` `:126-129`, `filterChipText` `:130-135`, `filterChipTextActive` `:136`. The topic chip row reuses exactly these.
- `mobile/src/features/gacha/contracts.ts:96-128` — `LibraryStatusCounts` and `LibraryVM` (not edited; the new keys go on `LibraryViewModel` in the mapper).
- **Existing pins you must not disturb**: `mobile/tests/unit/library.test.ts:102-123` pins `vm.filters.map(key)` to exactly the six status keys; `mobile/tests/integration/library-final.screen.test.tsx:183-203` pins the sheet probes. Topic chips are therefore a SEPARATE array (`topics`) and a SEPARATE state (`topicFilter`), never appended to `filters`. No existing test pins a whole row object or the VM's key set (`library.test.ts:76-77,99,128` and `tests/unit/ownedGatePredicates.test.ts:189,343` map single fields), so appending `topic` to the row and `topics` / `topicFilter` to the VM is safe. `mobile/tests/p2-smoke.ts:255-275` calls `buildLibraryVM` with the existing params and keeps compiling.
- **Harness precedent for the frozen file**: `mobile/tests/unit/deckRepositoryTimeouts.test.ts:18-92` (hoisted `EXPO_PUBLIC_*` env, Map-backed AsyncStorage, `expo-file-system/legacy`, `expo-crypto`, `aws-amplify/auth` and `premiumStore` mocks, `loadRepo()` with `vi.resetModules()`) and `seedInstalledDeck` `:122-139` (manifest cache under `devcards:content:manifest:v2`, deckmeta under `devcards:content:deckmeta:v2:user1:algo`, file text under `file:///docs/devcards-decks-v2/user1/algo.json`). A `free` tier entry keeps the read off the network.
- Typecheck: `mobile/tsconfig.json` is `strict: true` with no `include`, so `tests/` is typechecked by `npm run test:typecheck`. `fast-check` is a devDependency (`mobile/package.json:66`). vitest discovers `tests/unit/**/*.test.ts` (`mobile/vitest.config.ts`).

What C00 decided (binding; `docs/delivery/r16-issues/C00-contracts.md`): §0 non-negotiable #1 (`:14`) pins the mapper line byte for byte and the `2 0` numstat guard; §2.8.3 (`:429-454`) pins every exported name below; §3.2 (`:680-681`) the two test files; §4 (`:711`) deps = **C05 only**; §1.1 (`:58`, `:60`) orders **C07 → C04** on `LibraryHeader.tsx` / `LibraryScreen.tsx` (C04 rebases on this issue and adds its sweep CTA afterwards). The task line that spawned this brief listed deps "C05, C04" — C00 §4 wins: a C07 → C04 edge would be a cycle with `:708`.

Doc drift, stated so nobody re-derives it: `docs/release-1.6.0-plan-2026-09-19.md:204` says the AWS deck renders "under D1–D4 topic headers" and the old C# deck "under 'Other'"; C00 §2.8.3 decides grouping is ORDERING plus chips (no `SectionList`, no header rows in `cards`, `keyExtractor` stays `item.stableUid`), the untagged label is `Untagged`, and a deck where no card carries a topic shows no chip row at all (`topics === []`). The mobile survey (§6.2/§6.3) suggested `(c as any).topic ?? null` and `SectionList`/synthetic rows — superseded by C00. `docs/delivery-wave-1.6-plan-2026-09-19.md:111` ("`deckRepository.ts` diff ≤ 2 行") is tightened by C00 to exactly `2 0`.

Gaps C00 leaves open — resolved here and binding for this issue:

1. **Reserved / empty chip keys.** `topicKey('All')` would collide with the `all` chip, `topicKey('Untagged')` with `UNTAGGED_TOPIC_KEY`, `topicKey('???')` is `''`. Decision: `topicKey` returns `t-${slug}` whenever the slug is `''`, `'all'` or `UNTAGGED_TOPIC_KEY` (so `t-all`, `t-untagged`, `t-`). Every other topic keeps the plain slug (`iam-s3`).
2. **Two distinct topic strings with one key** (`IAM/S3` and `IAM & S3` → `iam-s3`): one chip, one group; the label is the first-seen normalized text in deck order.
3. **Unknown `topicFilter`** (stale after a deck switch, or garbage): the mapper treats any key that is `null`, `'all'` or not present in `topics` as "no topic filter", and the VM's `topicFilter` reports the EFFECTIVE value (`null` in those cases, else the key). The header highlights `vm.topicFilter ?? 'all'`.
4. **Filters compose.** The status/rarity `filter` is applied first (existing resolver), then grouping order, then the topic filter.
5. **"Reset filters" resets both.** The empty-state CTA at `LibraryScreen.tsx:395` also clears `topicFilter`.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (`:9-24`), §1.1 (`:30-66` — the C07 column), §2.8.3 (`:429-454`), §3.2 (`:680-681`), §5 (`:725-736`), §6 #23 (`:764`).
2. `mobile/src/types/deckExport.ts` (whole file, 25 lines).
3. `mobile/src/content/deckRepository.ts:380-432` (raw types), `:582-653` (`resolveDeckBySlug`), `:1586-1703` (both mappers). You change two lines of this file and nothing else.
4. `mobile/src/features/gacha/library/libraryMapper.ts` (whole file, 266 lines).
5. `mobile/src/features/gacha/library/LibraryHeader.tsx:1-7`, `:105-141`, `:206-295`.
6. `mobile/src/screens/LibraryScreen.tsx:24-29`, `:50-70`, `:164-177`, `:323-414`.
7. `mobile/src/features/gacha/library/libraryScreenStyles.ts:61`, `:105-140` (the styles you reuse; do not edit).
8. `mobile/tests/unit/library.test.ts` (whole, 130 lines — the fixture style and the six-key pin) and `mobile/tests/unit/deckRepositoryTimeouts.test.ts:1-137` (the harness you copy).
9. `mobile/tests/integration/library-final.screen.test.tsx:1-163` (you do not edit it; your header must keep rendering inside its `react-native` mock, which stubs `ScrollView`, `Pressable`, `Text`, `View`).
10. `mobile/tests/unit/spillSchedule.test.ts:1-45` (fast-check style used in this repo: `import fc from 'fast-check'`).

## Constraints

- **Scope (the ONLY files that may change):**
  `mobile/src/types/deckExport.ts`, `mobile/src/content/deckRepository.ts` (the two signed lines only), `mobile/src/features/gacha/library/topics.ts` (new), `mobile/src/features/gacha/library/libraryMapper.ts`, `mobile/src/features/gacha/library/LibraryHeader.tsx`, `mobile/src/screens/LibraryScreen.tsx`, `mobile/tests/unit/libraryTopics.test.ts` (new), `mobile/tests/unit/deckRepositoryTopic.test.ts` (new), and **one line** in `mobile/tests/unit/libraryCardTile.test.tsx`: its `baseRow: LibraryCardRow` fixture (`:38-53`) gains `topic: null,` after `isUpdated: false,` so the required field typechecks (`git diff --numstat` prints `1	0` for that file). Nothing else.
- **Frozen files (gacha-v7 §2.1, narrowed by C00 §0):** `mobile/src/content/deckRepository.ts` changes by exactly two added lines and zero removed (`git diff --numstat` prints `2	0`); `mobile/src/sync/progressSync.ts` and `mobile/src/review/model.ts` are zero-diff. Also untouched: `mobile/src/review/storage.ts`, `mobile/src/content/chunkedInstall.ts`, `mobile/src/features/gacha/contracts.ts`, `mobile/src/features/gacha/library/LibraryCardTile.tsx`, `mobile/src/features/gacha/library/libraryScreenStyles.ts`, `mobile/src/navigation/types.ts`, `mobile/src/screens/CardDetailScreen.tsx`, `mobile/src/theme/cardIcon.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`.
- **OTA rule (C00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no new dependency, no native module, no `npm install`. `"expo-updates": "~29.0.15"` and `"version": "1.6.0"` stay as they are.
- **No `SectionList`, no synthetic header rows in `cards`.** Grouping is the order of `vm.cards`; `keyExtractor` stays `item.stableUid`; `FlatList` keeps `numColumns`.
- **Do not touch** the six `filters` chips (`libraryMapper.ts:238-245`), the status chip row (`LibraryHeader.tsx:240-271`), the hidden probes (`:275-292`), `LibraryFilter`, `LibraryFilterChip`, or the status resolver's output for a deck without topics.
- **testIDs (pinned):** `library-topic-chips` (the row `ScrollView`), `library-topic-chip-${key}` (each chip). **Copy (pinned):** `All`, `Untagged`; active chip text `${label} · ${count}` like the status chips.
- **Banned literals in any new/changed line:** the six terms of B00 §0 (driver gate). Use "sidestep", "work around", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- **Existing tests:** no existing test file changes except the one-line `libraryCardTile.test.tsx` fixture addition above (added 2026-09-21 after the first run: attempts 1–2 needed exactly that line and were rejected only by the scope guard; attempt 3 made `topic` optional instead, which the literal guard rejects — `topic: string | null;` stays required). `tests/unit/library.test.ts`, `tests/unit/ownedGatePredicates.test.ts`, `tests/unit/deckRepositoryTimeouts.test.ts`, `tests/integration/library.screen.test.tsx`, `tests/integration/library-final.screen.test.tsx`, `tests/integration/library-360-columns.spec.tsx` must stay green untouched.
- **Wave D is not here:** no `McqExport`, `isMcqCard`, `kindHint`, feature-flag or remote-config edits (C00 §0 do-not-touch list).
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23).
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

1. **`mobile/src/types/deckExport.ts`** — one added line directly after `OrderInDeck: number;` (`:24`), before `}`:
   ```ts
     Topic?: string | null;        // C05 cards.topic; absent in pre-018 files, null when untagged
   ```
   The verify greps the exact text `Topic?: string | null;`. Nothing else in the file changes.

2. **`mobile/src/content/deckRepository.ts`** — exactly one added line per mapper, byte for byte (6-space indent, C00 §0 #1), inserted immediately after `      OrderInDeck: order,` at `:1620` (v1 mapper) and `:1679` (flat mapper), before the blank line that precedes `Revision: revision,`:
   ```ts
         Topic: typeof (c as any).topic === 'string' ? (c as any).topic : null,
   ```
   No trimming, no `?? null`, no comment, no other edit (the raw types at `:396-408` / `:419-431` are NOT extended — the cast is the whole point). After the edit the file is 1705 lines and `git diff --numstat` against the base prints `2	0`. The resulting card key order is `StableUid, Question, Explanation, CodeSnippet, CodeLanguage, RealWorldUsage, Difficulty, OrderInDeck, Topic, Revision, Version, UpdatedAt`.

3. **`mobile/src/features/gacha/library/topics.ts` (new, pure — no react, no storage, no clock):**
   ```ts
   /** Chip key of the "no topic" group and its label (C00 §2.8.3). */
   export const UNTAGGED_TOPIC_KEY = 'untagged';
   export const UNTAGGED_TOPIC_LABEL = 'Untagged';

   /** string → trim, '' → null; anything else → null. The mapper line in deckRepository.ts does not trim. */
   export function normalizeTopic(raw: unknown): string | null {
     if (typeof raw !== 'string') return null;
     const trimmed = raw.trim();
     return trimmed.length > 0 ? trimmed : null;
   }

   /** Lowercase, runs of [^a-z0-9] → '-', leading/trailing '-' removed. Used as the chip key and in testIDs.
    *  A slug that is empty or would collide with the reserved keys ('all', UNTAGGED_TOPIC_KEY) is prefixed
    *  with 't-' so a topic literally named "All" or "Untagged" keeps its own chip. */
   export function topicKey(topic: string): string {
     const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
     return slug === '' || slug === 'all' || slug === UNTAGGED_TOPIC_KEY ? `t-${slug}` : slug;
   }
   ```
   Exactly these four exports with these signatures (the verify greps the signature lines).

4. **`mobile/src/features/gacha/library/libraryMapper.ts`**
   a. Import: `import { normalizeTopic, topicKey, UNTAGGED_TOPIC_KEY, UNTAGGED_TOPIC_LABEL } from './topics';` next to the other imports (`:1-7`).
   b. `LibraryCardRow` (`:18-45`): append `topic: string | null;` as the LAST field, after `isUpdated: boolean;` (`:44`).
   c. After `LibraryFilterChip` (`:47-51`) add, verbatim on one line:
      ```ts
      export type LibraryTopicChip = { key: string; label: string; count: number };
      ```
   d. `LibraryViewModel` (`:58-64`): append `topics: LibraryTopicChip[];` and `topicFilter: string | null;` after `cards: LibraryCardRow[];` (`:63`) — the two new keys are the last two.
   e. Row literal (`:140-166`): append `topic: normalizeTopic(card.Topic),` as the LAST property, after the `isUpdated:` expression (`:162-165`). `card.Topic` typechecks through change 1.
   f. `buildLibraryVM` params (`:170-180`): add `topicFilter?: string | null;` last; destructure it with default `null` (`:181-191`).
   g. After the existing status/rarity resolver (`:223-236`), which stays byte-identical and now feeds a `const statusFiltered = …` (rename its `const cards` to `statusFiltered`; the ternary body is unchanged), derive:
      ```ts
      const groupKeyOf = (row: LibraryCardRow): string => (row.topic === null ? UNTAGGED_TOPIC_KEY : topicKey(row.topic));
      const hasTopics = rows.some((row) => row.topic !== null);
      // One chip per distinct key, first-seen in deck order (rows are already OrderInDeck ascending);
      // the label is the first-seen normalized text, so "IAM/S3" and "IAM & S3" share one chip.
      const topicOrder: string[] = [];
      const topicLabel = new Map<string, string>();
      const topicCount = new Map<string, number>();
      if (hasTopics) {
        for (const row of rows) {
          if (row.topic === null) continue;
          const key = topicKey(row.topic);
          if (!topicLabel.has(key)) {
            topicOrder.push(key);
            topicLabel.set(key, row.topic);
          }
          topicCount.set(key, (topicCount.get(key) ?? 0) + 1);
        }
      }
      const untaggedCount = rows.filter((row) => row.topic === null).length;
      const topics: LibraryTopicChip[] = hasTopics
        ? [
            { key: 'all', label: 'All', count: rows.length },
            ...topicOrder.map((key) => ({ key, label: topicLabel.get(key) ?? key, count: topicCount.get(key) ?? 0 })),
            ...(untaggedCount > 0 ? [{ key: UNTAGGED_TOPIC_KEY, label: UNTAGGED_TOPIC_LABEL, count: untaggedCount }] : []),
          ]
        : [];
      const effectiveTopicFilter =
        topicFilter !== null && topicFilter !== 'all' && topics.some((chip) => chip.key === topicFilter) ? topicFilter : null;
      const groupIndex = new Map(topics.map((chip, index) => [chip.key, index]));
      const rank = (row: LibraryCardRow): number => groupIndex.get(groupKeyOf(row)) ?? Number.MAX_SAFE_INTEGER;
      // Grouping IS the order: topic groups in chip order, OrderInDeck inside a group. Copy before sorting —
      // for filter === 'all' the resolver hands back `rows` itself.
      const cards = !hasTopics
        ? statusFiltered
        : [...statusFiltered]
            .filter((row) => effectiveTopicFilter === null || groupKeyOf(row) === effectiveTopicFilter)
            .sort((a, b) => rank(a) - rank(b) || a.orderInDeck - b.orderInDeck);
      ```
      For a deck without topics `cards` is the very same array the resolver returned today.
   h. Return literal (`:247-265`): append `topics,` and `topicFilter: effectiveTopicFilter,` after `cards,` (last two keys). `title`, `subtitle`, `drawStatusLabel`, `counts`, `decks`, `selectedDeckSlug`, `filter`, `filters` are unchanged, and the six `filters` entries at `:238-245` are byte-identical.

5. **`mobile/src/features/gacha/library/LibraryHeader.tsx`**
   a. Import the type: `import type { LibraryDeckOption, LibraryFilter, LibraryFilterChip, LibraryTopicChip } from './libraryMapper';` (`:4`).
   b. `Props` (`:105-126`) gain three REQUIRED props, placed after `onSelectFilter` (`:116`) and before `onOpenFirstPack?` (`:120`), verbatim:
      ```ts
        topics: LibraryTopicChip[];
        topicFilter: string | null;
        onSelectTopic: (key: string) => void;
      ```
      and the destructuring (`:128-141`) picks them up.
   c. Render the topic row ONLY when `topics.length > 0`, placed between the deck switcher's closing `) : null}` (`:234`) and the status chip comment (`:236`), i.e. ABOVE the status chips. Reuse the status chip styles; no new style keys:
      ```tsx
      {topics.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsRow}
          testID="library-topic-chips"
        >
          {topics.map((chip) => {
            const active = chip.key === (topicFilter ?? 'all');
            return (
              <Pressable
                key={`topic-${chip.key}`}
                testID={`library-topic-chip-${chip.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectTopic(chip.key)}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
                  {active ? `${chip.label} · ${chip.count}` : chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      ```
   d. The status chip row (`:240-271`), the probes (`:275-292`), the banner and the title bar are unchanged.

6. **`mobile/src/screens/LibraryScreen.tsx`**
   a. State, directly after `filterOpen` (`:62`): `const [topicFilter, setTopicFilter] = useState<string | null>(null);` (exact text; the verify greps it).
   b. `buildLibraryVM` call (`:166-174`): pass `topicFilter,` after `ownedSet,`; the `useMemo` deps (`:175`) gain `topicFilter`.
   c. `FlatList` `key` (`:326`) becomes exactly:
      ```tsx
      key={`${numColumns}-${filter}-${topicFilter ?? 'all'}-${selectedSlug ?? 'none'}`}
      ```
   d. `LibraryHeader` props (`:349-382`): add `topics={vm.topics}`, `topicFilter={vm.topicFilter}` (the effective value from the VM, not the raw state) and `onSelectTopic={(key) => setTopicFilter(key === 'all' ? null : key)}` after `onSelectFilter` (`:363-366`).
   e. Empty-state CTA (`:393-401`): `onPress={() => { setFilter('all'); setTopicFilter(null); }}` — the verify greps `setTopicFilter(null)`.
   f. No new imports, no `SectionList`, `keyExtractor` (`:404`) and `renderItem` (`:405-413`) unchanged. `scrollToNew` / `highlightUids` logic (`:181-233`) reads `visibleCards` and needs no edit — a topic filter simply narrows what is on screen, which is the documented behaviour of that effect.

7. **`mobile/tests/unit/libraryTopics.test.ts` (new)** — imports `buildLibraryVM`, `buildLibraryCardRows` from `../../src/features/gacha/library/libraryMapper`, `normalizeTopic`, `topicKey`, `UNTAGGED_TOPIC_KEY`, `UNTAGGED_TOPIC_LABEL` from `../../src/features/gacha/library/topics`, and `fc from 'fast-check'`. Fixture in the style of `library.test.ts:9-22` (`as any`), `NOW` fixed, `progress: []`:
   ```
   Cards: [
     { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Topic: 'IAM' },
     { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Topic: 'Compute / EC2' },
     { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3' },
     { StableUid: '4', OrderInDeck: 4, Difficulty: 2, Question: 'Q4', Topic: ' IAM ' },
     { StableUid: '5', OrderInDeck: 5, Difficulty: 1, Question: 'Q5', Topic: '' },
   ]
   ```
   and a second `plainDeck` whose five cards carry no `Topic` key. Cases, each its own `it`, titles verbatim:
   1. `it('normalizes topics: trims, maps blank and non-strings to null', …)` — `normalizeTopic(' IAM ') === 'IAM'`, `''`/`'   '`/`null`/`undefined`/`7`/`['x']` → `null`.
   2. `it('derives stable chip keys and sidesteps the reserved keys', …)` — `topicKey('IAM & S3') === 'iam-s3'`, `topicKey('Compute / EC2') === 'compute-ec2'`, `topicKey('IAM') === 'iam'`, `topicKey('All') === 't-all'`, `topicKey('Untagged') === 't-untagged'`, `topicKey('???') === 't-'`, `UNTAGGED_TOPIC_KEY === 'untagged'`, `UNTAGGED_TOPIC_LABEL === 'Untagged'`.
   3. `it('exposes no topic chips and keeps deck order for a deck without topics', …)` — on `plainDeck`: `vm.topics` `toEqual([])`, `vm.topicFilter === null`, `vm.cards.map(uid)` equals `['1','2','3','4','5']`, every `row.topic === null`, and `buildLibraryVM({ …, topicFilter: 'iam' }).cards.map(uid)` is still all five (a topic filter cannot narrow a deck that has no chips).
   4. `it('lists All, each topic in first-seen deck order, then Untagged', …)` — `vm.topics.map(key)` `toEqual(['all','iam','compute-ec2','untagged'])`, labels `['All','IAM','Compute / EC2','Untagged']`, counts `[5,2,1,2]`.
   5. `it('orders cards by topic group then orderInDeck when any topic exists', …)` — `vm.cards.map(uid)` `toEqual(['1','4','2','3','5'])`; `vm.filters.map(key)` is still the six status keys.
   6. `it('keeps only the selected group and treats an unknown key as All', …)` — `topicFilter: 'iam'` → `['1','4']` and `vm.topicFilter === 'iam'`; `'untagged'` → `['3','5']`; `'all'` and `'nope'` → the grouped five with `vm.topicFilter === null`.
   7. `it('composes the topic filter with the status filter', …)` — `filter: 'rare'` (Difficulty 2 → cards 2 and 4) with `topicFilter: 'iam'` → `['4']`; with no topic filter → `['4','2']` (grouped order, IAM before Compute).
   8. `it('appends topic last on every row and the two new keys last on the VM', …)` — `Object.keys(buildLibraryCardRows({ deck, progress: [], now })[0])` ends with `'isUpdated', 'topic'` (13 keys); `Object.keys(vm)` `toEqual(['title','subtitle','drawStatusLabel','counts','decks','selectedDeckSlug','filter','filters','cards','topics','topicFilter'])`.
   9. `it('keeps every row, groups in chip order and orders each group by orderInDeck (property)', …)` — fast-check: `fc.array(fc.option(fc.constantFrom('IAM', 'S3', 'EC2', 'All', '???', ' iam '), { nil: null }), { maxLength: 30 })` mapped to cards `{ StableUid: `u${i}`, OrderInDeck: i + 1, Difficulty: 1 + (i % 3), Question: `Q${i}`, Topic: t }` (omit the key when `t === null`); for every generated deck: `vm.cards` has the same uid multiset as `rows`; `vm.topics.reduce(count)` over non-`all` chips equals `rows.length` when topics exist; consecutive cards never go backwards in chip index and, within one chip index, `orderInDeck` strictly increases; when every topic is null, `topics` is `[]` and the order is `OrderInDeck` ascending.
   10. `it('filters each chip down to exactly its group (property)', …)` — same arbitrary; for every chip key `k !== 'all'`, `buildLibraryVM({ …, topicFilter: k }).cards` equals the rows whose group key is `k`, in `orderInDeck` order, and its length equals that chip's `count`.

8. **`mobile/tests/unit/deckRepositoryTopic.test.ts` (new)** — copy the harness of `deckRepositoryTimeouts.test.ts:18-92` verbatim (the `vi.hoisted` env block, `store` / `files` maps, the five `vi.mock`s, `loadRepo`), plus `CACHE_KEY`, `DECK_FILE`, a `free`-tier manifest and a `seed(fileJson: unknown)` helper that writes the manifest cache, the deckmeta `{ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1 }` and `JSON.stringify(fileJson)` into `files`. `beforeEach` clears `store` and `files`. Cases, titles verbatim:
   1. `it('surfaces topic from a flat deck file as CardExport.Topic', …)` — flat file `{ slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1, version: 'v1', cards: [{ stableUid: 'a1', question: 'Q1', difficulty: 2, orderInDeck: 1, topic: 'IAM' }, { stableUid: 'a2', question: 'Q2', orderInDeck: 2 }] }` → `deck.Cards[0].Topic === 'IAM'`, `deck.Cards[1].Topic === null`.
   2. `it('surfaces topic from a v1 deck file as CardExport.Topic', …)` — v1 file `{ buildId: 'v1', deck: { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1 }, cards: [{ stableUid: 'a1', question: 'Q1', topic: ' S3 ' }] }` → `Topic === ' S3 '` (the mapper does not trim; `normalizeTopic` does, later).
   3. `it('maps a missing topic to null and keeps the card key order', …)` — a flat file whose single card is `{ stableUid: 'a1', question: 'Q1' }`: `Object.keys(deck.Cards[0])` `toEqual(['StableUid','Question','Explanation','CodeSnippet','CodeLanguage','RealWorldUsage','Difficulty','OrderInDeck','Topic','Revision','Version','UpdatedAt'])` and the card `toEqual({ StableUid: 'a1', Question: 'Q1', Explanation: null, CodeSnippet: null, CodeLanguage: null, RealWorldUsage: null, Difficulty: 2, OrderInDeck: 1, Topic: null, Revision: 1, Version: 1, UpdatedAt: null })`; then reseed with the v1 shape of the same card and assert the same key list.
   4. `it('maps a non-string topic to null', …)` — three cards with `topic: 7`, `topic: null`, `topic: ['x']` → each `Topic === null`.

Estimated size: deckExport 1 line, deckRepository 2 lines, topics.ts ~20 lines, libraryMapper ~45 lines, LibraryHeader ~35 lines, LibraryScreen ~8 lines, tests ~170 + ~110 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C07.verify.sh` re-runs exactly these.

1. Scope files exist: `topics.ts`, `libraryTopics.test.ts`, `deckRepositoryTopic.test.ts`; C05 has landed (`src_C/Vpc/Db/Migrations/018_cards_topic.sql` exists and `src_C/Worker/S3/IS3DeckUploader.cs` declares `public string? Topic`).
2. Literal guards (all exit 0): `deckExport.ts` has `Topic?: string | null;` directly after `OrderInDeck: number;`; `deckRepository.ts` is 1705 lines, contains the pinned `Topic:` line exactly twice, each directly after `OrderInDeck: order,`; `topics.ts` has the four signature lines and imports nothing from react / storage / clock; `libraryMapper.ts` has `from './topics'`, `export type LibraryTopicChip = { key: string; label: string; count: number };`, `topics: LibraryTopicChip[];`, `topicFilter: string | null;`, `topic: normalizeTopic(card.Topic),`, `topic: string | null;`, the six `filters` lines byte-identical, no `SectionList`; `LibraryHeader.tsx` has the three prop lines, `testID="library-topic-chips"`, `testID={`library-topic-chip-${`, `topics.length > 0`, and still `library-filter-chip-${filterChip.key}` and `library-sheet-filter-${filterChip.key}`; `LibraryScreen.tsx` has the `useState<string | null>(null)` line, the exact `FlatList` key, `topics={vm.topics}`, `topicFilter={vm.topicFilter}`, `onSelectTopic=`, `setTopicFilter(null)`, `keyExtractor={(item) => item.stableUid}`, no `SectionList`; both test files carry every `it('…'` title above (≥ 10 and ≥ 4 `it(` blocks), `libraryTopics.test.ts` imports `fast-check` and calls `fc.assert(`, `deckRepositoryTopic.test.ts` mocks `expo-file-system/legacy` and calls `vi.resetModules()`; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any scope file; the six existing Library/repository test files are zero-diff against the base.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/libraryTopics.test.ts tests/unit/deckRepositoryTopic.test.ts tests/unit/library.test.ts tests/unit/ownedGatePredicates.test.ts tests/unit/deckRepositoryTimeouts.test.ts tests/integration/library.screen.test.tsx tests/integration/library-final.screen.test.tsx tests/integration/library-360-columns.spec.tsx --reporter=dot` — exit 0.
5. Scope + frozen + OTA guard: `git diff --numstat <merge-base> -- mobile/src/content/deckRepository.ts` is `2	0` and its `+` lines are the pinned line twice and nothing else; `git diff --quiet <merge-base> -- mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts mobile/src/features/gacha/contracts.ts mobile/src/features/gacha/library/LibraryCardTile.tsx mobile/src/features/gacha/library/libraryScreenStyles.ts mobile/src/navigation/types.ts mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup`; `"expo-updates": "~29.0.15"`, `"version": "1.6.0"` and `"vite": "7.2.4"` unchanged; no `@sentry` under `mobile/src`; every changed or untracked path under `mobile/src` / `mobile/tests` is one of the nine scope files (or `docs/delivery/r16-issues/*`); `mobile/tests/unit/libraryCardTile.test.tsx` numstat is `1	0` and its only `+` line is `topic: null,`.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C07.verify.sh
```

Runs steps 1–5 above (≈ 1–2 min; `tsc` dominates; no network). The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT extend the raw card types in `deckRepository.ts`, trim in the mapper line, or add a third line anywhere in that file — the signed exception is two identical lines, nothing else. Do NOT touch `progressSync.ts` (C14's exception) or `model.ts`.
- Do NOT append topic chips to `filters`, add a seventh status chip, or change `LibraryFilter` / `LibraryFilterChip`.
- Do NOT use `SectionList`, insert header rows into `cards`, change `keyExtractor`, or drop `numColumns`.
- Do NOT add style keys to `libraryScreenStyles.ts`, touch `LibraryCardTile.tsx` (a topic label on the tile is not in this issue), or edit `CardDetailScreen.tsx` / `cardIcon.ts` (`Tag` stays as it is).
- Do NOT read `Updates`, feature flags or remote config; do NOT add anything MCQ-shaped (Wave D).
- Do NOT edit any existing test; do NOT loosen `tsconfig.json`; do NOT run `npm install`, `npm ci`, `eas …`, `npx expo …`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import type { LibraryDeckOption, LibraryFilter, LibraryFilterChip, LibraryTopicChip } from './libraryMapper';
import { libraryStyles as styles } from './libraryScreenStyles';
import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { COLLECTION_COPY } from '../copy/collectionCopy';
import { isLargeFontScale, useFontScale } from '../../../theme/dynamicType';

// Progress ring using the classic two-half rotation trick (no SVG dep).
// Renders the unfilled portion as a hairline track and the filled
// portion as a gold arc proportional to pct (0–100). Centered child is
// the percentage label (passed via children).
function ProgressRing({ pct, fontScale, children }: { pct: number; fontScale: number; children: React.ReactNode }) {
  const SIZE = 54 * Math.max(1, fontScale);
  const STROKE = 3;
  const clamp = Math.max(0, Math.min(100, pct));
  const angle1 = clamp <= 50 ? (clamp / 50) * 180 : 180;
  const angle2 = clamp > 50 ? ((clamp - 50) / 50) * 180 : 0;
  const half = SIZE / 2;

  const ringStyle = {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  };
  const halfWrap = {
    position: 'absolute' as const,
    width: half,
    height: SIZE,
    overflow: 'hidden' as const,
  };
  const rotor = {
    position: 'absolute' as const,
    width: half,
    height: SIZE,
    overflow: 'hidden' as const,
  };
  const filledHalf = {
    position: 'absolute' as const,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: STROKE,
    borderColor: colors.gold,
    backgroundColor: 'transparent',
  };

  return (
    <View
      testID="library-progress-ring"
      style={[
        ringStyle,
        { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.softCream },
      ]}
    >
      {/* Hairline base ring (the unfilled track) */}
      <View
        pointerEvents="none"
        style={[
          ringStyle,
          {
            position: 'absolute',
            borderWidth: STROKE,
            borderColor: colors.hairline,
          },
        ]}
      />
      {/* Right half — handles 0→50% */}
      <View style={[halfWrap, { left: half, top: 0, transform: [{ translateX: 0 }] }]}>
        <View
          style={[
            rotor,
            { transform: [{ translateX: -half }, { rotate: `${angle1}deg` }, { translateX: half }] },
          ]}
        >
          <View style={[filledHalf, { left: -half }]} />
        </View>
      </View>
      {/* Left half — handles 50→100% */}
      <View style={[halfWrap, { left: 0, top: 0 }]}>
        <View
          style={[
            rotor,
            { transform: [{ translateX: half }, { rotate: `${angle2}deg` }, { translateX: -half }] },
          ]}
        >
          <View style={[filledHalf, { left: 0 }]} />
        </View>
      </View>
      {/* Inner hole — masks the inner stroke and hosts the % label */}
      <View
        style={{
          width: SIZE - STROKE * 3,
          height: SIZE - STROKE * 3,
          borderRadius: (SIZE - STROKE * 3) / 2,
          backgroundColor: colors.softCream,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

// Accessibility sizes need bounded chips that wrap; normal sizes keep the horizontal rails.
function ChipRow({ largeText, children, contentStyle, testID }: {
  largeText: boolean;
  children: React.ReactNode;
  contentStyle: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return largeText ? (
    <View testID={testID} style={[contentStyle, headerStyles.wrappedChips]}>{children}</View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={contentStyle} testID={testID}>
      {children}
    </ScrollView>
  );
}

type Props = {
  title: string;
  ownedCount: number;
  totalCount: number;
  deckOptions: LibraryDeckOption[];
  selectedDeckSlug: string;
  filters: LibraryFilterChip[];
  filter: LibraryFilter;
  filterOpen: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSelectDeck: (slug: string) => void;
  onToggleFilterOpen: () => void;
  onSelectFilter: (filter: LibraryFilter) => void;
  topics: LibraryTopicChip[];
  topicFilter: string | null;
  onSelectTopic: (key: string) => void;
  /** "Review all · N" sweep entry (economy-v2 R8). Rendered only when both are
   *  given and sweepCount > 0; the button starts a 'sweep' SessionCard run. */
  onStartSweep?: () => void;
  sweepCount?: number;
  /** "Mistakes · N" pill (K02). Rendered only when both are given and mistakeCount > 0; it opens
   *  the Mistake Book for the selected deck. */
  mistakeCount?: number;
  onOpenMistakes?: () => void;
  /** "By domain" link (D02) next to the Mistakes pill; opens Progress by domain for the selected deck.
   *  Rendered whenever given. */
  onOpenDomains?: () => void;
  /** Called when the brand-new-user banner CTA fires. Only invoked when
   *  ownedCount === 0 (i.e. user hasn't pulled any cards yet). When
   *  undefined, the banner is hidden regardless of state. */
  onOpenFirstPack?: () => void;
  /** When true, the banner copy reads "Open your first pack" (user has
   *  pulls and can go straight to Draw). When false, copy reads "Earn
   *  pulls and open your first pack" (user needs to study first to
   *  earn pulls). Caller passes wallet > 0. */
  openFirstPackHasPulls?: boolean;
};

export function LibraryHeader({
  title,
  ownedCount,
  totalCount,
  deckOptions,
  selectedDeckSlug,
  filters,
  filter,
  filterOpen,
  searchQuery = '',
  onSearchQueryChange,
  onSelectDeck,
  onToggleFilterOpen,
  onSelectFilter,
  topics,
  topicFilter,
  onSelectTopic,
  onStartSweep,
  sweepCount = 0,
  mistakeCount = 0,
  onOpenMistakes,
  onOpenDomains,
  onOpenFirstPack,
  openFirstPackHasPulls = false,
}: Props) {
  const fontScale = useFontScale();
  const largeText = isLargeFontScale(fontScale);
  const advancedFilter = filters.find((chip) => chip.key === filter && (chip.key === 'rare' || chip.key === 'legendary'));
  const activeTopic = topics.find((chip) => chip.key === topicFilter && chip.key !== 'all');
  const additionalFilterCount = Number(!!advancedFilter) + Number(!!activeTopic);
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
  // Brand-new user banner — appears above the Pokedex header when the
  // user has 0 owned cards and the deck has cards available. Gives
  // them an obvious next action instead of staring at 100 ? tiles.
  const showEmptyCollectionBanner = ownedCount === 0 && totalCount > 0 && !!onOpenFirstPack;
  const bannerTitle = openFirstPackHasPulls
    ? 'Open your first pack to start collecting'
    : 'Earn draws in a session, then open your first pack';
  const bannerA11y = openFirstPackHasPulls
    ? 'Open your first pack to start collecting'
    : 'Earn draws in a session to open your first pack';

  return (
    <View>
      {showEmptyCollectionBanner ? (
        <Pressable
          testID="library-open-first-pack-cta"
          accessibilityRole="button"
          accessibilityLabel={bannerA11y}
          style={({ pressed }) => [styles.emptyCollectionBanner, pressed && styles.pressed]}
          onPress={() => onOpenFirstPack?.()}
        >
          <View style={styles.emptyCollectionBannerTextWrap}>
            <Text style={styles.emptyCollectionBannerEyebrow} numberOfLines={largeText ? undefined : 1}>
              {COLLECTION_COPY.libraryEmptyEyebrow}
            </Text>
            <Text style={[styles.emptyCollectionBannerTitle, largeText && headerStyles.naturalLineHeight]} numberOfLines={largeText ? undefined : 2}>
              {bannerTitle}
            </Text>
          </View>
          <Text style={styles.emptyCollectionBannerArrow} numberOfLines={1}>
            →
          </Text>
        </Pressable>
      ) : null}

      {/* TOP — Pokedex-style title bar with collection counter "ring" */}
      <View testID="library-header-top-bar" style={[styles.headerTopBar, largeText && headerStyles.stackedHeader]}>
        <View style={[styles.headerTitleColumn, largeText && headerStyles.fullWidthTitle]}>
          <Text style={styles.headerEyebrow} numberOfLines={largeText ? undefined : 1}>
            {COLLECTION_COPY.libraryEyebrow}
          </Text>
          <Text testID="library-title" style={styles.title} numberOfLines={largeText ? undefined : 2}>
            {title}
          </Text>
        </View>
        {/* Collection counter — Pokeball-style ring with the ratio inside.
            testID is on the ratio Text so existing tests can read children. */}
        <View style={[styles.headerCounter, largeText && headerStyles.counterLargeText]}>
          <ProgressRing pct={pct} fontScale={fontScale}>
            <Text style={styles.headerCounterPct} numberOfLines={1}>
              {pct}%
            </Text>
          </ProgressRing>
          <Text
            testID="library-collection-bar"
            style={styles.headerCounterRatio}
            numberOfLines={largeText ? undefined : 1}
          >
            {`${ownedCount}/${totalCount}`}
          </Text>
        </View>
      </View>

      {onStartSweep && sweepCount > 0 ? (
        <Pressable
          testID="library-sweep-cta"
          accessibilityRole="button"
          accessibilityLabel="Review all learned cards"
          style={({ pressed }) => [styles.retryButton, largeText && headerStyles.roomyButton, pressed && styles.pressed]}
          onPress={onStartSweep}
        >
          <Text style={[styles.retryText, headerStyles.centredText]} numberOfLines={largeText ? undefined : 1}>
            {`Review all · ${sweepCount}`}
          </Text>
        </Pressable>
      ) : null}

      {(onOpenMistakes && mistakeCount > 0) || onOpenDomains ? (
        <View style={headerStyles.pillRow}>
          {onOpenMistakes && mistakeCount > 0 ? (
            <Pressable
              testID="library-mistakes-pill"
              accessibilityRole="button"
              accessibilityLabel={`Open Mistake Book, ${mistakeCount} mistake${mistakeCount === 1 ? '' : 's'}`}
              style={({ pressed }) => [styles.mistakesPill, largeText && headerStyles.boundedChip, pressed && styles.pressed]}
              onPress={onOpenMistakes}
            >
              <Text style={styles.mistakesPillText} numberOfLines={largeText ? undefined : 1}>
                {`Mistakes · ${mistakeCount}`}
              </Text>
            </Pressable>
          ) : null}
          {onOpenDomains ? (
            <Pressable
              testID="library-domains-link"
              accessibilityRole="button"
              accessibilityLabel="Open Progress by domain"
              style={({ pressed }) => [headerStyles.domainsLink, largeText && headerStyles.boundedChip, pressed && styles.pressed]}
              onPress={onOpenDomains}
            >
              <Text style={headerStyles.domainsLinkText} numberOfLines={largeText ? undefined : 1}>
                By domain
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Keep the compact horizontal switcher; accessibility sizes wrap below the title. */}
      {deckOptions.length > 1 ? (
        <ChipRow
          largeText={largeText}
          contentStyle={styles.deckSwitcherScroll}
          testID="library-deck-switcher"
        >
          {deckOptions.map((option) => {
            const active = option.slug === selectedDeckSlug;
            return (
              <Pressable
                key={option.slug}
                testID={`library-deck-${option.slug}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.deckChip,
                  largeText && headerStyles.boundedChip,
                  active && styles.deckChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectDeck(option.slug)}
              >
                <Text style={[styles.deckChipText, active && styles.deckChipTextActive]} numberOfLines={largeText ? undefined : 1}>
                  {option.title}
                </Text>
              </Pressable>
            );
          })}
        </ChipRow>
      ) : null}


      <TextInput
        testID="library-search"
        accessibilityLabel="Search cards by question, card number or ID"
        placeholder="Search question, #number or ID"
        placeholderTextColor={colors.inkMuted}
        value={searchQuery}
        onChangeText={onSearchQueryChange}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={headerStyles.search}
      />
      <ChipRow largeText={largeText} contentStyle={styles.filterChipsRow} testID="library-filter-chips">
        {filters.filter((chip) => chip.key !== 'rare' && chip.key !== 'legendary').map((chip) => {
          const active = chip.key === filter;
          return (
            <Pressable
              key={chip.key}
              testID={`library-filter-chip-${chip.key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.filterChip, largeText && headerStyles.boundedChip, active && styles.filterChipActive, pressed && styles.pressed]}
              onPress={() => onSelectFilter(chip.key)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={largeText ? undefined : 1}>
                {active ? `${chip.label} · ${chip.count}` : chip.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          testID="library-filter-summary"
          accessibilityRole="button"
          accessibilityState={{ expanded: filterOpen, selected: additionalFilterCount > 0 }}
          accessibilityLabel={filterOpen ? 'Hide topics and advanced filters' : 'Show topics and advanced filters'}
          style={({ pressed }) => [styles.filterChip, largeText && headerStyles.boundedChip, additionalFilterCount > 0 && styles.filterChipActive, pressed && styles.pressed]}
          onPress={onToggleFilterOpen}
        >
          <Text style={[styles.filterChipText, additionalFilterCount > 0 && styles.filterChipTextActive]}>
            {filterOpen ? 'Hide filters' : `More filters${additionalFilterCount ? ` · ${additionalFilterCount} active` : ''}`}
          </Text>
        </Pressable>
      </ChipRow>
      {!filterOpen && additionalFilterCount > 0 ? (
        <View testID="library-active-filters" style={headerStyles.pillRow}>
          {activeTopic ? (
            <Pressable
              testID="library-clear-topic"
              accessibilityRole="button"
              accessibilityLabel={`Clear topic filter: ${activeTopic.label}`}
              style={({ pressed }) => [styles.filterChip, headerStyles.activeCriterion, pressed && styles.pressed]}
              onPress={() => onSelectTopic('all')}
            >
              <Text style={styles.filterChipText}>{`Topic: ${activeTopic.label} · Clear`}</Text>
            </Pressable>
          ) : null}
          {advancedFilter ? (
            <Pressable
              testID="library-clear-rarity"
              accessibilityRole="button"
              accessibilityLabel={`Clear rarity filter: ${advancedFilter.label}`}
              style={({ pressed }) => [styles.filterChip, headerStyles.activeCriterion, pressed && styles.pressed]}
              onPress={() => onSelectFilter('all')}
            >
              <Text style={styles.filterChipText}>{`${advancedFilter.label} · Clear`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {filterOpen ? (
        <View style={headerStyles.moreFilters} testID="library-filter-sheet">
          {topics.length > 0 ? <Text style={headerStyles.filterLabel}>Topic</Text> : null}
          {topics.length > 0 ? (
            <ChipRow
              largeText={largeText}
              contentStyle={styles.filterChipsRow}
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
                      largeText && headerStyles.boundedChip,
                      active && styles.filterChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => onSelectTopic(chip.key)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={largeText ? undefined : 1}>
                      {active ? `${chip.label} · ${chip.count}` : chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ChipRow>
          ) : null}

          <Text style={headerStyles.filterLabel}>Rarity</Text>
          <View style={headerStyles.pillRow}>
            {filters.filter((chip) => chip.key === 'rare' || chip.key === 'legendary').map((chip) => (
              <Pressable
                key={`sheet-${chip.key}`}
                testID={`library-sheet-filter-${chip.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: chip.key === filter }}
                style={({ pressed }) => [styles.filterChip, largeText && headerStyles.boundedChip, chip.key === filter && styles.filterChipActive, pressed && styles.pressed]}
                onPress={() => onSelectFilter(chip.key)}
              >
                <Text style={[styles.filterChipText, chip.key === filter && styles.filterChipTextActive]}>
                  {`${chip.label} · ${chip.count}`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Kept here rather than in libraryScreenStyles: only the header's pill row uses them.
const headerStyles = StyleSheet.create({
  stackedHeader: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  fullWidthTitle: { flex: undefined, paddingRight: 0 },
  counterLargeText: { alignSelf: 'flex-start', maxWidth: '100%' },
  wrappedChips: { flexWrap: 'wrap', paddingRight: 0 },
  boundedChip: { maxWidth: '100%', paddingVertical: spacing.xs },
  roomyButton: { paddingVertical: spacing.xs },
  naturalLineHeight: { lineHeight: undefined },
  centredText: { textAlign: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  search: {
    minHeight: a11y.minTouch, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: 12, backgroundColor: colors.softCream, paddingHorizontal: spacing.sm,
    color: colors.ink, fontSize: typography.bodySmall, marginTop: spacing.sm,
  },
  moreFilters: { paddingVertical: spacing.sm },
  activeCriterion: { flexShrink: 1 },
  filterLabel: { color: colors.inkSecondary, fontSize: typography.caption, marginBottom: spacing.xs },
  domainsLink: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
  },
  domainsLinkText: {
    color: colors.ink,
    fontSize: typography.bodySmall,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
});

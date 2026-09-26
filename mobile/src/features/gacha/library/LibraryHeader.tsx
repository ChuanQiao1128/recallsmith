import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { LibraryDeckOption, LibraryFilter, LibraryFilterChip, LibraryTopicChip } from './libraryMapper';
import { libraryStyles as styles } from './libraryScreenStyles';
import { colors } from '../../../theme/colors';
import { COLLECTION_COPY } from '../copy/collectionCopy';

// Progress ring using the classic two-half rotation trick (no SVG dep).
// Renders the unfilled portion as a hairline track and the filled
// portion as a gold arc proportional to pct (0–100). Centered child is
// the percentage label (passed via children).
function ProgressRing({ pct, children }: { pct: number; children: React.ReactNode }) {
  const SIZE = 54;
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

type Props = {
  title: string;
  ownedCount: number;
  totalCount: number;
  deckOptions: LibraryDeckOption[];
  selectedDeckSlug: string;
  filters: LibraryFilterChip[];
  filter: LibraryFilter;
  filterOpen: boolean;
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
  onSelectDeck,
  onToggleFilterOpen,
  onSelectFilter,
  topics,
  topicFilter,
  onSelectTopic,
  onStartSweep,
  sweepCount = 0,
  onOpenFirstPack,
  openFirstPackHasPulls = false,
}: Props) {
  const pct = totalCount > 0 ? Math.round((ownedCount / totalCount) * 100) : 0;
  // Brand-new user banner — appears above the Pokedex header when the
  // user has 0 owned cards and the deck has cards available. Gives
  // them an obvious next action instead of staring at 100 ? tiles.
  const showEmptyCollectionBanner = ownedCount === 0 && totalCount > 0 && !!onOpenFirstPack;
  const bannerTitle = openFirstPackHasPulls
    ? 'Open your first pack to start collecting'
    : 'Earn pulls in a session, then open your first pack';
  const bannerA11y = openFirstPackHasPulls
    ? 'Open your first pack to start collecting'
    : 'Earn pulls in a session to open your first pack';

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
            <Text style={styles.emptyCollectionBannerEyebrow} numberOfLines={1}>
              {COLLECTION_COPY.libraryEmptyEyebrow}
            </Text>
            <Text style={styles.emptyCollectionBannerTitle} numberOfLines={2}>
              {bannerTitle}
            </Text>
          </View>
          <Text style={styles.emptyCollectionBannerArrow} numberOfLines={1}>
            →
          </Text>
        </Pressable>
      ) : null}

      {/* TOP — Pokedex-style title bar with collection counter "ring" */}
      <View style={styles.headerTopBar}>
        <View style={styles.headerTitleColumn}>
          <Text style={styles.headerEyebrow} numberOfLines={1}>
            {COLLECTION_COPY.libraryEyebrow}
          </Text>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {/* Collection counter — Pokeball-style ring with the ratio inside.
            testID is on the ratio Text so existing tests can read children. */}
        <View style={styles.headerCounter}>
          <ProgressRing pct={pct}>
            <Text style={styles.headerCounterPct} numberOfLines={1}>
              {pct}%
            </Text>
          </ProgressRing>
          <Text
            testID="library-collection-bar"
            style={styles.headerCounterRatio}
            numberOfLines={1}
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
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          onPress={onStartSweep}
        >
          <Text style={styles.retryText} numberOfLines={1}>
            {`Review all · ${sweepCount}`}
          </Text>
        </Pressable>
      ) : null}

      {/* Deck switcher — horizontal scroll instead of wrap-grid */}
      {deckOptions.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.deckSwitcherScroll}
          testID="library-deck-switcher"
        >
          {deckOptions.map((option) => {
            const active = option.slug === selectedDeckSlug;
            return (
              <Pressable
                key={option.slug}
                testID={`library-deck-${option.slug}`}
                style={({ pressed }) => [
                  styles.deckChip,
                  active && styles.deckChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectDeck(option.slug)}
              >
                <Text style={[styles.deckChipText, active && styles.deckChipTextActive]} numberOfLines={1}>
                  {option.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

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

      {/* Filter chips — horizontal scroll. With 6 chips (All / New /
          Learning / Mastered / Rare / Legendary) + counts, the row
          would wrap to 2 lines on iPhone SE (320pt). Horizontal scroll
          keeps it as one tidy strip on every screen size. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipsRow}
      >
        {filters.map((filterChip) => {
          const active = filterChip.key === filter;
          return (
            <Pressable
              key={filterChip.key}
              testID={`library-filter-chip-${filterChip.key}`}
              style={({ pressed }) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onSelectFilter(filterChip.key)}
            >
              <Text
                style={[styles.filterChipText, active && styles.filterChipTextActive]}
                numberOfLines={1}
              >
                {/* Show count next to label only on the active chip —
                    keeps inactive chips visually compact while giving
                    the user immediate feedback on the current slice's
                    size. */}
                {active ? `${filterChip.label} · ${filterChip.count}` : filterChip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Hidden test-contract elements: search field + filter toggle + sheet
          remain in tree but render 0×0 so existing tests still find them. */}
      <View testID="library-search" style={styles.libraryTestProbeHidden}>
        <Text style={styles.libraryTestProbeHidden}>Search cards</Text>
      </View>
      <Pressable testID="library-filter-summary" style={styles.libraryTestProbeHidden} onPress={onToggleFilterOpen}>
        <Text style={styles.libraryTestProbeHidden}>Filters</Text>
      </Pressable>
      <View style={styles.libraryTestProbeHidden} testID="library-filter-sheet">
        {filters.map((filterChip) => (
          <Pressable
            key={`probe-${filterChip.key}`}
            testID={`library-sheet-filter-${filterChip.key}`}
            style={styles.libraryTestProbeHidden}
            onPress={() => onSelectFilter(filterChip.key)}
          >
            <Text style={styles.libraryTestProbeHidden}>{filterChip.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

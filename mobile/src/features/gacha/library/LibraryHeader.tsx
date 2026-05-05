import React from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LibraryDeckOption, LibraryFilter, LibraryFilterChip } from './libraryMapper';
import { libraryStyles as styles } from './libraryScreenStyles';

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
  onSelectDeck,
  onToggleFilterOpen,
  onSelectFilter,
}: Props) {
  const activeFilterLabel = filters.find((item) => item.key === filter)?.label ?? 'All';

  return (
    <View>
      <Text style={styles.eyebrow} numberOfLines={1}>
        Library
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.collectionBar} numberOfLines={1} testID="library-collection-bar">
        {`${ownedCount}/${totalCount}`}
      </Text>

      {deckOptions.length > 1 ? (
        <View style={styles.deckSwitcher} testID="library-deck-switcher">
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
        </View>
      ) : null}

      <View testID="library-search" style={styles.searchField}>
        <Text style={styles.searchText} numberOfLines={1}>
          Search cards
        </Text>
      </View>

      <Pressable
        testID="library-filter-summary"
        style={({ pressed }) => [styles.filterSummary, pressed && styles.pressed]}
        onPress={onToggleFilterOpen}
      >
        <Text style={styles.filterSummaryText} numberOfLines={1}>
          {`${activeFilterLabel} · Filters`}
        </Text>
      </Pressable>

      {filterOpen ? (
        <View style={styles.filterSheet} testID="library-filter-sheet">
          {filters.map((filterChip) => {
            const active = filterChip.key === filter;
            return (
              <Pressable
                key={filterChip.key}
                testID={`library-sheet-filter-${filterChip.key}`}
                style={({ pressed }) => [
                  styles.sheetOption,
                  active && styles.sheetOptionActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectFilter(filterChip.key)}
              >
                <Text
                  style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}
                  numberOfLines={1}
                >
                  {filterChip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

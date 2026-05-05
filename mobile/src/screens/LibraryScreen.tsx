import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import { listManifestDecks, resolveDeckBySlug } from '../content/deckRepository';
import { loadDeckProgress } from '../review/storage';
import {
  buildLibraryVM,
  type LibraryDeckOption,
  type LibraryFilter,
  type LibraryViewModel,
} from '../features/gacha/library/libraryMapper';
import { LibraryHeader } from '../features/gacha/library/LibraryHeader';
import { LibraryCardTile } from '../features/gacha/library/LibraryCardTile';
import { libraryStyles as styles } from '../features/gacha/library/libraryScreenStyles';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

export function LibraryScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const listRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckOptions, setDeckOptions] = useState<LibraryDeckOption[]>([]);
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [highlightedUid, setHighlightedUid] = useState<string | null>(null);

  const numColumns = width < 390 ? 2 : 3;

  const refresh = useCallback(
    async (preferredSlug?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const manifest = await listManifestDecks();
        const options = manifest
          .filter((entry) => String(entry.availability ?? 'live').toLowerCase() !== 'retired')
          .map((entry) => ({ slug: entry.slug, title: entry.title ?? entry.slug }));

        setDeckOptions(options);

        const currentSlug =
          preferredSlug ?? selectedSlug ?? (await loadActiveDeckSlug()) ?? options[0]?.slug ?? null;

        if (!currentSlug) {
          throw new Error('No deck available yet. Install one first.');
        }

        const resolvedDeck = await resolveDeckBySlug(currentSlug);
        if (!resolvedDeck) {
          throw new Error('Deck is not installed yet. Open Deck to install or update.');
        }

        const resolvedProgress = await loadDeckProgress(resolvedDeck);
        await setActiveDeckSlug(currentSlug);

        setSelectedSlug(currentSlug);
        setDeck(resolvedDeck);
        setProgress(resolvedProgress);
      } catch (loadErr: any) {
        setDeckOptions([]);
        setDeck(null);
        setProgress([]);
        setError(loadErr?.message ?? 'Failed to load library.');
      } finally {
        setLoading(false);
      }
    },
    [selectedSlug],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh(route.params?.focusSlug ?? null);
    }, [refresh, route.params?.focusSlug]),
  );

  const vm: LibraryViewModel | null = useMemo(() => {
    if (!deck) return null;
    return buildLibraryVM({
      deck,
      progress,
      filter,
      now: new Date(),
      decks: deckOptions,
      selectedDeckSlug: selectedSlug,
    });
  }, [deck, progress, filter, deckOptions, selectedSlug]);

  const visibleCards = vm?.cards ?? [];

  useEffect(() => {
    if (!vm || !route.params?.scrollToNew) return;
    const targetIndex = visibleCards.findIndex((card) => card.status === 'new');
    if (targetIndex < 0) return;

    const targetUid = visibleCards[targetIndex]?.stableUid;
    if (!targetUid) return;

    listRef.current?.scrollToIndex?.({ index: targetIndex, animated: true });
    setHighlightedUid(targetUid);

    const timer = setTimeout(() => {
      setHighlightedUid((prev) => (prev === targetUid ? null : prev));
    }, 1500);
    return () => clearTimeout(timer);
  }, [route.params?.scrollToNew, visibleCards, vm]);

  const ownedCount = vm ? vm.counts.learningCount + vm.counts.masteredCount : 0;
  const totalCount = vm ? vm.counts.newCount + vm.counts.learningCount + vm.counts.masteredCount : 0;
  const isCollectionComplete = filter === 'new' && vm?.counts.newCount === 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-library-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading your library...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (error || !vm) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-library-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <Text style={styles.errorTitle} numberOfLines={2}>
              Library unavailable
            </Text>
            <Text style={styles.errorBody} numberOfLines={2}>
              {error ?? 'Unable to read your deck right now.'}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              onPress={() => {
                void refresh();
              }}
            >
              <Text style={styles.retryText} numberOfLines={1}>
                Retry
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-library-root">
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.primarySurface} testID="screen-library-primary-surface">
          <FlatList
            ref={listRef}
            data={visibleCards}
            key={`${numColumns}-${filter}-${selectedSlug ?? 'none'}`}
            numColumns={numColumns}
            testID="library-card-grid"
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrap : undefined}
            ListHeaderComponent={
              <LibraryHeader
                title={vm.title}
                ownedCount={ownedCount}
                totalCount={totalCount}
                deckOptions={deckOptions}
                selectedDeckSlug={vm.selectedDeckSlug}
                filters={vm.filters}
                filter={filter}
                filterOpen={filterOpen}
                onSelectDeck={(slug) => {
                  void refresh(slug);
                }}
                onToggleFilterOpen={() => setFilterOpen((open) => !open)}
                onSelectFilter={(nextFilter) => {
                  setFilter(nextFilter);
                  setFilterOpen(false);
                }}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState} testID="library-empty-state">
                <Text style={styles.errorTitle} numberOfLines={2}>
                  {isCollectionComplete ? 'Collection complete' : 'Nothing matches'}
                </Text>
                <Text style={styles.errorBody} numberOfLines={2}>
                  {isCollectionComplete
                    ? "You've got every card in this pack."
                    : 'Try clearing the filter or pick another deck.'}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                  onPress={() => setFilter('all')}
                  testID="library-empty-cta"
                >
                  <Text style={styles.retryText} numberOfLines={1}>
                    {isCollectionComplete ? 'Back to all' : 'Reset filters'}
                  </Text>
                </Pressable>
              </View>
            }
            keyExtractor={(item) => item.stableUid}
            renderItem={({ item }) => (
              <LibraryCardTile
                item={item}
                numColumns={numColumns}
                highlighted={highlightedUid === item.stableUid}
                onPress={(stableUid) => navigation.navigate('CardDetail', { cardId: stableUid })}
              />
            )}
          />
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default LibraryScreen;

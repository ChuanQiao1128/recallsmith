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
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

export function LibraryScreen({ navigation, route }: Props) {
  const { width } = useWindowDimensions();
  const listRef = useRef<any>(null);
  // Debounce — when the user rapidly tab-swaps to Library and back,
  // skip refetching if the last successful refresh was within 1.5s.
  // Eliminates the spinner-flash on quick tab swap UX.
  const lastRefreshAtRef = useRef<number>(0);
  const REFRESH_DEBOUNCE_MS = 1500;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckOptions, setDeckOptions] = useState<LibraryDeckOption[]>([]);
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [highlightedUid, setHighlightedUid] = useState<string | null>(null);
  // Wallet state — drives the empty-collection banner's CTA target.
  // wallet=0 → banner sends user to SessionCard (earn pulls first);
  // wallet>0 → banner sends user to Draw (open the pack now).
  const [walletPulls, setWalletPulls] = useState<number>(0);

  const numColumns = width < 390 ? 2 : 3;

  useEffect(() => {
    let cancelled = false;
    loadRewardWalletState()
      .then((wallet) => {
        if (cancelled) return;
        const total =
          Math.max(0, Number(wallet.availablePulls ?? 0) || 0) +
          Math.max(0, Number(wallet.reservePulls ?? 0) || 0);
        setWalletPulls(total);
      })
      .catch(() => {
        /* default 0 is fine for the banner CTA decision */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        lastRefreshAtRef.current = Date.now();
      }
    },
    [selectedSlug],
  );

  useFocusEffect(
    useCallback(() => {
      // Skip refetch if user was just here (within 1.5s). Eliminates
      // spinner-flash on rapid tab-swaps. Force refresh when caller
      // passes focusSlug (e.g. routed back from Draw with new card).
      const focusSlug = route.params?.focusSlug ?? null;
      const sinceLast = Date.now() - lastRefreshAtRef.current;
      if (!focusSlug && sinceLast < REFRESH_DEBOUNCE_MS && lastRefreshAtRef.current > 0) {
        return;
      }
      void refresh(focusSlug);
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
    // Guard against the FlatList not having rendered the new data yet —
    // findIndex returns an index into our new array, but RN's internal
    // ListView may still be on the old (smaller) dataset for one frame.
    if (targetIndex < 0 || targetIndex >= visibleCards.length) return;

    const targetUid = visibleCards[targetIndex]?.stableUid;
    if (!targetUid) return;

    setHighlightedUid(targetUid);
    // Defer the scroll one tick — by the time this runs, the FlatList has
    // committed the new data prop and scrollToIndex's internal range matches.
    const scrollTimer = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex?.({
          index: targetIndex,
          animated: true,
          viewPosition: 0.3,
        });
      } catch {
        /* swallowed — onScrollToIndexFailed will retry */
      }
    }, 60);

    const highlightTimer = setTimeout(() => {
      setHighlightedUid((prev) => (prev === targetUid ? null : prev));
    }, 1500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(highlightTimer);
    };
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
            // Per RN docs: scrollToIndex can fail when the target hasn't been
            // measured yet (offscreen rows). Recover via offset estimation +
            // retry, instead of throwing an Invariant Violation.
            onScrollToIndexFailed={(info) => {
              const ROW_HEIGHT_GUESS = 132;
              const offset = (info.index / Math.max(numColumns, 1)) * ROW_HEIGHT_GUESS;
              listRef.current?.scrollToOffset?.({ offset, animated: true });
              setTimeout(() => {
                if (info.index < visibleCards.length) {
                  listRef.current?.scrollToIndex?.({
                    index: info.index,
                    animated: true,
                    viewPosition: 0.3,
                  });
                }
              }, 120);
            }}
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
                // Brand-new user CTA — banner only renders when
                // ownedCount === 0. Wallet-aware routing:
                //   wallet > 0 → Draw (open the pack right now)
                //   wallet = 0 → SessionCard (earn pulls first)
                // Avoids a useless bounce through Draw → "Earn pulls"
                // → SessionCard for users who haven't earned anything.
                onOpenFirstPack={() => {
                  if (walletPulls > 0) {
                    navigation.navigate('Draw', { slug: vm.selectedDeckSlug });
                  } else {
                    navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug });
                  }
                }}
                openFirstPackHasPulls={walletPulls > 0}
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
                deckSlug={vm.selectedDeckSlug}
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

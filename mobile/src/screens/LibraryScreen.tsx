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
import { goHome } from '../navigation/tabNavigation';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import { getFeatureFlags } from '../config/featureFlags';
import { checkManifestForUpdates, listManifestDecks } from '../content/deckRepository';
import { getCachedDeck, installDeckAndInvalidate } from '../content/deckCache';
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
import { resolveEffectiveOwned } from '../features/gacha/draw/effectiveOwned';
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
  // Mirrors the currently displayed deck for the refresh closure, which needs
  // to know synchronously whether a deck is already on screen (stale state
  // would lie on the second focus). Kept equal to `deck` at every setDeck.
  const deckRef = useRef<DeckExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  // Which cards this account holds, drawn plus grandfathered. Kept next to
  // `progress` and replaced with it in the same refresh, because the VM reads
  // both and a half-updated pair renders a deck from one account against a
  // collection from another for a frame.
  const [ownedSet, setOwnedSet] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  // A pull grants ten cards; highlighting one of them was never the ask.
  const [highlightedUids, setHighlightedUids] = useState<readonly string[]>([]);
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
      // Stale-while-revalidate: only the first load (nothing on screen yet)
      // shows the full-screen spinner. Later refreshes keep the mounted grid.
      if (deckRef.current === null) setLoading(true);
      setError(null);
      let requestedSlug: string | null = null;
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
        requestedSlug = currentSlug;

        let resolvedDeck = await getCachedDeck(currentSlug);
        if (!resolvedDeck) {
          const updates = await checkManifestForUpdates(false);
          const update = updates[currentSlug];
          if (!update?.remoteUrl) {
            throw new Error('This deck is not available on this device yet.');
          }
          const installed = await installDeckAndInvalidate(
            currentSlug,
            update.remoteUrl,
            update.remoteVersion,
            update.remoteSha256,
          ).catch(() => false);
          resolvedDeck = installed ? await getCachedDeck(currentSlug) : null;
          if (!resolvedDeck) {
            throw new Error('Install failed. Check your connection and retry.');
          }
        }

        const resolvedProgress = await loadDeckProgress(resolvedDeck);
        const resolvedOwned = await resolveEffectiveOwned(currentSlug, resolvedProgress);
        await setActiveDeckSlug(currentSlug);

        setSelectedSlug(currentSlug);
        deckRef.current = resolvedDeck;
        setDeck(resolvedDeck);
        setProgress(resolvedProgress);
        setOwnedSet(resolvedOwned);
      } catch (loadErr: any) {
        // Never wipe the deck switcher: keep whatever options loaded so an
        // offline user can still reach their other installed decks.
        if (
          deckRef.current !== null &&
          requestedSlug !== null &&
          deckRef.current.Slug === requestedSlug
        ) {
          // A background refresh of the deck already on screen failed — keep
          // the stale-but-usable grid and stay silent.
        } else {
          deckRef.current = null;
          setDeck(null);
          setProgress([]);
          setOwnedSet(null);
          setError(loadErr?.message ?? 'Failed to load library.');
        }
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
      ownedSet,
      topicFilter,
      mcqEnabled: getFeatureFlags().mcq.enabled,
    });
  }, [deck, progress, filter, deckOptions, selectedSlug, ownedSet, topicFilter]);

  const visibleCards = vm?.cards ?? [];

  const requestedUids = route.params?.highlightUids;

  useEffect(() => {
    if (!vm) return;

    // Caller-named cards win. The status-based search below is a guess about
    // what the caller meant, and after a draw it guesses wrong: "first card
    // with status 'new'" means first *unstudied* card, which in a fresh deck
    // is #001 whatever you just pulled.
    const named = (Array.isArray(requestedUids) ? requestedUids : []).filter(
      (uid): uid is string => typeof uid === 'string' && uid.length > 0,
    );
    const present = named.filter((uid) => visibleCards.some((card) => card.stableUid === uid));

    let targets: string[] = present;
    if (named.length === 0) {
      // No names given (deep link, tab swap): keep the old heuristic, which
      // is still the best available answer to "show me something new".
      if (!route.params?.scrollToNew) return;
      const firstNew = visibleCards.find((card) => card.status === 'new');
      targets = firstNew ? [firstNew.stableUid] : [];
    }
    if (targets.length === 0) return;

    // Scroll to the first named card that survived the current filter, not
    // to the first named card outright: a filtered-out uid has no row.
    const targetIndex = visibleCards.findIndex((card) => card.stableUid === targets[0]);
    // Guard against the FlatList not having rendered the new data yet —
    // findIndex returns an index into our new array, but RN's internal
    // ListView may still be on the old (smaller) dataset for one frame.
    if (targetIndex < 0 || targetIndex >= visibleCards.length) return;

    setHighlightedUids(targets);
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
      setHighlightedUids((prev) => (prev === targets ? [] : prev));
    }, 1500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(highlightTimer);
    };
  }, [requestedUids, route.params?.scrollToNew, visibleCards, vm]);

  // Both read straight off the VM now. The old arithmetic ("learned + mastered
  // over everything") was a proxy from before the app knew what a collection
  // was, and it answered the header's question wrong in both directions: a card
  // you had just pulled did not count as owned until you studied it, and once
  // gated the same sum would have excluded every missing card from the total
  // as well, pinning the ring at 100%.
  const ownedCount = vm?.counts.ownedCount ?? 0;
  const totalCount = vm?.counts.totalCount ?? 0;
  // "You've got every card in this pack" now has to mean it. An empty New
  // filter used to imply a finished deck, because ungated every card was either
  // new or studied; gated it only says "nothing you hold is unstudied", which
  // is true of someone holding two cards of a hundred. The second clause is
  // what keeps the empty state from congratulating them on a collection they
  // have barely started.
  const isCollectionComplete =
    filter === 'new' && vm?.counts.newCount === 0 && ownedCount === totalCount && totalCount > 0;

  if (loading && !deck) {
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
          <View style={styles.centerState} testID="library-unavailable-state">
            <Text style={styles.errorTitle} numberOfLines={2}>
              Library unavailable
            </Text>
            <Text style={styles.errorBody} numberOfLines={2}>
              {error ?? 'Unable to read your deck right now.'}
            </Text>
            {deckOptions.length > 1 ? (
              <View style={styles.errorDeckSwitcher} testID="library-error-deck-switcher">
                {deckOptions.map((option) => (
                  <Pressable
                    key={option.slug}
                    style={({ pressed }) => [styles.errorDeckChip, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.slug === selectedSlug }}
                    onPress={() => {
                      void refresh(option.slug);
                    }}
                    testID={`library-error-deck-${option.slug}`}
                  >
                    <Text style={styles.errorDeckChipText} numberOfLines={1}>
                      {option.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              onPress={() => {
                void refresh();
              }}
              testID="library-unavailable-retry"
            >
              <Text style={styles.retryText} numberOfLines={1}>
                Retry
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              onPress={() => goHome(navigation)}
              testID="library-unavailable-home-cta"
            >
              <Text style={styles.retryText} numberOfLines={1}>
                Go to Home
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
            key={`${numColumns}-${filter}-${topicFilter ?? 'all'}-${selectedSlug ?? 'none'}`}
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
                topics={vm.topics}
                topicFilter={vm.topicFilter}
                onSelectTopic={(key) => setTopicFilter(key === 'all' ? null : key)}
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
                sweepCount={vm.counts.learningCount + vm.counts.masteredCount}
                onStartSweep={() => navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug, mode: 'sweep' })}
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
                  onPress={() => { setFilter('all'); setTopicFilter(null); }}
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
                highlighted={highlightedUids.includes(item.stableUid)}
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

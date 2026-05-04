import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
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
  type LibraryCardBadgeTone,
  type LibraryDeckOption,
  type LibraryFilter,
  type LibraryViewModel,
} from '../features/gacha/library/libraryMapper';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

type LibraryHeaderProps = {
  vm: LibraryViewModel;
  onSelectDeck: (slug: string) => void;
  onSelectFilter: (filter: LibraryFilter) => void;
};

function LibraryHeader({ vm, onSelectDeck, onSelectFilter }: LibraryHeaderProps) {
  return (
    <View>
      <Text style={styles.eyebrow} numberOfLines={1}>
        Library
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {vm.title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {vm.subtitle}
      </Text>
      {vm.decks.length > 1 ? (
        <View style={styles.deckSwitcher} testID="library-deck-switcher">
          {vm.decks.map((deckOption) => {
            const selectedDeck = deckOption.slug === vm.selectedDeckSlug;
            return (
              <Pressable
                key={deckOption.slug}
                testID={`library-deck-${deckOption.slug}`}
                style={({ pressed }) => [
                  styles.deckChip,
                  selectedDeck && styles.deckChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelectDeck(deckOption.slug)}
              >
                <Text style={[styles.deckChipText, selectedDeck && styles.deckChipTextActive]} numberOfLines={1}>
                  {deckOption.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.filterRow}>
        {vm.filters.map((chip) => {
          const selected = chip.key === vm.filter;
          return (
            <Pressable
              key={chip.key}
              testID={`library-filter-${chip.key}`}
              style={({ pressed }) => [
                styles.filterChip,
                selected && styles.filterChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onSelectFilter(chip.key)}
            >
              <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]} numberOfLines={1}>
                {chip.label}
              </Text>
              <Text style={[styles.filterChipCount, selected && styles.filterChipTextActive]} numberOfLines={1}>
                {chip.count}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function getStatusBadgeToneStyle(tone: LibraryCardBadgeTone) {
  if (tone === 'new') return styles.statusBadgeNew;
  if (tone === 'learning') return styles.statusBadgeLearning;
  return styles.statusBadgeMastered;
}

export function LibraryScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckOptions, setDeckOptions] = useState<LibraryDeckOption[]>([]);
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const numColumns = width < 390 ? 2 : 3;
  const refresh = useCallback(
    async (preferredSlug?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const manifest = await listManifestDecks();
        const options = manifest
          .filter((entry) => String(entry.availability ?? 'live').toLowerCase() !== 'retired')
          .map((entry) => ({
            slug: entry.slug,
            title: entry.title ?? entry.slug,
          }));
        setDeckOptions(options);
        const currentSlug =
          preferredSlug ??
          selectedSlug ??
          (await loadActiveDeckSlug()) ??
          options[0]?.slug ??
          null;
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
      } catch (e: any) {
        setDeckOptions([]);
        setDeck(null);
        setProgress([]);
        setError(e?.message ?? 'Failed to load library.');
      } finally {
        setLoading(false);
      }
    },
    [selectedSlug],
  );
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
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
              onPress={() => void refresh()}
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
            data={vm.cards}
            key={`${numColumns}-${vm.filter}-${selectedSlug ?? 'none'}`}
            numColumns={numColumns}
            testID="library-card-grid"
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrap : undefined}
            ListHeaderComponent={
              <LibraryHeader
                vm={vm}
                onSelectDeck={(slug) => void refresh(slug)}
                onSelectFilter={setFilter}
              />
            }
            ListEmptyComponent={(
              <View style={styles.emptyState} testID="library-empty-state">
                <Text style={styles.errorTitle} numberOfLines={2}>
                  {vm.filter === 'all' ? 'No cards in this library yet' : `No ${vm.filter} cards yet`}
                </Text>
                <Text style={styles.errorBody} numberOfLines={2}>
                  {vm.filter === 'all'
                    ? 'Open deck to install or update content, then return here to browse.'
                    : 'Switch back to All to browse every owned card.'}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                  onPress={() => {
                    if (vm.filter === 'all') {
                      navigation.navigate('Deck');
                      return;
                    }
                    setFilter('all');
                  }}
                  testID="library-empty-cta"
                >
                  <Text style={styles.retryText} numberOfLines={1}>
                    {vm.filter === 'all' ? 'Install a deck' : 'Show all cards'}
                  </Text>
                </Pressable>
              </View>
            )}
            keyExtractor={(item) => item.stableUid}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.card,
                  numColumns === 2 ? styles.cardTwoColumns : styles.cardThreeColumns,
                ]}
                testID={`library-card-${item.stableUid}`}
                onPress={() => navigation.navigate('CardDetail', { cardId: item.stableUid })}
              >
                <Text style={styles.cardQuestion} numberOfLines={2}>
                  {item.question}
                </Text>
                <View style={styles.badgeRow}>
                  <View
                    style={[styles.statusBadge, getStatusBadgeToneStyle(item.badgeTone)]}
                    testID={`library-card-status-${item.stableUid}`}
                  >
                    <Text style={styles.statusBadgeText} numberOfLines={1}>
                      {item.statusLabel}
                    </Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}
export default LibraryScreen;
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  primarySurface: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.screenPadding, paddingBottom: spacing.xl },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  loadingText: { marginTop: spacing.sm, fontSize: typography.bodySmall, color: colors.inkSecondary },
  errorTitle: { fontSize: typography.title3, color: colors.ink, fontWeight: '800', textAlign: 'center' },
  errorBody: { marginTop: spacing.sm, fontSize: typography.bodySmall, color: colors.inkSecondary, textAlign: 'center' },
  retryButton: { marginTop: spacing.md, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: spacing.buttonRadius, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: colors.parchmentBg, fontSize: typography.button, fontWeight: '800' },
  emptyState: { marginTop: spacing.lg, borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: colors.inkSecondary, backgroundColor: colors.parchmentBg, paddingHorizontal: spacing.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.9 },
  eyebrow: { fontSize: typography.caption, color: colors.gold, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: spacing.xs, fontSize: typography.title2, color: colors.ink, fontWeight: '900' },
  subtitle: { marginTop: spacing.xs, fontSize: typography.bodySmall, color: colors.inkSecondary },
  deckSwitcher: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  deckChip: { minHeight: 44, minWidth: 92, paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.inkSecondary, backgroundColor: colors.parchmentBg, alignItems: 'center', justifyContent: 'center' },
  deckChipActive: { borderColor: colors.ink, backgroundColor: colors.ink },
  deckChipText: { color: colors.ink, fontSize: typography.caption, fontWeight: '800' },
  deckChipTextActive: { color: colors.parchmentBg },
  filterRow: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filterChip: { minHeight: 44, minWidth: 78, paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.inkSecondary, backgroundColor: colors.parchmentBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  filterChipActive: { borderColor: colors.ink, backgroundColor: colors.ink },
  filterChipText: { color: colors.ink, fontSize: typography.caption, fontWeight: '800' },
  filterChipCount: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700' },
  filterChipTextActive: { color: colors.parchmentBg },
  columnWrap: { justifyContent: 'space-between', marginBottom: spacing.xs },
  card: { flex: 1, minHeight: 116, borderRadius: spacing.cardRadius, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.parchmentBg, borderWidth: 1, borderColor: colors.inkSecondary, justifyContent: 'space-between' },
  cardTwoColumns: { maxWidth: '48%' },
  cardThreeColumns: { maxWidth: '31%' },
  cardQuestion: { fontSize: typography.bodySmall, color: colors.ink, fontWeight: '700' },
  badgeRow: { marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  statusBadge: { borderRadius: 999, paddingHorizontal: spacing.xs, paddingVertical: 4 },
  statusBadgeNew: { backgroundColor: colors.mint },
  statusBadgeLearning: { backgroundColor: colors.gold },
  statusBadgeMastered: { backgroundColor: colors.glowGold },
  statusBadgeText: { fontSize: typography.caption, color: colors.ink, fontWeight: '700' },
});

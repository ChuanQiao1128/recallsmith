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
  type LibraryFilter,
  type LibraryViewModel,
} from '../features/gacha/library/libraryMapper';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;
export function LibraryScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
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
    });
  }, [deck, progress, filter]);
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
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
      <SafeAreaView style={styles.safeArea}>
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
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <FlatList
          data={vm.cards}
          key={`${numColumns}-${vm.filter}-${selectedSlug ?? 'none'}`}
          numColumns={numColumns}
          testID="library-card-grid"
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          columnWrapperStyle={numColumns > 1 ? styles.columnWrap : undefined}
          ListHeaderComponent={(
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
              <Text style={styles.statusLine} numberOfLines={1}>
                {vm.drawStatusLabel}
              </Text>
              <View style={styles.filterRow}>
                {vm.filters.map((chip) => {
                  const selected = chip.key === vm.filter;
                  return (
                    <Pressable
                      key={chip.key}
                      style={({ pressed }) => [
                        styles.filterChip,
                        selected && styles.filterChipActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setFilter(chip.key)}
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
          )}
          keyExtractor={(item) => item.stableUid}
          renderItem={({ item }) => (
            <Pressable
              style={[
                styles.card,
                numColumns === 2 ? styles.cardTwoColumns : styles.cardThreeColumns,
              ]}
              onPress={() => navigation.navigate('CardDetail', { cardId: item.stableUid })}
            >
              <Text style={styles.cardQuestion} numberOfLines={1}>
                {item.question}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText} numberOfLines={1}>
                    {item.statusLabel}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      </LinearGradient>
    </SafeAreaView>
  );
}
export default LibraryScreen;
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  errorTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
  },
  errorBody: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '800',
  },
  pressed: { opacity: 0.9 },
  eyebrow: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    marginTop: spacing.xs,
    fontSize: typography.title2,
    color: colors.ink,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  statusLine: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  filterRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    minHeight: 44,
    minWidth: 78,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.15)',
    backgroundColor: 'rgba(255,255,255,0.78)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  filterChipActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  filterChipText: {
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  filterChipCount: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: colors.parchmentBg,
  },
  columnWrap: {
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  card: {
    flex: 1,
    minHeight: 116,
    borderRadius: spacing.cardRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
    justifyContent: 'space-between',
  },
  cardTwoColumns: {
    maxWidth: '48%',
  },
  cardThreeColumns: {
    maxWidth: '31%',
  },
  cardQuestion: {
    fontSize: typography.bodySmall,
    color: colors.ink,
    fontWeight: '700',
  },
  badgeRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    backgroundColor: 'rgba(200,136,58,0.16)',
  },
  statusBadgeText: {
    fontSize: typography.caption,
    color: colors.ink,
    fontWeight: '700',
  },
});

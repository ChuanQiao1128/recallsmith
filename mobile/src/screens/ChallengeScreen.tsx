import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import { listManifestDecks, resolveDeckBySlug } from '../content/deckRepository';
import { loadDeckProgress } from '../review/storage';
import { planChallengeRoute } from '../features/gacha/planner/sessionPlanner';
import RoutePreview from '../features/gacha/components/RoutePreview';
import type { ChallengeRoute } from '../features/gacha/contracts';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
type Props = NativeStackScreenProps<RootStackParamList, 'Challenge'>;
const COPY = {
  loading: 'Preparing today’s challenge...',
  unavailableTitle: 'Challenge unavailable',
  unavailableFallback: 'Unable to build today’s route.',
  backHome: '← Home',
  routeEyebrow: 'Today’s challenge',
  minimumLabel: 'Stay on streak',
  fullClearLabel: 'Full clear',
  begin: 'Begin',
  minimumLine: (minimumGoal: number) =>
    minimumGoal > 1 ? `Keep your streak alive with ${minimumGoal} cards.` : 'Keep your streak alive with one clear recall.',
  fullClearLine: (limit: number) => `Clear today’s run (${limit} cards) for +2 free pulls.`,
  cardsAhead: (limit: number) => `${limit} card${limit === 1 ? '' : 's'} ahead`,
  weekdayTitle: (date: Date, limit: number) =>
    `${date.toLocaleDateString('en-US', { weekday: 'long' })} · ${COPY.cardsAhead(limit)}`,
} as const;
export function ChallengeScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [challengeRoute, setChallengeRoute] = useState<ChallengeRoute | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        setLoading(true);
        setLoadError(null);
        try {
          let slug = slugFromRoute;
          if (!slug) {
            slug = await loadActiveDeckSlug();
          }
          if (!slug) {
            const manifest = await listManifestDecks();
            slug = manifest[0]?.slug ?? null;
          }
          if (!slug) {
            throw new Error('No deck available for today’s challenge.');
          }
          const deck = await resolveDeckBySlug(slug);
          if (!deck) {
            throw new Error('Deck not found.');
          }
          await setActiveDeckSlug(slug);
          const progress = await loadDeckProgress(deck);
          const planned = planChallengeRoute({ deck, progress });
          if (cancelled) return;
          setChallengeRoute(planned);
          setLoading(false);
        } catch (error: any) {
          if (cancelled) return;
          setChallengeRoute(null);
          setLoadError(error?.message ?? COPY.unavailableFallback);
          setLoading(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );
  const title = useMemo(() => {
    if (!challengeRoute) return '';
    return COPY.weekdayTitle(new Date(), challengeRoute.limit);
  }, [challengeRoute]);
  function startRoute() {
    if (!challengeRoute) return;
    navigation.navigate('SessionCard', {
      slug: challengeRoute.slug,
      mode: challengeRoute.mode,
      limit: challengeRoute.limit,
    });
  }
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              {COPY.loading}
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }
  if (loadError || !challengeRoute) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title} numberOfLines={2}>
              {COPY.unavailableTitle}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {loadError ?? COPY.unavailableFallback}
            </Text>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText} numberOfLines={1}>
                {COPY.backHome}
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
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
            <Text style={styles.backText} numberOfLines={1}>
              {COPY.backHome}
            </Text>
          </Pressable>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {COPY.routeEyebrow}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {challengeRoute.deckTitle}
            </Text>
            <View style={styles.goalRow}>
              <View style={styles.goalCard}>
                <Text style={styles.goalLabel} numberOfLines={1}>
                  {COPY.minimumLabel}
                </Text>
                <Text style={styles.goalBody} numberOfLines={2}>
                  {COPY.minimumLine(challengeRoute.minimumGoal)}
                </Text>
              </View>
              <View style={styles.goalCard}>
                <Text style={styles.goalLabel} numberOfLines={1}>
                  {COPY.fullClearLabel}
                </Text>
                <Text style={styles.goalBody} numberOfLines={2}>
                  {COPY.fullClearLine(challengeRoute.limit)}
                </Text>
              </View>
            </View>
          </View>
          <RoutePreview nodes={challengeRoute.nodes} />
          <Pressable
            testID="challenge-begin-cta"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={startRoute}
          >
            <Text style={styles.primaryButtonText} numberOfLines={1}>
              {COPY.begin}
            </Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}
export default ChallengeScreen;
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
  },
  heroCard: {
    marginTop: spacing.xs,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  eyebrow: {
    fontSize: typography.caption,
    color: colors.gold,
    textTransform: 'uppercase',
    fontWeight: '800',
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
  goalRow: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  goalCard: {
    borderRadius: spacing.buttonRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  goalLabel: {
    fontSize: typography.caption,
    color: colors.ink,
    fontWeight: '800',
  },
  goalBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '900',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  backText: {
    color: colors.ink,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  pressed: { opacity: 0.9 },
});

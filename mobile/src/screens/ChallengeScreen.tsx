import React, { useCallback, useState } from 'react';
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


type Props = NativeStackScreenProps<RootStackParamList, 'Challenge'>;

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
          setLoadError(error?.message ?? 'Failed to build today’s challenge.');
          setLoading(false);
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );

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
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Building today’s route…</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadError || !challengeRoute) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={styles.center}>
            <Text style={styles.title}>Challenge unavailable</Text>
            <Text style={styles.subtitle}>{loadError ?? 'Unknown error'}</Text>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Home</Text>
          </Pressable>

          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>Today’s route</Text>
            <Text style={styles.title}>{challengeRoute.deckTitle}</Text>
            <Text style={styles.subtitle}>{challengeRoute.summary}</Text>

            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{challengeRoute.minimumGoal}</Text>
                <Text style={styles.metricLabel}>Minimum goal</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{challengeRoute.limit}</Text>
                <Text style={styles.metricLabel}>Run cap</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{challengeRoute.dueCount}</Text>
                <Text style={styles.metricLabel}>Due first</Text>
              </View>
            </View>
          </View>

          <View style={styles.contextCard}>
            <Text style={styles.contextTitle}>How this route works</Text>
            <Text style={styles.contextBody}>
              If you only have a minute, clear one node and keep the streak alive. If you want a cleaner daily closure, finish the whole route and let the last node act as a recap check.
            </Text>
          </View>

          <View style={styles.routePreviewHeader}>
            <Text style={styles.routePreviewTitle}>Route preview</Text>
            <Text style={styles.routePreviewBody}>Warm-up first, then the route escalates only as much as today requires.</Text>
          </View>

          <RoutePreview nodes={challengeRoute.nodes} />

          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]} onPress={startRoute}>
            <Text style={styles.primaryButtonText}>Start today's run</Text>
          </Pressable>

        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default ChallengeScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 112 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  loadingText: { marginTop: 10, color: '#6B7280' },
  heroCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  contextCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(79,70,229,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.12)',
    marginBottom: 14,
  },
  contextTitle: { fontSize: 13, fontWeight: '800', color: '#312E81' },
  contextBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#4338CA' },
  routePreviewHeader: { marginBottom: 10 },
  routePreviewTitle: { fontSize: 13, fontWeight: '800', color: '#2A2218' },
  routePreviewBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#6B7280' },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 8, fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 8, fontSize: 13, lineHeight: 18, color: '#374151' },
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  metricCard: { flex: 1, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, backgroundColor: 'rgba(79,70,229,0.10)' },
  metricValue: { fontSize: 22, fontWeight: '800', color: '#111827' },
  metricLabel: { marginTop: 4, fontSize: 11, color: '#6B7280', fontWeight: '700' },
  primaryButton: { borderRadius: 14, backgroundColor: '#4F46E5', paddingVertical: 14, alignItems: 'center' },
  primaryButtonPressed: { opacity: 0.92 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  backButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginBottom: 12,
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827' },
});

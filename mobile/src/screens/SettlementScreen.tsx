import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MOCK_SETTLEMENT } from '../mock/settlement';
import { buildMockSessionCards } from '../mock/session';
import { buildSettlementVm } from '../features/gacha/settlement/settlementVm';
import type { ReviewRating } from '../review/model';

type Props = NativeStackScreenProps<RootStackParamList, 'Settlement'>;

const GRADE_TONES = {
  again: '#C8544F',
  hard: '#D68B2D',
  good: '#2E8C6A',
  easy: '#5C6BE0',
} as const;

export function SettlementScreen({ navigation, route }: Props) {
  const { slug, deckTitle, sessionDone, rewardPulls = 0, masteredCount = MOCK_SETTLEMENT.masteredCount } = route.params;
  const cards = useMemo(() => buildMockSessionCards(), []);
  const ratings = useMemo<Array<{ stableUid: string; rating: ReviewRating }>>(
    () =>
      cards.slice(0, Math.max(1, sessionDone)).map((card, index) => ({
        stableUid: card.stableUid,
        rating: index === 0 ? 'good' : 'easy',
      })),
    [cards, sessionDone],
  );

  const vm = buildSettlementVm({
    deckTitle,
    cards,
    ratings,
  });

  const pulls = rewardPulls || vm.pullsAwarded;
  const mastery = masteredCount || vm.masteredCount;
  const ratedCards = cards.slice(0, Math.max(1, sessionDone));
  const learnedCards = ratedCards.slice(0, Math.max(1, Math.min(ratedCards.length, sessionDone)));
  const masteredCards = ratedCards.filter((card) => card.rarity === 'RAR' || card.rarity === 'LEG').slice(0, Math.max(1, mastery));
  const clearRate = cards.length ? Math.round((sessionDone / cards.length) * 100) : 0;

  const gradeCounts = ratings.reduce<Record<ReviewRating, number>>(
    (acc, item) => {
      acc[item.rating] += 1;
      return acc;
    },
    { again: 0, hard: 0, good: 0, easy: 0 },
  );

  const ledgerRows = [
    {
      icon: '🎓',
      label: 'Learned',
      value: learnedCards.map((card) => card.question.split(/[?.!]/)[0]).slice(0, 2).join(' · ') || 'Session gains recorded',
      delta: `+${sessionDone}`,
      highlight: false,
      color: '#7C5CE0',
    },
    {
      icon: '💎',
      label: 'Mastered',
      value: masteredCards.map((card) => card.question.split(/[?.!]/)[0]).slice(0, 2).join(' · ') || 'Mastery threshold crossed',
      delta: `+${mastery}`,
      highlight: mastery > 0,
      color: '#C8883A',
    },
    {
      icon: '🪙',
      label: 'Reward pulls',
      value: `${pulls} draw${pulls === 1 ? '' : 's'} banked for the reward loop`,
      delta: `+${pulls}`,
      highlight: false,
      color: '#4B5E78',
    },
    {
      icon: '🌫',
      label: 'Faded',
      value: gradeCounts.again > 0 ? `${gradeCounts.again} card${gradeCounts.again === 1 ? '' : 's'} need a shorter return` : 'None this pass',
      delta: `${gradeCounts.again}`,
      highlight: false,
      color: '#7C6647',
    },
  ];

  const gradeSegments = [
    { key: 'again', label: 'Again', count: gradeCounts.again },
    { key: 'hard', label: 'Hard', count: gradeCounts.hard },
    { key: 'good', label: 'Good', count: gradeCounts.good },
    { key: 'easy', label: 'Easy', count: gradeCounts.easy },
  ].filter((segment) => segment.count > 0) as Array<{ key: keyof typeof gradeCounts; label: string; count: number }>;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F6EFD9', '#F4EBDD', '#EFE6D1']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.shell}>
            <View style={styles.topStripe} />
            <Text style={styles.eyebrow}>Settlement</Text>
            <Text style={styles.title}>{vm.title}</Text>
            <Text style={styles.body}>You cleared {sessionDone} card{sessionDone === 1 ? '' : 's'}. {vm.progressHeadline}</Text>

            <View style={styles.sessionCard}>
              <View style={styles.sessionCardRow}>
                <Text style={styles.sessionMeta}>▸ session closed</Text>
                <Text style={styles.sessionMeta}>{deckTitle}</Text>
              </View>
              <Text style={styles.sessionHeadline}>{sessionDone}/{Math.max(sessionDone, cards.length)} cleared ✓</Text>
              <Text style={styles.sessionSubhead}>Streak +{vm.streakDelta} · {vm.nextRecommendation}</Text>
            </View>

            <View style={styles.statGrid}>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>{clearRate}%</Text>
                <Text style={styles.statLabel}>clear rate</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={[styles.statValue, styles.statValuePurple]}>{sessionDone}</Text>
                <Text style={styles.statLabel}>learned</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={[styles.statValue, styles.statValueGold]}>+{mastery}</Text>
                <Text style={styles.statLabel}>mastered</Text>
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelLabel}>GRADE MIX · SUM = {ratings.length}</Text>
              <View style={styles.gradeTrack}>
                {gradeSegments.map((segment) => (
                  <View
                    key={segment.key}
                    style={[
                      styles.gradeSegment,
                      {
                        width: `${(segment.count / Math.max(1, ratings.length)) * 100}%`,
                        backgroundColor: GRADE_TONES[segment.key],
                      },
                    ]}
                  >
                    <Text style={styles.gradeSegmentText}>{segment.label} {segment.count}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.gradeLegendRow}>
                {(['again', 'hard', 'good', 'easy'] as const).map((key) => (
                  <Text key={key} style={styles.gradeLegendText}>
                    {key[0].toUpperCase() + key.slice(1)} {gradeCounts[key]}
                  </Text>
                ))}
              </View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelLabel}>MENTAL LEDGER</Text>
              {ledgerRows.map((row) => (
                <View
                  key={row.label}
                  style={[
                    styles.ledgerRow,
                    row.highlight && styles.ledgerRowHighlight,
                    row.highlight && { borderColor: row.color },
                  ]}
                >
                  <Text style={styles.ledgerIcon}>{row.icon}</Text>
                  <View style={styles.ledgerContent}>
                    <Text style={styles.ledgerText}>
                      <Text style={[styles.ledgerTextStrong, { color: row.color }]}>{row.label}:</Text> {row.value}
                    </Text>
                  </View>
                  <Text style={[styles.ledgerDelta, { color: row.color }]}>{row.delta}</Text>
                </View>
              ))}
            </View>

            <View style={styles.rewardCard}>
              <Text style={styles.rewardEyebrow}>🎁 SESSION BONUS</Text>
              <Text style={styles.rewardTitle}>You earned {pulls} free pull{pulls === 1 ? '' : 's'}.</Text>
              <Text style={styles.rewardBody}>Celebratory, but restrained: bank them for tomorrow or route straight into a collection moment now.</Text>
              {pulls > 0 ? (
                <Pressable style={({ pressed }) => [styles.rewardActionButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Draw', { slug, rewardPending: true })}>
                  <Text style={styles.rewardActionText}>Open reward draw</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelLabel}>NEXT RECOMMENDATION</Text>
              <Text style={styles.nextText}>{vm.nextRecommendation}</Text>
            </View>

            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.primaryButtonText}>Return home</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('MasteredCelebration', { slug, deckTitle, masteredCount: mastery })}>
              <Text style={styles.secondaryButtonText}>Celebrate mastery</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('CollectionMilestone', { poolId: slug, tier: 'bronze' })}>
              <Text style={styles.secondaryButtonText}>Open collection milestone</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('MasteryMilestone', { poolId: slug, tier: 'junior' })}>
              <Text style={styles.secondaryButtonText}>Open mastery milestone</Text>
            </Pressable>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SettlementScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6EFD9' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  shell: {
    borderRadius: 28,
    backgroundColor: 'rgba(251,247,236,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.12)',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    shadowColor: '#7A6242',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  topStripe: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#C8883A',
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C6647',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontFamily: 'Courier',
  },
  title: { marginTop: 10, fontSize: 29, lineHeight: 36, fontWeight: '900', color: '#241D15' },
  body: { marginTop: 8, fontSize: 14, lineHeight: 21, color: '#5C4E3D' },
  sessionCard: {
    marginTop: 18,
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  sessionCardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  sessionMeta: { fontSize: 11, color: '#75644F', fontWeight: '800', letterSpacing: 1, fontFamily: 'Courier' },
  sessionHeadline: { marginTop: 8, fontSize: 28, lineHeight: 34, color: '#241D15', fontWeight: '900', fontFamily: 'Courier' },
  sessionSubhead: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#5C4E3D' },
  statGrid: { marginTop: 16, flexDirection: 'row', gap: 8 },
  statTile: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: '#FCF8EF',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.08)',
    alignItems: 'center',
  },
  statValue: { fontSize: 23, fontWeight: '900', color: '#2E8C6A', fontFamily: 'Courier' },
  statValuePurple: { color: '#7C5CE0' },
  statValueGold: { color: '#C8883A' },
  statLabel: { marginTop: 4, fontSize: 10, fontWeight: '800', color: '#7C6647', textTransform: 'uppercase', letterSpacing: 0.9, fontFamily: 'Courier' },
  panel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#FCF8EF',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.08)',
  },
  panelLabel: { fontSize: 11, color: '#7C6647', fontWeight: '900', letterSpacing: 1.2, fontFamily: 'Courier', marginBottom: 10 },
  gradeTrack: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E0D2BA',
  },
  gradeSegment: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  gradeSegmentText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  gradeLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  gradeLegendText: { fontSize: 10, color: '#7C6647', fontFamily: 'Courier' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderRadius: 12,
    marginBottom: 4,
  },
  ledgerRowHighlight: {
    paddingHorizontal: 12,
    backgroundColor: 'rgba(200,136,58,0.12)',
    borderWidth: 1,
  },
  ledgerIcon: { fontSize: 18 },
  ledgerContent: { flex: 1 },
  ledgerText: { fontSize: 13, lineHeight: 19, color: '#241D15' },
  ledgerTextStrong: { fontWeight: '800' },
  ledgerDelta: { fontSize: 11, fontWeight: '900', fontFamily: 'Courier' },
  rewardCard: {
    marginTop: 16,
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#DFA847',
    borderWidth: 1,
    borderColor: '#C8883A',
  },
  rewardEyebrow: { fontSize: 11, fontWeight: '900', color: '#4E3310', letterSpacing: 1, fontFamily: 'Courier' },
  rewardTitle: { marginTop: 6, fontSize: 20, lineHeight: 26, fontWeight: '900', color: '#3A2608' },
  rewardBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: 'rgba(58,38,8,0.82)' },
  rewardActionButton: { marginTop: 14, borderRadius: 14, backgroundColor: '#241D15', paddingVertical: 14, alignItems: 'center' },
  rewardActionText: { color: '#FFF7EA', fontSize: 14, fontWeight: '800' },
  nextText: { fontSize: 14, lineHeight: 21, color: '#5C4E3D' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#F8F1DE', fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#EFE5D1',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.14)',
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.92 },
});

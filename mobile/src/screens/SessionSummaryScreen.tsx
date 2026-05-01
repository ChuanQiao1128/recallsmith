import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { buildSessionSummaryVM } from '../features/gacha/session/summaryMapper';
import { applySessionRewardToWallet, canAcceptMorePulls, loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { buildDrawState } from '../features/gacha/draw/drawState';
import { applySessionStreak, loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { resolveNewMilestones, type Milestone } from '../features/gacha/milestones/milestoneTracker';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionSummary'>;

export function SessionSummaryScreen({ navigation, route }: Props) {
  const { sessionId, deckTitle, slug, sessionDone, sessionLimit, minimumGoal, dueCount, streakEarned = false } = route.params;
  const [walletBeforeReward, setWalletBeforeReward] = useState<RewardWalletState | null>(null);
  const [streakSnapshot, setStreakSnapshot] = useState<StreakSnapshot | null>(null);
  const [newMilestones, setNewMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sessionId) {
        const rewardPulls = sessionLimit > 0 && sessionDone >= sessionLimit ? 2 : sessionDone >= minimumGoal ? 1 : 0;
        const rewardResult = await applySessionRewardToWallet(sessionId, rewardPulls);
        const streakResult = await applySessionStreak({ sessionId, earned: streakEarned });
        if (!cancelled) {
          setWalletBeforeReward(rewardResult.walletBefore);
          setStreakSnapshot(streakResult.after);
          setNewMilestones(resolveNewMilestones({ before: streakResult.before, after: streakResult.after }));
        }
        return;
      }

      const [currentWallet, currentStreak] = await Promise.all([loadRewardWalletState(), loadStreakSnapshot()]);
      if (!cancelled) {
        setWalletBeforeReward(currentWallet);
        setStreakSnapshot(currentStreak);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionDone, sessionLimit, minimumGoal, streakEarned]);

  const summary = useMemo(
    () =>
      buildSessionSummaryVM({
        deckTitle,
        sessionDone,
        sessionLimit,
        minimumGoal,
        dueCount,
        wallet: walletBeforeReward,
      }),
    [deckTitle, sessionDone, sessionLimit, minimumGoal, dueCount, walletBeforeReward],
  );

  const drawVm = useMemo(
    () =>
      buildDrawState({
        wallet: summary.resolvedReward.walletAfter,
        hasTodayWork: dueCount > 0,
        rewardPending: summary.resolvedReward.rewardPulls > 0,
      }),
    [summary, dueCount],
  );

  const latestMilestone = newMilestones[0] ?? null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Text style={styles.heroBadge}>{summary.vm.rewardBadge}</Text>
              <Text style={styles.heroCompletion}>{summary.vm.completionLabel}</Text>
            </View>
            <Text style={styles.title}>{summary.vm.title}</Text>
            <Text style={styles.subtitle}>{summary.vm.subtitle}</Text>
          </View>

            <View style={[styles.card, styles.rewardCard]}>
              <Text style={styles.cardEyebrow}>Reward</Text>
              <Text style={styles.cardTitle}>{summary.vm.rewardTitle}</Text>
              <Text style={styles.rewardBodyStrong}>{summary.vm.rewardBody}</Text>
              <Text style={styles.rewardSupport}>Treat this as a clean payout for finishing the run, not a loot screen that hides the learning result.</Text>
              <Text style={styles.walletFootnote}>Wallet now: {summary.resolvedReward.walletAfter.availablePulls} ready · {summary.resolvedReward.walletAfter.reservePulls} in reserve</Text>
            </View>

          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>Progress</Text>
            <Text style={styles.cardTitle}>Learning progress</Text>
            <Text style={styles.cardBody}>{summary.vm.progressBody}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>Daily streak</Text>
            <Text style={styles.cardTitle}>{streakSnapshot ? `${streakSnapshot.currentDailyStreak} day streak live` : 'Loading streak…'}</Text>
            <Text style={styles.cardBody}>
              {streakSnapshot
                ? `${streakSnapshot.weekCompletedDays}/7 days landed this week · ${streakSnapshot.totalQualifiedSessions} qualified runs total.`
                : 'We update streak progress after the first qualified card in a run.'}
            </Text>
          </View>

          {latestMilestone ? (
            <View style={[styles.card, styles.milestoneCard]}>
              <Text style={styles.cardEyebrow}>Milestone</Text>
              <Text style={styles.cardTitle}>{latestMilestone.title}</Text>
              <Text style={styles.cardBody}>{latestMilestone.body}</Text>
            </View>
          ) : null}

          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Next action</Text>
            <Text style={styles.actionBody}>Return home to start another run, open draw if you want to spend reward pulls, or open your library to inspect what changed.</Text>

            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.primaryButtonText}>{summary.vm.nextActionLabel}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
                !canAcceptMorePulls(summary.resolvedReward.walletAfter) && styles.buttonDisabled,
              ]}
              disabled={false}
              onPress={() => navigation.navigate('Draw', { slug, rewardPending: drawVm.state === 'reward-pending' })}
            >
              <Text style={styles.secondaryButtonText}>{drawVm.ctaLabel}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tertiaryButton, pressed && styles.buttonPressed]}
              onPress={() => navigation.navigate('Deck', { slug })}
            >
              <Text style={styles.tertiaryButtonText}>{summary.vm.secondaryActionLabel}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SessionSummaryScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
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
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(79,70,229,0.12)',
    color: '#4F46E5',
    fontSize: 11,
    fontWeight: '900',
  },
  heroCompletion: { fontSize: 12, fontWeight: '800', color: '#6B7280' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#111827', marginTop: 10 },
  subtitle: { marginTop: 8, fontSize: 13, lineHeight: 18, color: '#374151' },
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  rewardCard: {
    backgroundColor: 'rgba(79,70,229,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.12)',
  },
  milestoneCard: {
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.16)',
  },
  cardEyebrow: { fontSize: 11, fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginTop: 6 },
  cardBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#6B7280' },
  rewardBodyStrong: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#312E81', fontWeight: '700' },
  rewardSupport: { marginTop: 8, fontSize: 12, lineHeight: 18, color: '#5B5BD6' },
  walletFootnote: { marginTop: 8, fontSize: 11, lineHeight: 16, color: '#4338CA', fontWeight: '700' },
  actionCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  actionTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  actionBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#6B7280' },
  primaryButton: { borderRadius: 14, backgroundColor: '#4F46E5', paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    borderRadius: 14,
    backgroundColor: 'rgba(79,70,229,0.10)',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.12)',
  },
  secondaryButtonText: { color: '#4F46E5', fontSize: 14, fontWeight: '800' },
  tertiaryButton: {
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.04)',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  tertiaryButtonText: { color: '#374151', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.92 },
});

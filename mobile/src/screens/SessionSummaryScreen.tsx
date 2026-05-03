import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { RewardSummaryCard } from '../features/gacha/components/RewardSummaryCard';
import { SummaryProgressBlock } from '../features/gacha/components/SummaryProgressBlock';
import { buildDrawState } from '../features/gacha/draw/drawState';
import { resolveNewMilestones, type Milestone } from '../features/gacha/milestones/milestoneTracker';
import { applySessionRewardToWallet, loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { buildSessionSummaryVM } from '../features/gacha/session/summaryMapper';
import { applySessionStreak, loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import type { HomeCtaKind } from '../features/gacha/selectors/homeSelectors';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'SessionSummary'>;

function navigateFromActionKind(args: {
  kind: HomeCtaKind;
  slug: string;
  rewardPending: boolean;
  navigation: Props['navigation'];
}): void {
  const { kind, slug, rewardPending, navigation } = args;

  if (kind === 'nothing_to_learn') {
    void slug;
    navigation.navigate('Library');
    return;
  }

  if (kind === 'wallet_full') {
    navigation.navigate('Draw', { slug, rewardPending });
    return;
  }

  navigation.navigate('Home');
}

export function SessionSummaryScreen({ navigation, route }: Props) {
  const { sessionId, deckTitle, slug, sessionDone, sessionLimit, minimumGoal, dueCount, streakEarned = false } = route.params;

  const [walletBeforeReward, setWalletBeforeReward] = useState<RewardWalletState | null>(null);
  const [streakBeforeSnapshot, setStreakBeforeSnapshot] = useState<StreakSnapshot | null>(null);
  const [streakAfterSnapshot, setStreakAfterSnapshot] = useState<StreakSnapshot | null>(null);
  const [newMilestones, setNewMilestones] = useState<Milestone[]>([]);
  const [summaryResolveStatus, setSummaryResolveStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [summaryResolveError, setSummaryResolveError] = useState<string | null>(null);
  const [summaryRetryToken, setSummaryRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSummaryResolveStatus('loading');
    setSummaryResolveError(null);

    (async () => {
      try {
        if (sessionId) {
          const rewardPulls = sessionLimit > 0 && sessionDone >= sessionLimit ? 2 : sessionDone >= minimumGoal ? 1 : 0;
          const [rewardResult, streakResult] = await Promise.all([
            applySessionRewardToWallet(sessionId, rewardPulls),
            applySessionStreak({ sessionId, earned: streakEarned }),
          ]);

          if (!cancelled) {
            setWalletBeforeReward(rewardResult.walletBefore);
            setStreakBeforeSnapshot(streakResult.before);
            setStreakAfterSnapshot(streakResult.after);
            setNewMilestones(resolveNewMilestones({ before: streakResult.before, after: streakResult.after }));
            setSummaryResolveStatus('ready');
          }
          return;
        }

        const [currentWallet, currentStreak] = await Promise.all([loadRewardWalletState(), loadStreakSnapshot()]);
        if (!cancelled) {
          setWalletBeforeReward(currentWallet);
          setStreakBeforeSnapshot(currentStreak);
          setStreakAfterSnapshot(currentStreak);
          setSummaryResolveStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setSummaryResolveStatus('error');
          setSummaryResolveError('Unable to refresh reward and streak details right now.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionDone, sessionLimit, minimumGoal, streakEarned, summaryRetryToken]);

  const summary = useMemo(
    () =>
      buildSessionSummaryVM({
        deckTitle,
        sessionDone,
        sessionLimit,
        minimumGoal,
        dueCount,
        wallet: walletBeforeReward,
        streakBefore: streakBeforeSnapshot?.currentDailyStreak ?? null,
        streakAfter: streakAfterSnapshot?.currentDailyStreak ?? null,
      }),
    [
      deckTitle,
      sessionDone,
      sessionLimit,
      minimumGoal,
      dueCount,
      walletBeforeReward,
      streakBeforeSnapshot,
      streakAfterSnapshot,
    ],
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

  const streakBefore = streakBeforeSnapshot?.currentDailyStreak ?? streakAfterSnapshot?.currentDailyStreak ?? 0;
  const streakAfter = streakAfterSnapshot?.currentDailyStreak ?? streakBefore;
  const streakChanged = streakAfter > streakBefore || streakEarned;
  const summaryHasActivity = sessionDone > 0 || dueCount > 0 || summary.resolvedReward.rewardPulls > 0 || streakAfter > 0;
  const isSummaryError = summaryResolveStatus === 'error';
  const isSummaryLoading = summaryResolveStatus === 'loading';
  const isSummaryEmpty = summaryResolveStatus === 'ready' && !summaryHasActivity;

  const actionTitle = isSummaryError ? 'Refresh summary' : isSummaryEmpty ? 'No run logged yet' : 'Next action';

  const actionBody =
    isSummaryError
      ? (summaryResolveError ?? 'Unable to refresh reward and streak details right now.')
      : isSummaryLoading
        ? 'Wrapping up reward and streak details...'
        : isSummaryEmpty
          ? 'Open your library to choose cards for the next run.'
          : summary.vm.nextAction.primary.kind === 'nothing_to_learn'
            ? "Open your library to review today's updates."
            : drawVm.canOpen
              ? 'Continue your day, then open draw when you want to spend pulls.'
              : 'Continue to Home for the next run.';

  const primaryActionLabel = isSummaryLoading
    ? 'Updating...'
    : isSummaryError
      ? 'Retry'
      : isSummaryEmpty
        ? 'Open library'
        : summary.vm.nextAction.primary.label;
  const isPrimaryActionDisabled = isSummaryLoading;

  return (
    <SafeAreaView testID="screen-session-summary-root" style={styles.safeArea}>
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <Text numberOfLines={1} style={styles.heroBadge}>
                {summary.vm.reward.badge}
              </Text>
              <Text numberOfLines={1} style={styles.heroCompletion}>
                {summary.vm.progress.completionLabel}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.title}>
              {summary.vm.title}
            </Text>
            <Text numberOfLines={1} style={styles.subtitle}>
              {summary.vm.subtitle}
            </Text>
          </View>

          <RewardSummaryCard
            testID="summary-reward-block"
            reward={summary.vm.reward}
            ctaLabel={drawVm.canOpen ? drawVm.ctaLabel : null}
            onPressUsePulls={
              drawVm.canOpen
                ? () => navigation.navigate('Draw', { slug, rewardPending: drawVm.state === 'reward-pending' })
                : null
            }
          />

          <SummaryProgressBlock
            testID="summary-progress-block"
            done={summary.vm.progress.done}
            total={summary.vm.progress.total}
            completionLabel={summary.vm.progress.completionLabel}
            body={summary.vm.progress.body}
            streak={{ before: streakBefore, after: streakAfter, earned: streakChanged }}
            transitions={summary.vm.progress.transitions}
            streakNote={summary.vm.progress.streakNote}
            transitionsNote={summary.vm.progress.transitionsNote}
          />

          {latestMilestone ? (
            <View style={styles.milestoneCard}>
              <Text numberOfLines={1} style={styles.cardEyebrow}>
                Milestone
              </Text>
              <Text numberOfLines={2} style={styles.cardTitle}>
                {latestMilestone.title}
              </Text>
              <Text numberOfLines={2} style={styles.cardBody}>
                {latestMilestone.body}
              </Text>
            </View>
          ) : null}

          <View style={styles.actionCard}>
            <Text numberOfLines={1} style={styles.actionTitle}>
              {actionTitle}
            </Text>
            <Text numberOfLines={2} style={styles.actionBody}>
              {actionBody}
            </Text>

            <Pressable
              testID="screen-session-summary-primary-cta"
              accessibilityRole="button"
              accessibilityState={{ disabled: isPrimaryActionDisabled }}
              disabled={isPrimaryActionDisabled}
              style={({ pressed }) => [
                styles.primaryButton,
                isPrimaryActionDisabled && styles.primaryButtonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => {
                if (isSummaryLoading) {
                  return;
                }

                if (isSummaryError) {
                  setSummaryRetryToken((current) => current + 1);
                  return;
                }

                if (isSummaryEmpty) {
                  navigation.navigate('Library');
                  return;
                }

                navigateFromActionKind({
                  kind: summary.vm.nextAction.primary.kind,
                  slug,
                  rewardPending: drawVm.state === 'reward-pending',
                  navigation,
                });
              }}
            >
              <Text numberOfLines={1} style={styles.primaryButtonText}>
                {primaryActionLabel}
              </Text>
            </Pressable>

            {summaryResolveStatus === 'ready' && !isSummaryEmpty && summary.vm.nextAction.secondary ? (
              <Pressable
                testID="screen-session-summary-secondary-cta"
                accessibilityRole="link"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={() =>
                  navigateFromActionKind({
                    kind: summary.vm.nextAction.secondary!.kind,
                    slug,
                    rewardPending: false,
                    navigation,
                  })
                }
              >
                <Text numberOfLines={1} style={styles.secondaryButtonText}>
                  {summary.vm.nextAction.secondary.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SessionSummaryScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.lg,
  },
  heroCard: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
    marginBottom: spacing.sm,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: 'rgba(42, 34, 24, 0.08)',
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  heroCompletion: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700' },
  title: { marginTop: 8, color: colors.ink, fontSize: typography.title2, lineHeight: 28, fontWeight: '900' },
  subtitle: { marginTop: 6, color: colors.inkSecondary, fontSize: typography.bodySmall, lineHeight: 18, fontWeight: '600' },
  milestoneCard: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(126, 157, 94, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(126, 157, 94, 0.28)',
    marginBottom: spacing.sm,
  },
  cardEyebrow: {
    color: colors.mint,
    fontSize: typography.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cardTitle: { marginTop: 4, color: colors.ink, fontSize: typography.title3, lineHeight: 22, fontWeight: '800' },
  cardBody: { marginTop: 6, color: colors.inkSecondary, fontSize: typography.bodySmall, lineHeight: 18 },
  actionCard: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: colors.ink,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  actionTitle: { color: colors.ink, fontSize: typography.title3, lineHeight: 22, fontWeight: '800' },
  actionBody: { marginTop: 6, color: colors.inkSecondary, fontSize: typography.bodySmall, lineHeight: 18 },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: { color: colors.parchmentBg, fontSize: typography.body, fontWeight: '800' },
  secondaryButton: {
    marginTop: spacing.xs,
    minHeight: a11y.minTouch,
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  secondaryButtonText: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  buttonPressed: { opacity: 0.85 },
});

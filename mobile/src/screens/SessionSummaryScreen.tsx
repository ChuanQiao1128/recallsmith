import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { goHome } from '../navigation/tabNavigation';
import { RewardSummaryCard } from '../features/gacha/components/RewardSummaryCard';
import { SummaryProgressBlock } from '../features/gacha/components/SummaryProgressBlock';
import { buildDrawState } from '../features/gacha/draw/drawState';
import { resolveNewMilestones, type Milestone } from '../features/gacha/milestones/milestoneTracker';
import { loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { buildSessionSummaryVM, resolveSecondaryAction } from '../features/gacha/session/summaryMapper';
import { mcqPicksLine } from '../features/gacha/mcq/mcqConstants';
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

  goHome(navigation);
}

export function SessionSummaryScreen({ navigation, route }: Props) {
  const { sessionId, deckTitle, slug, sessionDone, sessionLimit, minimumGoal, dueCount, streakEarned = false, reward, loadForecast, picks } = route.params;

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
          const [loadedWallet, streakResult] = await Promise.all([
            loadRewardWalletState(),
            applySessionStreak({ sessionId, earned: streakEarned }),
          ]);

          if (!cancelled) {
            setWalletBeforeReward(loadedWallet);
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

  const walletForSummary = reward?.walletBefore ?? walletBeforeReward;

  const summary = useMemo(
    () =>
      buildSessionSummaryVM({
        deckTitle,
        sessionDone,
        sessionLimit,
        minimumGoal,
        dueCount,
        wallet: walletForSummary,
        reward: reward ?? null,
        streakBefore: streakBeforeSnapshot?.currentDailyStreak ?? null,
        streakAfter: streakAfterSnapshot?.currentDailyStreak ?? null,
      }),
    [
      deckTitle,
      sessionDone,
      sessionLimit,
      minimumGoal,
      dueCount,
      walletForSummary,
      reward,
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
  const extraMilestonesCount = Math.max(0, newMilestones.length - 1);
  const extraMilestonesLabel = extraMilestonesCount > 0 ? `+${extraMilestonesCount} more milestone${extraMilestonesCount === 1 ? '' : 's'} unlocked` : null;

  const streakBefore = streakBeforeSnapshot?.currentDailyStreak ?? streakAfterSnapshot?.currentDailyStreak ?? 0;
  const streakAfter = streakAfterSnapshot?.currentDailyStreak ?? streakBefore;
  const streakChanged = streakAfter > streakBefore || streakEarned;
  const summaryHasActivity = sessionDone > 0 || dueCount > 0 || summary.resolvedReward.rewardPulls > 0 || streakAfter > 0;
  const isSummaryError = summaryResolveStatus === 'error';
  const isSummaryLoading = summaryResolveStatus === 'loading';
  const isSummaryEmpty = summaryResolveStatus === 'ready' && !summaryHasActivity;

  const actionTitle = isSummaryError ? 'Refresh summary' : summary.vm.nextAction.title;

  const actionBody =
    isSummaryError
      ? (summaryResolveError ?? 'Unable to refresh reward and streak details right now.')
      : isSummaryLoading
        ? 'Wrapping up reward and streak details...'
        : summary.vm.nextAction.body;

  // ─── Instant-reward CTA gating ─────────────────────────────────────
  // When the user just earned pulls AND the wallet can accept them,
  // we surface a prominent gold "Use N pulls now" CTA at the top of
  // the page. This closes the study → reward → spend loop in one tap
  // (previously: SessionSummary → Home → pack → Draw = 3 taps).
  // When this CTA is showing, the bottom actionCard primary demotes
  // to a quieter "Back to Home" button to avoid dual-CTA confusion.
  const earnedPulls = summary.resolvedReward.rewardPulls;
  const showRewardCallout =
    summaryResolveStatus === 'ready' && earnedPulls > 0 && drawVm.canOpen;

  const primaryActionLabel = isSummaryLoading
    ? 'Updating...'
    : isSummaryError
      ? 'Retry'
      : isSummaryEmpty
        ? 'Open library'
        : showRewardCallout
          ? 'Back to Home'
          : summary.vm.nextAction.primary.label;
  const isPrimaryActionDisabled = isSummaryLoading;
  // The demoted primary goes Home, so the link under it must not: the mapper
  // picked the secondary against the un-demoted primary and would otherwise
  // put "Back home" under "Back to Home".
  const secondaryAction = showRewardCallout
    ? resolveSecondaryAction({ primaryGoesHome: true })
    : summary.vm.nextAction.secondary;

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
            {/* Gold uppercase celebration eyebrow — reinforces the achievement
                feeling. Reward badge moves to a pokeBlue accent pill. */}
            <Text numberOfLines={1} style={styles.heroEyebrow}>
              SESSION COMPLETE
            </Text>
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

          {/* Instant-reward CTA — visible only when the user just earned
              pulls. Gold pill with the badge count + "Use now →". This
              closes the daily learn-to-spend loop in one tap. */}
          {showRewardCallout ? (
            <Pressable
              // Reuses the same testID the RewardSummaryCard's internal
              // CTA used to expose. The two CTAs are mutually exclusive
              // (showRewardCallout gates which one renders), so the
              // single-handle test contract remains intact.
              testID="summary-reward-use-pulls-cta"
              accessibilityRole="button"
              accessibilityLabel={`Use ${earnedPulls} new ${earnedPulls === 1 ? 'pull' : 'pulls'} now`}
              style={({ pressed }) => [styles.usePullsButton, pressed && styles.buttonPressed]}
              onPress={() =>
                navigation.navigate('Draw', {
                  slug,
                  rewardPending: drawVm.state === 'reward-pending',
                })
              }
            >
              <View style={styles.usePullsBadge}>
                <Text style={styles.usePullsBadgeText} numberOfLines={1}>
                  {`+${earnedPulls}`}
                </Text>
              </View>
              <Text style={styles.usePullsLabel} numberOfLines={1}>
                {`Use ${earnedPulls} new ${earnedPulls === 1 ? 'pull' : 'pulls'} now`}
              </Text>
              <Text style={styles.usePullsArrow} numberOfLines={1}>
                →
              </Text>
            </Pressable>
          ) : null}

          <RewardSummaryCard
            testID="summary-reward-block"
            reward={summary.vm.reward}
            ctaLabel={drawVm.canOpen && !showRewardCallout ? drawVm.ctaLabel : null}
            onPressUsePulls={
              drawVm.canOpen && !showRewardCallout
                ? () => navigation.navigate('Draw', { slug, rewardPending: drawVm.state === 'reward-pending' })
                : null
            }
          />

          {loadForecast ? (
            <Text testID="session-summary-load-forecast" numberOfLines={2} style={styles.forecastLine}>
              {loadForecast}
            </Text>
          ) : null}

          {picks ? (
            <Text testID="session-summary-picks" numberOfLines={2} style={styles.forecastLine}>
              {mcqPicksLine(picks)}
            </Text>
          ) : null}

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
              {extraMilestonesLabel ? (
                <Text numberOfLines={1} style={styles.cardMeta}>
                  {extraMilestonesLabel}
                </Text>
              ) : null}
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
                showRewardCallout ? styles.primaryButtonDemoted : styles.primaryButton,
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

                // When the gold reward CTA is showing, this button is
                // demoted to "Back to Home" so the two CTAs don't compete.
                if (showRewardCallout) {
                  goHome(navigation);
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
              <Text
                numberOfLines={1}
                style={[
                  styles.primaryButtonText,
                  showRewardCallout && styles.primaryButtonTextDemoted,
                ]}
              >
                {primaryActionLabel}
              </Text>
            </Pressable>

            {summaryResolveStatus === 'ready' && !isSummaryEmpty && secondaryAction ? (
              <Pressable
                testID="screen-session-summary-secondary-cta"
                accessibilityRole="link"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={() =>
                  navigateFromActionKind({
                    kind: secondaryAction.kind,
                    slug,
                    rewardPending: false,
                    navigation,
                  })
                }
              >
                <Text numberOfLines={1} style={styles.secondaryButtonText}>
                  {secondaryAction.label}
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
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  // Gold uppercase eyebrow — celebration accent above hero copy
  heroEyebrow: {
    color: colors.gold,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  // Reward badge — gold accent pill instead of muted brown gravel
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: 'rgba(232,184,90,0.20)',
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
    overflow: 'hidden',
  },
  heroCompletion: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700' },
  title: { marginTop: 8, color: colors.ink, fontSize: typography.title2, lineHeight: 28, fontWeight: '900' },
  subtitle: { marginTop: 6, color: colors.inkSecondary, fontSize: typography.bodySmall, lineHeight: 18, fontWeight: '600' },
  // Same copy and weight as SessionCardScreen's in-session forecast line.
  forecastLine: {
    marginTop: 2,
    marginBottom: spacing.sm,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '700',
    textAlign: 'center',
  },
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
  cardMeta: { marginTop: 8, color: colors.mint, fontSize: typography.caption, lineHeight: 16, fontWeight: '800' },
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
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // Demoted variant — used when the gold "Use pulls" CTA is the
  // dominant action. Keeps the button accessible (the user can still
  // tap "Back to Home") but visually quiet so the gold pill leads.
  primaryButtonDemoted: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  // Demoted text — pairs with primaryButtonDemoted. Keeps button-sized
  // fontSize (visual hierarchy primary > secondary still holds for the
  // contract test); the demotion comes from the muted color + transparent
  // background + hairline border on the container itself.
  primaryButtonTextDemoted: {
    color: colors.inkMuted,
    fontSize: typography.button,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // ─── Instant-reward gold CTA ───────────────────────────────────────
  // Visually loudest element on the page when shown. Gold pill with
  // a circular badge for the earned count, label, and arrow chevron.
  usePullsButton: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 60,
    borderRadius: 999,
    paddingHorizontal: 18,
    backgroundColor: colors.gold,
    shadowColor: 'rgba(200,136,58,0.45)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  usePullsBadge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  usePullsBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  usePullsLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  usePullsArrow: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
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

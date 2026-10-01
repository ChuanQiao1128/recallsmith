// mobile/src/screens/MyReportsScreen.tsx
//
// V11: the signed-in learner's own card reports (GET /api/v1/user/card-reports),
// reached from the flag-gated "My reports" row on More. Read-only; the author
// resolves reports in the console. Notes are shown as plain text only.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import {
  CARD_REPORT_REASONS,
  CardReportSignedOutError,
  cardReportErrorMessage,
  listMyCardReports,
  type MyCardReport,
} from '../features/cardReport/cardReportApi';
import { questionText } from '../content/questionCode';
import { stripInlineCode } from '../content/inlineCode';
import { colors } from '../theme/colors';
import { a11y } from '../theme/a11y';
import { CHROME_MAX_FONT_SCALE } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'MyReports'>;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: MyCardReport[] };

const RESOLUTION_LABELS: Record<string, string> = {
  fixed: 'Fixed',
  wont_fix: "Won't fix",
  duplicate: 'Duplicate',
  invalid: 'Invalid',
};

export function reportBadgeLabel(report: Pick<MyCardReport, 'status' | 'resolution'>): string {
  if (report.status === 'open') return 'Open';
  return (report.resolution && RESOLUTION_LABELS[report.resolution]) || 'Closed';
}

function reasonLabel(reason: string): string {
  return CARD_REPORT_REASONS.find((r) => r.value === reason)?.label ?? 'Something else';
}

// The server sends ISO timestamps; the calendar day is enough here.
function dayOf(iso: string | null): string {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
}

export function MyReportsScreen({ navigation }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async (isCancelled: () => boolean) => {
    setState({ kind: 'loading' });
    try {
      const items = await listMyCardReports();
      if (!isCancelled()) setState({ kind: 'ready', items });
    } catch (e) {
      if (isCancelled()) return;
      setState(e instanceof CardReportSignedOutError ? { kind: 'signed_out' } : { kind: 'error', message: cardReportErrorMessage(e) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="my-reports-back"
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
            </Pressable>
          </View>
          <Text
            testID="my-reports-title"
            style={styles.title}
            accessibilityRole="header"
            maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          >
            My reports
          </Text>
          <Text style={styles.subtitle}>Problems you reported on cards, and what the author did about them.</Text>

          {state.kind === 'loading' ? (
            <View
              testID="my-reports-loading"
              accessible
              accessibilityLabel="Loading your reports"
              accessibilityState={{ busy: true }}
            >
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
            </View>
          ) : null}

          {state.kind === 'signed_out' ? (
            <View style={styles.emptyCard}>
              <Text testID="my-reports-signed-out" style={styles.emptyBody}>
                Sign in to see your reports
              </Text>
            </View>
          ) : null}

          {state.kind === 'error' ? (
            <View style={styles.emptyCard}>
              <Text testID="my-reports-error" accessibilityRole="alert" style={styles.emptyBody}>
                {state.message}
              </Text>
              <Pressable
                testID="my-reports-retry"
                accessibilityRole="button"
                accessibilityLabel="Try again"
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                onPress={() => void load(() => false)}
              >
                <Text style={styles.retryText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {state.kind === 'ready' && state.items.length === 0 ? (
            <View testID="my-reports-empty" style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No reports yet</Text>
              <Text style={styles.emptyBody}>
                Open a card's answer and tap Report a problem if something looks wrong.
              </Text>
            </View>
          ) : null}

          {state.kind === 'ready' && state.items.length > 0 ? (
            <View style={styles.card}>
              {state.items.map((item) => {
                const badge = reportBadgeLabel(item);
                // The API echoes the raw question: show the prose only, never a fenced code block.
                const question = (item.question && stripInlineCode(questionText(item.question))) || 'Card no longer available';
                const reason = reasonLabel(item.reason);
                return (
                  <View
                    key={String(item.reportId)}
                    testID="my-reports-item"
                    style={styles.row}
                    accessible
                    accessibilityLabel={`${badge}. ${question}. ${reason}.${item.resolutionNote ? ` Author note: ${item.resolutionNote}` : ''}`}
                  >
                    <View style={styles.rowHead}>
                      <Text
                        testID="my-reports-badge"
                        style={[styles.badge, item.status === 'open' ? styles.badgeOpen : styles.badgeResolved]}
                        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
                      >
                        {badge}
                      </Text>
                      <Text style={styles.rowMeta} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                        {dayOf(item.createdAt)}
                      </Text>
                    </View>
                    <Text testID="my-reports-question" style={styles.question} numberOfLines={3}>
                      {question}
                    </Text>
                    <Text style={styles.rowMeta} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                      {reason}
                    </Text>
                    {item.resolutionNote ? (
                      <Text testID="my-reports-resolution-note" style={styles.note}>
                        {item.resolutionNote}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const cardShadow = {
  shadowColor: colors.shadowSoft,
  shadowOpacity: 1,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

// Text colours match MistakeBook's AA choices: inkSoft/inkSecondary on white and the gradient.
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  pressed: { opacity: 0.85 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  backChip: {
    minHeight: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    ...cardShadow,
  },
  backChipText: { color: colors.inkSoft, fontWeight: '900', fontSize: typography.bodySmall },
  title: { color: colors.inkSoft, fontSize: typography.title1, fontWeight: '900', marginBottom: spacing.xs },
  subtitle: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  skeletonRow: {
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    marginBottom: spacing.sm,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    marginTop: spacing.sm,
    ...cardShadow,
  },
  emptyTitle: { color: colors.inkSoft, fontSize: typography.title3, fontWeight: '900', marginBottom: spacing.sm },
  emptyBody: { color: colors.inkSecondary, fontSize: typography.body, lineHeight: 22, fontWeight: '600' },
  retry: {
    marginTop: spacing.md,
    minHeight: a11y.minTouch,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  retryText: { color: colors.inkSoft, fontWeight: '800', fontSize: typography.bodySmall },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, ...cardShadow },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  badge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: typography.caption,
    fontWeight: '900',
    color: colors.inkSoft,
  },
  badgeOpen: { backgroundColor: colors.pokeBlueFaint },
  badgeResolved: { backgroundColor: colors.parchmentBgDeep },
  question: { color: colors.inkSoft, fontSize: typography.body, lineHeight: 21, fontWeight: '700', marginBottom: 4 },
  rowMeta: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700' },
  note: { marginTop: 6, color: colors.inkSecondary, fontSize: typography.bodySmall, lineHeight: 19 },
});

export default MyReportsScreen;

import React, { useEffect, useState } from 'react';
import * as RN from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardExport } from '../../../types/deckExport';
import { stripInlineCode } from '../../../content/inlineCode';
import { questionA11yLabel, splitQuestionCode } from '../../../content/questionCode';
import { getFeatureFlags } from '../../../config/featureFlags';
import { formatRank } from '../library/libraryMapper';
import { CardAnswerSections } from './CardAnswerSections';
import { InlineCodeText } from './InlineCodeText';
import { QuestionCodeBlock } from '../session/QuestionCodeBlock';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { CHROME_MAX_FONT_SCALE } from '../../../theme/dynamicType';

// R22 §1.3, §6 — the learning step. The first time a learner meets a Q/A card
// the session teaches it instead of testing it. 2026-10-14 learning flow: the
// question comes first, alone; "Show answer" opens the answer sections and
// (when the cardSource flag is on) the citation; "Got it" then commits the card
// as a passed first review (hard, back tomorrow). There is no same-session
// recall check any more.
export const LEARNING_STUDY_COPY = {
  caption: 'NEW CARD',
  hintBeforeReveal: 'Think of your answer, then show it.',
  hintAfterReveal: 'Read it once. It comes back tomorrow.',
  showAnswer: 'Show answer',
  gotIt: 'Got it',
} as const;

type LoadedSource = { url: string; quote: string | null; host: string };

// Same lazy, guarded read as CardDetail: the reader reaches expo-file-system
// and aws-amplify, so it is imported only when a source is wanted.
async function loadSourceSafe(slug: string, uid: string): Promise<LoadedSource | null> {
  try {
    const mod = await import('../../../content/cardSource');
    const s = await mod?.getCardSource?.(slug, uid);
    return s ? { url: s.url, quote: s.quote, host: mod.sourceHostLabel(s.url) } : null;
  } catch {
    return null;
  }
}

function openSourceUrl(url: string) {
  if (!/^https:\/\//.test(url)) return;
  try {
    // Read off the namespace inside the try: test suites mock react-native without Linking.
    const linking = (RN as any).Linking;
    void Promise.resolve(linking?.openURL?.(url)).catch(() => undefined);
  } catch {
    /* no-op */
  }
}

export type LearningStudyViewProps = {
  card: CardExport;
  deckSlug: string;
  rank?: number | null;
  /** The learner tapped "Show answer": the answer sections and the source are on screen. */
  revealed?: boolean;
};

export const LearningStudyView = React.memo(function LearningStudyView(props: LearningStudyViewProps) {
  const { card, deckSlug, rank = null, revealed = false } = props;
  const orderBadge = typeof rank === 'number' && rank > 0 ? `#${formatRank(rank)}` : `#${card.OrderInDeck}`;
  const [source, setSource] = useState<LoadedSource | null>(null);
  const uid = card.StableUid;
  // Same split as ReviewBody: the prose, then the fenced code as a code block (never raw backticks).
  const question = React.useMemo(() => splitQuestionCode(card.Question), [card.Question]);

  useEffect(() => {
    setSource(null);
    // Defensive read: other suites mock getFeatureFlags without the key.
    if (getFeatureFlags().cardSource?.enabled === false) return undefined;
    let cancelled = false;
    void loadSourceSafe(deckSlug, uid).then((loaded) => {
      if (!cancelled) setSource(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [deckSlug, uid]);

  return (
    <View style={styles.card} testID="learning-study-view">
      <View style={styles.headerRow}>
        <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {LEARNING_STUDY_COPY.caption}
        </Text>
        <Text style={styles.order} numberOfLines={1} testID="review-order-badge">
          {orderBadge}
        </Text>
      </View>
      <InlineCodeText
        style={styles.question}
        testID="learning-study-question"
        accessibilityLabel={question.code ? stripInlineCode(questionA11yLabel(question)) : undefined}
        text={question.text}
      />
      {question.code ? <QuestionCodeBlock code={question.code} /> : null}
      {/* Question first: the answer and its source stay off screen until "Show answer". The source
          is still read on mount, so it is ready by the time the answer opens. */}
      {revealed ? (
        <View style={styles.answerWrap}>
          <CardAnswerSections card={card} testID="learning-study-answer" />
        </View>
      ) : null}
      {revealed && source ? (
        <Pressable
          testID="learning-study-source"
          accessibilityRole="link"
          accessibilityLabel={`Source, ${source.host}${source.quote !== null ? `: ${source.quote}` : ''}`}
          accessibilityHint="Opens the source in your browser"
          style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}
          onPress={() => openSourceUrl(source.url)}
        >
          <Text style={styles.sourceLabel} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
            SOURCE
          </Text>
          <Text testID="learning-study-source-host" style={styles.sourceHost} numberOfLines={1}>
            {source.host}
          </Text>
          {source.quote !== null ? (
            <Text testID="learning-study-source-quote" style={styles.sourceQuote} numberOfLines={3}>
              {source.quote}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
});

// The study view's one action at a time, rendered in the session's pinned dock where the rating
// buttons sit for every other card: "Show answer" until the answer is open, then "Got it". Got it
// is never offered before the learner has seen the answer.
export function LearningStudyDock(props: {
  revealed: boolean;
  disabled?: boolean;
  onShowAnswer: () => void;
  onGotIt: () => void;
}) {
  const { revealed, disabled = false, onShowAnswer, onGotIt } = props;
  return (
    <View style={styles.dock} testID="learning-study-dock">
      <Text
        style={styles.hint}
        numberOfLines={2}
        testID="learning-study-hint"
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      >
        {revealed ? LEARNING_STUDY_COPY.hintAfterReveal : LEARNING_STUDY_COPY.hintBeforeReveal}
      </Text>
      <Pressable
        key={revealed ? 'got-it' : 'show-answer'}
        testID={revealed ? 'learning-study-got-it' : 'learning-study-show-answer'}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={({ pressed }) => [styles.gotIt, pressed && styles.pressed, disabled && styles.disabled]}
        onPress={revealed ? onGotIt : onShowAnswer}
      >
        <Text style={styles.gotItText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {revealed ? LEARNING_STUDY_COPY.gotIt : LEARNING_STUDY_COPY.showAnswer}
        </Text>
      </Pressable>
    </View>
  );
}

export default LearningStudyView;

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: 6,
  },
  caption: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  order: {
    fontSize: typography.caption,
    color: colors.inkMuted,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  question: {
    fontSize: typography.title3,
    lineHeight: 24,
    color: colors.ink,
    fontWeight: '900',
  },
  answerWrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  sourceRow: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  sourceLabel: {
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '900',
    letterSpacing: 1.0,
    marginBottom: 4,
  },
  sourceHost: { fontSize: typography.bodySmall, color: colors.inkSecondary, fontWeight: '800' },
  sourceQuote: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.inkSoft,
    fontStyle: 'italic',
  },
  dock: {
    paddingBottom: spacing.xs,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  gotIt: {
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  gotItText: {
    color: '#FFFFFF',
    fontSize: typography.button,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.9 },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardExport } from '../../../types/deckExport';
import { formatRank } from '../library/libraryMapper';
import { CardAnswerSections, friendlyCodeLanguage } from './CardAnswerSections';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// ReviewBody v4 — full question, always.
//   • v3 clamped the question to numberOfLines 4 before reveal and 2
//     after ("questionCompact"). That was fine for one-line C# prompts
//     and wrong for the scenario stems the AWS / CCDV-F decks carry
//     (2–4 sentences, up to ~550 chars): the stem was cut with an
//     ellipsis and after reveal only two lines survived, so the learner
//     could not judge the answer against the question. v4 never clamps
//     the question. Before reveal it is the full-size title; after
//     reveal it stays above the answer in full, under a subtle
//     "Question" caption, so the answer is always read in context.
//   • No inner ScrollView (since v3): the outer SessionCardScreen
//     ScrollView scrolls the whole card — question + explanation + code
//     + usage — while the RatingBar dock stays pinned below it.
//   • Code samples: monospace CodeBlock in a horizontal ScrollView (long
//     JSON / bash lines never wrap) with a language caption.
//   • Dynamic Type: every text here uses RN's default font scaling, and
//     lineHeight scales with fontSize, so XL (fontScale 1.5) only makes
//     the card taller — the scroll absorbs it. The badge row wraps
//     instead of overflowing the card edge.
//   • Card chrome unchanged from v3: softCream + 18 radius + hairline +
//     subtle shadow (matches Home/CardDetail/Settings language).
export type ReviewBodyProps = {
  card: CardExport;
  /**
   * 1-based position in the deck (libraryMapper.rankCardsByOrder) — the same
   * "#011" the Library tile and DrawResult print. Null when the caller has no
   * deck to rank against; the badge then falls back to the raw OrderInDeck
   * rather than inventing a number.
   */
  rank?: number | null;
  faceUp: boolean;
  onFlip: () => void;
};

export const ReviewBody = React.memo(function ReviewBody(props: ReviewBodyProps) {
  const { card, rank = null, faceUp, onFlip } = props;
  const orderBadge = typeof rank === 'number' && rank > 0 ? `#${formatRank(rank)}` : `#${card.OrderInDeck}`;

  const difficultyLabel =
    card.Difficulty === 1 ? 'Easy' : card.Difficulty === 2 ? 'Medium' : 'Hard';

  // Map raw codeLanguage values to friendly user-facing labels.
  // Raw values like "cs" / "py" / "ts" are dev shorthand — users
  // shouldn't have to know that "cs" means C# in this badge.
  const codeLanguageLabel = card.CodeLanguage
    ? friendlyCodeLanguage(card.CodeLanguage)
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.order} numberOfLines={1} testID="review-order-badge">
          {orderBadge}
        </Text>
        <Text style={styles.badge} numberOfLines={1}>
          {difficultyLabel}
        </Text>
        {codeLanguageLabel ? (
          <Text style={styles.badgeSecondary} numberOfLines={1}>
            {codeLanguageLabel}
          </Text>
        ) : null}
      </View>

      {/* Question — rendered in full on both faces. Never clamp it: the
          scenario stems in the AWS / CCDV-F decks run 2–4 sentences and
          the learner has to see all of it to answer, and again to judge
          the answer after reveal. The outer ScrollView handles overflow. */}
      {!faceUp ? (
        <Text style={styles.question} testID="review-question">
          {card.Question}
        </Text>
      ) : (
        <View style={styles.questionRecap} testID="review-question-recap">
          <Text style={styles.questionCaption} numberOfLines={1}>
            QUESTION
          </Text>
          <Text style={styles.questionRecapText} testID="review-question">
            {card.Question}
          </Text>
        </View>
      )}

      {!faceUp ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.flipButton, pressed && styles.pressed]}
          onPress={onFlip}
        >
          <Text style={styles.flipText} numberOfLines={1}>
            Reveal answer
          </Text>
        </Pressable>
      ) : (
        <View style={styles.answerWrap}>
          <View style={styles.answerTopRow}>
            <Text style={styles.answerTitle} numberOfLines={1}>
              ANSWER
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.flipBackButton, pressed && styles.pressed]}
              onPress={onFlip}
            >
              <Text style={styles.flipBackText} numberOfLines={1}>
                Hide
              </Text>
            </Pressable>
          </View>

          {/* No nested ScrollView — the outer SessionCardScreen scroll
              handles overflow. The answer sections themselves (EXPLANATION /
              CODING SAMPLE / REAL USAGE, dividers, empty hint) live in the
              shared CardAnswerSections so the session reveal and CardDetail's
              "Show answer" render the exact same stack. */}
          <CardAnswerSections card={card} />
        </View>
      )}
    </View>
  );
});

export default ReviewBody;

const styles = StyleSheet.create({
  // Modern card chrome — softCream + 18 radius + hairline + soft shadow.
  // Matches the Home featured card / CardDetail / Settings language.
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
  order: {
    fontSize: typography.caption,
    color: colors.inkMuted,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  badge: {
    fontSize: typography.caption,
    color: colors.inkSoft,
    backgroundColor: 'rgba(200,136,58,0.18)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: 999,
    fontWeight: '800',
    overflow: 'hidden',
  },
  badgeSecondary: {
    fontSize: typography.caption,
    color: colors.inkMuted,
    backgroundColor: colors.parchmentBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: 999,
    fontWeight: '700',
    overflow: 'hidden',
  },
  question: {
    fontSize: typography.title3,
    lineHeight: 24,
    color: colors.ink,
    fontWeight: '900',
  },
  // Back-of-card recap — the full question stays above the answer so the
  // learner judges the answer against the stem, not against memory. Body
  // size (not title3) keeps a 500-char stem from eating the screen, and
  // inkSoft (not inkMuted) keeps it readable at paragraph length.
  questionRecap: {
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  questionCaption: {
    fontSize: typography.caption,
    color: colors.inkMuted,
    fontWeight: '800',
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  questionRecapText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  // Reveal answer — pokeBlue 56pt pill matching the rest of the app
  // (was colors.ink black 44pt — clashed with the warm cream bg).
  flipButton: {
    marginTop: spacing.md,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  flipText: {
    color: '#FFFFFF',
    fontSize: typography.button,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  // No nested card chrome — sections live directly inside the outer
  // card, separated by hairline dividers. Eliminates cream-on-cream
  // visual mush and recovers ~32pt of vertical room per section.
  answerWrap: {
    marginTop: spacing.xs,
  },
  answerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  answerTitle: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  flipBackButton: {
    minHeight: 36,
    minWidth: 56,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  flipBackText: {
    fontSize: typography.caption,
    color: colors.inkSoft,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  pressed: { opacity: 0.9 },
});

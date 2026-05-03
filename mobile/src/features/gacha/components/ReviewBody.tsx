import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport } from '../../../types/deckExport';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

export function ReviewBody(props: {
  card: CardExport;
  faceUp: boolean;
  onFlip: () => void;
}) {
  const { card, faceUp, onFlip } = props;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.order} numberOfLines={1}>
          #{card.OrderInDeck}
        </Text>
        <Text style={styles.badge} numberOfLines={1}>
          {card.Difficulty === 1 ? 'Easy' : card.Difficulty === 2 ? 'Medium' : 'Hard'}
        </Text>
        {card.CodeLanguage ? (
          <Text style={styles.badgeSecondary} numberOfLines={1}>
            {card.CodeLanguage}
          </Text>
        ) : null}
      </View>

      <Text style={styles.question} numberOfLines={2}>
        {card.Question}
      </Text>

      {!faceUp ? (
        <Pressable style={({ pressed }) => [styles.flipButton, pressed && styles.pressed]} onPress={onFlip}>
          <Text style={styles.flipText} numberOfLines={1}>
            Reveal answer
          </Text>
        </Pressable>
      ) : (
        <View style={styles.answerShell}>
          <View style={styles.answerTopRow}>
            <Text style={styles.answerTitle} numberOfLines={1}>
              Answer
            </Text>
            <Pressable style={({ pressed }) => [styles.flipBackButton, pressed && styles.pressed]} onPress={onFlip}>
              <Text style={styles.flipBackText} numberOfLines={1}>
                Hide
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.answerScroll}
            contentContainerStyle={styles.answerScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {card.Explanation ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionHeader} numberOfLines={1}>
                  Explanation
                </Text>
                <Text style={styles.sectionBody}>{card.Explanation}</Text>
              </View>
            ) : null}

            {card.CodeSnippet ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionHeader} numberOfLines={1}>
                  Coding sample
                </Text>
                <View style={styles.codeContainer}>
                  <CodeBlock
                    code={card.CodeSnippet}
                    language={normalizeCodeLanguage(card.CodeLanguage || 'javascript')}
                  />
                </View>
              </View>
            ) : null}

            {card.RealWorldUsage ? (
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionHeader} numberOfLines={1}>
                  Real usage
                </Text>
                <View style={styles.mdContainer}>{renderSimpleMarkdown(card.RealWorldUsage, styles)}</View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default ReviewBody;

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.cardRadius,
    padding: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  order: {
    fontSize: typography.caption,
    color: colors.inkSecondary,
    marginRight: 6,
  },
  badge: {
    fontSize: typography.caption,
    color: colors.ink,
    backgroundColor: 'rgba(200,136,58,0.18)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 4,
  },
  badgeSecondary: {
    fontSize: typography.caption,
    color: colors.inkSecondary,
    backgroundColor: 'rgba(42,34,24,0.08)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
  },
  question: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
  },
  flipButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '800',
  },
  answerShell: {
    marginTop: spacing.sm,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.14)',
    backgroundColor: 'rgba(255,255,255,0.84)',
    overflow: 'hidden',
  },
  answerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(42,34,24,0.1)',
  },
  answerTitle: {
    fontSize: typography.bodySmall,
    color: colors.ink,
    fontWeight: '800',
  },
  flipBackButton: {
    minHeight: 32,
    paddingHorizontal: spacing.xs,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: 'rgba(42,34,24,0.08)',
  },
  flipBackText: {
    fontSize: typography.caption,
    color: colors.ink,
    fontWeight: '700',
  },
  answerScroll: {
    maxHeight: 320,
  },
  answerScrollContent: {
    paddingBottom: spacing.sm,
  },
  sectionBlock: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  sectionHeader: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    marginTop: 6,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.inkSecondary,
  },
  codeContainer: {
    marginTop: 6,
    borderRadius: spacing.xs,
    overflow: 'hidden',
  },
  mdContainer: {
    marginTop: 6,
    paddingTop: 2,
  },
  mdBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  mdBullet: {
    width: 18,
    fontSize: 14,
    color: colors.inkSecondary,
    lineHeight: 18,
  },
  mdText: {
    flex: 1,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    lineHeight: 18,
  },
  pressed: { opacity: 0.9 },
});

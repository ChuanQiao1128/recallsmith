import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport } from '../../../types/deckExport';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// Map dev shorthand → human-readable label.
function friendlyCodeLanguage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    cs: 'C#',
    csharp: 'C#',
    'c#': 'C#',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    javascript: 'JavaScript',
    jsx: 'JSX',
    py: 'Python',
    python: 'Python',
    rb: 'Ruby',
    ruby: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    kotlin: 'Kotlin',
    swift: 'Swift',
    sql: 'SQL',
    sh: 'Shell',
    shell: 'Shell',
    bash: 'Bash',
    yml: 'YAML',
    yaml: 'YAML',
    json: 'JSON',
    cpp: 'C++',
    'c++': 'C++',
    c: 'C',
    php: 'PHP',
  };
  return map[lower] ?? raw;
}

// ReviewBody v3 — redesigned for multi-section answers (Explanation +
// Coding sample + Real usage all rendered together). Key changes:
//   • Removed the inner ScrollView with maxHeight 320pt (was the
//     primary cause of "card back too small" — three sections crushed
//     into a 320pt window). Outer SessionCardScreen ScrollView now
//     handles all scrolling.
//   • Removed the answerShell nested card-in-card chrome (was
//     cream-on-cream visual mush).
//   • Front face: question full-size + pokeBlue 56pt Reveal button.
//   • Back face: question collapses to a small caption header (saves
//     vertical room for the answer), each section uses gold uppercase
//     eyebrow + hairline divider between sections.
//   • Card chrome modernized: softCream + 18 radius + hairline +
//     subtle shadow (matches Home/CardDetail/Settings language).
export function ReviewBody(props: {
  card: CardExport;
  faceUp: boolean;
  onFlip: () => void;
}) {
  const { card, faceUp, onFlip } = props;

  const difficultyLabel =
    card.Difficulty === 1 ? 'Easy' : card.Difficulty === 2 ? 'Medium' : 'Hard';

  // Map raw codeLanguage values to friendly user-facing labels.
  // Raw values like "cs" / "py" / "ts" are dev shorthand — users
  // shouldn't have to know that "cs" means C# in this badge.
  const codeLanguageLabel = card.CodeLanguage
    ? friendlyCodeLanguage(card.CodeLanguage)
    : null;

  const sections: Array<{ key: string; label: string; node: React.ReactNode }> = [];
  if (card.Explanation) {
    sections.push({
      key: 'explanation',
      label: 'EXPLANATION',
      node: <Text style={styles.sectionBody}>{card.Explanation}</Text>,
    });
  }
  if (card.CodeSnippet) {
    sections.push({
      key: 'code',
      label: 'CODING SAMPLE',
      node: (
        <View style={styles.codeContainer}>
          <CodeBlock
            code={card.CodeSnippet}
            language={normalizeCodeLanguage(card.CodeLanguage || 'javascript')}
          />
        </View>
      ),
    });
  }
  if (card.RealWorldUsage) {
    sections.push({
      key: 'usage',
      label: 'REAL USAGE',
      node: <View style={styles.mdContainer}>{renderSimpleMarkdown(card.RealWorldUsage, styles)}</View>,
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.order} numberOfLines={1}>
          #{card.OrderInDeck}
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

      {/* Question — full prominence on the front (max 4 lines so even
          long questions wrap properly), demoted to a small caption when
          the answer is showing (so the back gets full real estate for
          its 3 sections). */}
      {!faceUp ? (
        <Text style={styles.question} numberOfLines={4}>
          {card.Question}
        </Text>
      ) : (
        <Text style={styles.questionCompact} numberOfLines={2}>
          {card.Question}
        </Text>
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
              handles overflow. Sections render in order with hairline
              dividers between them so multi-section answers (3+
              blocks) read as a clean stack instead of a cramped column. */}
          {sections.length === 0 ? (
            <Text style={styles.emptyAnswerHint} numberOfLines={2}>
              No answer body for this card yet.
            </Text>
          ) : (
            sections.map((section, index) => (
              <View key={section.key}>
                {index > 0 ? <View style={styles.sectionDivider} /> : null}
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionHeader} numberOfLines={1}>
                    {section.label}
                  </Text>
                  {section.node}
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

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
  // Compact form for back-of-card — question shrinks to give the
  // answer body more room when 3 sections are stacked.
  questionCompact: {
    fontSize: typography.bodySmall,
    lineHeight: 18,
    color: colors.inkMuted,
    fontWeight: '700',
    marginBottom: spacing.xs,
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
  emptyAnswerHint: {
    fontSize: typography.bodySmall,
    color: colors.inkMuted,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  sectionBlock: {
    paddingVertical: spacing.sm,
  },
  // Hairline between sections — light enough to read as a separator,
  // dark enough to give each block visual breathing room.
  sectionDivider: {
    height: 1,
    backgroundColor: colors.hairline,
    marginHorizontal: 0,
  },
  sectionHeader: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSoft,
    fontWeight: '500',
  },
  codeContainer: {
    marginTop: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  mdContainer: {
    marginTop: 2,
  },
  mdBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  mdBullet: {
    width: 18,
    fontSize: 14,
    color: colors.gold,
    lineHeight: 20,
    fontWeight: '900',
  },
  mdText: {
    flex: 1,
    fontSize: typography.body,
    color: colors.inkSoft,
    lineHeight: 22,
    fontWeight: '500',
  },
  pressed: { opacity: 0.9 },
});

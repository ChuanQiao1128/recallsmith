import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport } from '../../../types/deckExport';
import { splitKeyLine, type AnswerKeyLine } from '../../../content/answerKeyLine';
import { stripInlineCode } from '../../../content/inlineCode';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
import { InlineCodeText } from './InlineCodeText';
import { cardSectionLabels, cardTextA11yProps, useCardTextLang, type CardTextLang } from './CardTextLang';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// Map dev shorthand → human-readable label.
export function friendlyCodeLanguage(raw: string): string {
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
    md: 'Markdown',
    markdown: 'Markdown',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    toml: 'TOML',
    http: 'HTTP',
    text: 'Text',
  };
  return map[lower] ?? raw;
}

export const ANSWER_KEY_LINE_TEST_ID = 'answer-key-line';

// Spoken label for the highlighted key line: VoiceOver cannot see the highlight
// the rating hint points at, so the line says what it is before its text. A card
// shown in Chinese is spoken in Chinese, so its prefix is Chinese too.
export function keyLineA11yLabel(keyLine: string, lang?: CardTextLang): string {
  return lang === 'zh-CN' ? `重点句：${stripInlineCode(keyLine)}` : `Highlighted line, ${stripInlineCode(keyLine)}`;
}

// 2026-10-14 learning flow (B3): an answer that opens with 答： shows that line
// first, bold, in a tinted block with an accent rule, then the remaining lines
// exactly as the plain explanation renders them. It is the first thing read
// after the EXPLANATION caption, on screen and by VoiceOver.
function ExplanationWithKeyLine(props: { split: AnswerKeyLine; lang: CardTextLang }) {
  const { split, lang } = props;
  return (
    <View>
      <View style={styles.keyLineBlock} testID={ANSWER_KEY_LINE_TEST_ID}>
        <InlineCodeText
          style={styles.keyLineText}
          accessibilityLabel={keyLineA11yLabel(split.keyLine, lang)}
          text={split.keyLine}
        />
      </View>
      {split.rest ? <InlineCodeText style={styles.sectionBody} text={split.rest} /> : null}
    </View>
  );
}

// The answer renderer shared by the session's ReviewBody (after reveal), the
// study view (after Show answer) and CardDetail's "Show answer" toggle:
// EXPLANATION / CODING SAMPLE / REAL USAGE, in card order, separated by hairline
// dividers, with the empty-state hint when a card carries no answer body.
// Extracted from ReviewBody so every surface renders byte-for-byte the same
// sections — the same labels, order, CodeBlock wiring and empty hint — instead
// of drifting apart. The section labels follow the card's language
// (CardTextLangContext); the body text is whatever card the caller passes.
export function CardAnswerSections(props: { card: CardExport; testID?: string }) {
  const { card, testID } = props;
  const lang = useCardTextLang();
  const labels = cardSectionLabels(lang);

  const codeLanguageLabel = card.CodeLanguage
    ? friendlyCodeLanguage(card.CodeLanguage)
    : null;

  const sections: Array<{ key: string; label: string; node: React.ReactNode }> = [];
  if (card.Explanation) {
    // Null for every answer that does not open with 答： (all English decks): rendered as before.
    const keySplit = splitKeyLine(card.Explanation);
    sections.push({
      key: 'explanation',
      label: labels.explanation,
      node: keySplit ? (
        <ExplanationWithKeyLine split={keySplit} lang={lang} />
      ) : (
        <InlineCodeText style={styles.sectionBody} text={card.Explanation} />
      ),
    });
  }
  if (card.CodeSnippet) {
    sections.push({
      key: 'code',
      label: labels.code,
      node: (
        <View style={styles.codeContainer}>
          <CodeBlock
            code={card.CodeSnippet}
            language={normalizeCodeLanguage(card.CodeLanguage || 'javascript')}
            label={codeLanguageLabel ?? undefined}
          />
        </View>
      ),
    });
  }
  if (card.RealWorldUsage) {
    sections.push({
      key: 'usage',
      label: labels.usage,
      node: <View style={styles.mdContainer}>{renderSimpleMarkdown(card.RealWorldUsage, styles)}</View>,
    });
  }

  // No nested ScrollView — the outer screen scroll handles overflow. Sections
  // render in order with hairline dividers between them so multi-section
  // answers (3+ blocks) read as a clean stack instead of a cramped column.
  return (
    <View testID={testID}>
      {sections.length === 0 ? (
        <Text style={styles.emptyAnswerHint} numberOfLines={2}>
          No answer body for this card yet.
        </Text>
      ) : (
        sections.map((section, index) => (
          <View key={section.key}>
            {index > 0 ? <View style={styles.sectionDivider} /> : null}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionHeader} numberOfLines={1} {...cardTextA11yProps(lang)}>
                {section.label}
              </Text>
              {section.node}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

export default CardAnswerSections;

const styles = StyleSheet.create({
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
  // The 答 line: a soft peach tint with a gold rule on the left, set apart from
  // the lines below it without leaving the card's palette.
  keyLineBlock: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    backgroundColor: colors.softPeach,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  keyLineText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.ink,
    fontWeight: '800',
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
});

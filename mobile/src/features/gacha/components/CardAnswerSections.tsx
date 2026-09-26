import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport } from '../../../types/deckExport';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
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

// The answer renderer shared by the session's ReviewBody (after reveal) and
// CardDetail's "Show answer" toggle: EXPLANATION / CODING SAMPLE / REAL USAGE,
// in card order, separated by hairline dividers, with the empty-state hint when
// a card carries no answer body. Extracted from ReviewBody so both surfaces
// render byte-for-byte the same sections — the same labels, order, CodeBlock
// wiring and empty hint — instead of drifting apart.
export function CardAnswerSections(props: { card: CardExport; testID?: string }) {
  const { card, testID } = props;

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
            label={codeLanguageLabel ?? undefined}
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
              <Text style={styles.sectionHeader} numberOfLines={1}>
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

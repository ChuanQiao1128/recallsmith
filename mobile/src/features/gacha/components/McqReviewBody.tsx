import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import CodeBlock from '../../../components/CodeBlock';
import type { CardExport, McqExport, McqOption } from '../../../types/deckExport';
import { formatRank } from '../library/cardRank';
import { normalizeCodeLanguage, renderSimpleMarkdown } from '../session/reviewContentHelpers';
import {
  MCQ_COPY,
  MCQ_OVER_LIMIT_HINT_MS,
  MCQ_TEST_IDS,
  mcqBannerPartial,
  mcqKindChip,
  mcqLetter,
  mcqOptionA11yLabel,
  mcqQualifierBody,
  mcqWhyNotA11yLabel,
} from '../mcq/mcqConstants';
import { mcqRequiredCount } from '../mcq/normalizeMcq';
import { splitStemForOptions } from '../mcq/stemAsk';
import type { McqVerdict } from '../mcq/mcqVerdict';
import { colors } from '../../../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../../../theme/dynamicType';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// Map dev shorthand → human-readable label. Copied from ReviewBody (module-private there;
// ReviewBody is do-not-touch, so the MCQ body carries its own copy of the same table).
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

export type McqStage = 'stem' | 'options' | 'verdict';
export type McqOptionRowState = 'idle' | 'selected' | 'correct-picked' | 'correct-missed' | 'wrong-picked' | 'wrong-unpicked';

export function rowStateFor(option: McqOption, picked: boolean, stage: McqStage): McqOptionRowState {
  if (stage !== 'verdict') return picked ? 'selected' : 'idle';
  return option.correct ? (picked ? 'correct-picked' : 'correct-missed') : picked ? 'wrong-picked' : 'wrong-unpicked';
}

export type StemSegment = { text: string; emphasis: 'qualifier' | 'caps' | null };

// The stem is one Text. When the qualifier is present and occurs in the stem we bold that one
// phrase (case-insensitive first match, the stem's own casing kept); otherwise we fall back to
// bolding every all-caps run of four or more letters ("LEAST", "MOST"). The fallback is a
// fallback, not a demotion: a qualifier that the authoring pipeline dropped from the stem still
// gets the caps treatment so the constraint stays visible.
export function stemSegments(stem: string, qualifier: string | null): StemSegment[] {
  const trimmed = qualifier === null ? null : qualifier.trim();
  if (trimmed !== null && trimmed.length > 0) {
    const at = stem.toLowerCase().indexOf(trimmed.toLowerCase());
    if (at >= 0) {
      const segments: StemSegment[] = [];
      const before = stem.slice(0, at);
      const match = stem.slice(at, at + trimmed.length);
      const after = stem.slice(at + trimmed.length);
      if (before.length > 0) segments.push({ text: before, emphasis: null });
      segments.push({ text: match, emphasis: 'qualifier' });
      if (after.length > 0) segments.push({ text: after, emphasis: null });
      return segments;
    }
  }
  return capsSegments(stem);
}

function capsSegments(stem: string): StemSegment[] {
  const segments: StemSegment[] = [];
  const re = /\b[A-Z]{4,}\b/g;
  let last = 0;
  let match: RegExpExecArray | null = re.exec(stem);
  while (match !== null) {
    if (match.index > last) segments.push({ text: stem.slice(last, match.index), emphasis: null });
    segments.push({ text: match[0], emphasis: 'caps' });
    last = match.index + match[0].length;
    match = re.exec(stem);
  }
  if (last < stem.length) segments.push({ text: stem.slice(last), emphasis: null });
  if (segments.length === 0) segments.push({ text: stem, emphasis: null });
  return segments;
}

export const MCQ_BODY_TEST_IDS = Object.freeze({
  orderBadge: 'mcq-order-badge',
  stemCaps: 'mcq-stem-caps',
  optionText: (key: string) => `mcq-option-text-${key}`,
  rowGlyph: (key: string) => `mcq-row-glyph-${key}`,
  rowLabel: (key: string) => `mcq-row-label-${key}`,
});

export type McqReviewBodyProps = {
  card: CardExport;
  mcq: McqExport;                      // already normalised (resolveMcq)
  rank?: number | null;                // same "#011" badge as ReviewBody (formatRank)
  stage: McqStage;
  shownOrder: readonly McqOption[];    // display order; letter = mcqLetter(index)
  picks: readonly string[];            // option keys in pick order
  verdict: McqVerdict | null;          // non-null only in 'verdict'
  scheduleLine: string | null;         // describeScheduledRating(...).line, non-null only in 'verdict'
  attemptIndex: number;                // ≥ 1 → redeal banner (MCQ_COPY.redeal, testID redealBanner)
  onToggleOption: (key: string) => void;
  onOverLimit?: () => void;            // multi-select tap beyond requiredCount (parent does the haptic)
};

function glyphFor(state: McqOptionRowState): string {
  if (state === 'correct-picked') return '✔';
  if (state === 'correct-missed') return '✓';
  if (state === 'wrong-picked') return '✗';
  return '';
}

function labelFor(state: McqOptionRowState): string {
  if (state === 'correct-picked') return MCQ_COPY.rowCorrectPicked;
  if (state === 'correct-missed') return MCQ_COPY.rowCorrectMissed;
  if (state === 'wrong-picked') return MCQ_COPY.rowWrongPicked;
  return '';
}

type RowStyleKey = 'rowIdle' | 'rowSelected' | 'rowCorrectPicked' | 'rowCorrectMissed' | 'rowWrongPicked' | 'rowWrongUnpicked';

function rowStyleKey(state: McqOptionRowState): RowStyleKey {
  switch (state) {
    case 'selected':
      return 'rowSelected';
    case 'correct-picked':
      return 'rowCorrectPicked';
    case 'correct-missed':
      return 'rowCorrectMissed';
    case 'wrong-picked':
      return 'rowWrongPicked';
    case 'wrong-unpicked':
      return 'rowWrongUnpicked';
    default:
      return 'rowIdle';
  }
}

export const McqReviewBody = React.memo(function McqReviewBody(props: McqReviewBodyProps) {
  const {
    card,
    mcq,
    rank = null,
    stage,
    shownOrder,
    picks,
    verdict,
    scheduleLine,
    attemptIndex,
    onToggleOption,
    onOverLimit,
  } = props;

  const [stemExpanded, setStemExpanded] = useState(false);
  const [overLimit, setOverLimit] = useState(false);
  const [expandedWhy, setExpandedWhy] = useState<readonly string[]>([]);

  // D05 keeps one body mounted across cards — reset the local view state when the card (or the
  // attempt within it) changes.
  useEffect(() => {
    setStemExpanded(false);
    setOverLimit(false);
    setExpandedWhy([]);
  }, [card.StableUid, attemptIndex]);

  // The over-limit hint appears on an ignored tap and clears on the next change of picks or stage,
  // or on its own after MCQ_OVER_LIMIT_HINT_MS (review 2026-09-22 #5: a hint that only clears on
  // the next tap outlives the mistake it answers). The VoiceOver announcement for the same tap is
  // the parent's job (onOverLimit), the same split as the verdict announcement — D04 brief Constraints.
  useEffect(() => {
    setOverLimit(false);
  }, [picks.join('|'), stage]);
  useEffect(() => {
    if (!overLimit) return undefined;
    const timer = setTimeout(() => setOverLimit(false), MCQ_OVER_LIMIT_HINT_MS);
    return () => clearTimeout(timer);
  }, [overLimit]);

  const requiredCount = mcqRequiredCount(mcq);
  const orderBadge = typeof rank === 'number' && rank > 0 ? `#${formatRank(rank)}` : `#${card.OrderInDeck}`;
  const difficultyLabel = card.Difficulty === 1 ? 'Easy' : card.Difficulty === 2 ? 'Medium' : 'Hard';
  // On the options stage the scenario lead-in is clamped to two lines, but the
  // actual ask (and its MOST/LEAST qualifier) always renders in full (MCORE-02).
  // A one-sentence stem has no lead-in to clamp, so it is never collapsed.
  const split = splitStemForOptions(card.Question, mcq.qualifier);
  const collapsed = stage === 'options' && !stemExpanded && split.leadIn.length > 0;
  const segments = stemSegments(collapsed ? split.ask : card.Question, mcq.qualifier);
  const showOptions = stage === 'options' || stage === 'verdict';
  // k for the partial banner (gap #10): distinct-by-list correct picks.
  const k = shownOrder.filter((option) => option.correct && picks.includes(option.key)).length;

  const handleTap = (key: string, picked: boolean): void => {
    if (requiredCount === 1) {
      onToggleOption(key);
      return;
    }
    if (!picked && picks.length >= requiredCount) {
      setOverLimit(true);
      onOverLimit?.();
      return;
    }
    onToggleOption(key);
  };

  const toggleWhy = (key: string) => (): void => {
    setExpandedWhy((prev) => (prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]));
  };

  const sections: Array<{ key: string; testID: string; label: string; node: React.ReactNode }> = [];
  if (stage === 'verdict') {
    if (card.Explanation) {
      sections.push({
        key: 'explanation',
        testID: MCQ_TEST_IDS.sectionExplanation,
        label: MCQ_COPY.sectionExplanation,
        node: <Text style={styles.sectionBody}>{card.Explanation}</Text>,
      });
    }
    if (mcq.qualifier !== null) {
      sections.push({
        key: 'qualifier',
        testID: MCQ_TEST_IDS.sectionQualifier,
        label: MCQ_COPY.sectionQualifier,
        node: <Text style={styles.sectionBody}>{mcqQualifierBody(mcq.qualifier)}</Text>,
      });
    }
    if (card.RealWorldUsage) {
      sections.push({
        key: 'usage',
        testID: MCQ_TEST_IDS.sectionUsage,
        label: MCQ_COPY.sectionUsage,
        node: <View style={styles.mdContainer}>{renderSimpleMarkdown(card.RealWorldUsage, styles)}</View>,
      });
    }
    if (card.CodeSnippet) {
      sections.push({
        key: 'code',
        testID: MCQ_TEST_IDS.sectionCode,
        label: MCQ_COPY.sectionCode,
        node: (
          <View style={styles.codeContainer}>
            <CodeBlock
              code={card.CodeSnippet}
              language={normalizeCodeLanguage(card.CodeLanguage || 'javascript')}
              label={card.CodeLanguage ? friendlyCodeLanguage(card.CodeLanguage) : undefined}
            />
          </View>
        ),
      });
    }
  }

  return (
    <View style={styles.card} testID={MCQ_TEST_IDS.body}>
      {attemptIndex >= 1 ? (
        <Text testID={MCQ_TEST_IDS.redealBanner} style={styles.redeal}>
          {MCQ_COPY.redeal}
        </Text>
      ) : null}

      <View style={styles.headerRow}>
        <Text testID="mcq-order-badge" style={styles.order} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {orderBadge}
        </Text>
        <Text style={styles.badge} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {difficultyLabel}
        </Text>
        <Text testID={MCQ_TEST_IDS.kindChip} style={styles.chip} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {mcqKindChip(requiredCount)}
        </Text>
      </View>

      {collapsed ? (
        <Text testID={MCQ_TEST_IDS.stemLead} style={[styles.stem, styles.stemLead]} numberOfLines={2}>
          {split.leadIn}
        </Text>
      ) : null}

      <Text testID={MCQ_TEST_IDS.stem} style={styles.stem}>
        {segments.map((seg, i) =>
          seg.emphasis === null ? (
            seg.text
          ) : (
            <Text
              key={i}
              testID={seg.emphasis === 'qualifier' ? MCQ_TEST_IDS.qualifier : MCQ_BODY_TEST_IDS.stemCaps}
              style={styles.stemEmphasis}
            >
              {seg.text}
            </Text>
          ),
        )}
      </Text>

      {collapsed ? (
        <Pressable
          testID={MCQ_TEST_IDS.showFullStem}
          accessibilityRole="button"
          onPress={() => setStemExpanded(true)}
          style={({ pressed }) => [styles.showFull, pressed && styles.pressed]}
        >
          <Text numberOfLines={1} style={styles.showFullText}>
            {MCQ_COPY.showFullStem}
          </Text>
        </Pressable>
      ) : null}

      {stage === 'stem' ? (
        <Text testID={MCQ_TEST_IDS.stemHint} style={styles.stemHint}>
          {MCQ_COPY.stemHint}
        </Text>
      ) : null}

      {showOptions ? (
        <View style={styles.optionList}>
          {shownOrder.map((option, index) => {
            const picked = picks.includes(option.key);
            const state = rowStateFor(option, picked, stage);
            const letter = mcqLetter(index);
            const label = mcqOptionA11yLabel(index, shownOrder.length, option.text);
            const glyph = glyphFor(state);
            const rowLabel = labelFor(state);
            const expanded = expandedWhy.includes(option.key);
            return (
              <View key={option.key}>
                <Pressable
                  testID={MCQ_TEST_IDS.option(option.key)}
                  accessibilityRole={requiredCount === 1 ? 'radio' : 'checkbox'}
                  accessibilityState={stage === 'verdict' ? { checked: picked, disabled: true } : { checked: picked }}
                  accessibilityLabel={stage === 'verdict' && rowLabel ? `${label}. ${rowLabel}` : label}
                  disabled={stage === 'verdict'}
                  onPress={stage === 'verdict' ? undefined : () => handleTap(option.key, picked)}
                  style={[styles.optionRow, styles[rowStyleKey(state)]]}
                >
                  <View style={[styles.letterDisc, state === 'wrong-unpicked' && styles.letterDiscDimmed]}>
                    <Text testID={MCQ_TEST_IDS.optionLetter(option.key)} numberOfLines={1} style={styles.letter} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                      {letter}
                    </Text>
                  </View>
                  <View style={styles.optionBody}>
                    {glyph || rowLabel ? (
                      <View style={styles.rowStatus}>
                        {glyph ? (
                          <Text testID={MCQ_BODY_TEST_IDS.rowGlyph(option.key)} style={styles.rowGlyph}>
                            {glyph}
                          </Text>
                        ) : null}
                        {rowLabel ? (
                          <Text testID={MCQ_BODY_TEST_IDS.rowLabel(option.key)} style={styles.rowLabel}>
                            {rowLabel}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    <Text
                      testID={MCQ_BODY_TEST_IDS.optionText(option.key)}
                      style={[styles.optionText, state === 'wrong-unpicked' && styles.optionTextMuted]}
                    >
                      {option.text}
                    </Text>
                  </View>
                </Pressable>

                {stage === 'verdict' && state === 'wrong-picked' ? (
                  <Text testID={MCQ_TEST_IDS.why(option.key)} style={styles.why}>
                    {option.why}
                  </Text>
                ) : null}
                {stage === 'verdict' && state === 'wrong-unpicked' ? (
                  <Pressable
                    testID={MCQ_TEST_IDS.whyToggle(option.key)}
                    accessibilityRole="button"
                    accessibilityLabel={mcqWhyNotA11yLabel(index)}
                    accessibilityState={{ expanded }}
                    onPress={toggleWhy(option.key)}
                    style={({ pressed }) => [styles.whyToggle, pressed && styles.pressed]}
                  >
                    <Text numberOfLines={1} style={styles.whyToggleText}>
                      {MCQ_COPY.rowWhyNot}
                    </Text>
                  </Pressable>
                ) : null}
                {stage === 'verdict' && state === 'wrong-unpicked' && expanded ? (
                  <Text testID={MCQ_TEST_IDS.why(option.key)} style={styles.why}>
                    {option.why}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {overLimit ? (
            <Text testID={MCQ_TEST_IDS.overLimitHint} style={styles.overLimit}>
              {MCQ_COPY.overLimit}
            </Text>
          ) : null}
        </View>
      ) : null}

      {stage === 'verdict' ? (
        <View style={styles.verdictBlock}>
          <Text testID={MCQ_TEST_IDS.verdictBanner} style={styles.banner}>
            {verdict === 'correct'
              ? MCQ_COPY.bannerCorrect
              : verdict === 'partial'
                ? mcqBannerPartial(k, requiredCount)
                : MCQ_COPY.bannerWrong}
          </Text>
          {scheduleLine !== null ? (
            <Text testID={MCQ_TEST_IDS.scheduleLine} style={styles.scheduleLine}>
              {scheduleLine}
            </Text>
          ) : null}
        </View>
      ) : null}

      {stage === 'verdict'
        ? sections.map((section, index) => (
            <View key={section.key} testID={section.testID}>
              {index > 0 ? <View style={styles.sectionDivider} /> : null}
              <View style={styles.sectionBlock}>
                <Text style={styles.sectionHeader} numberOfLines={1}>
                  {section.label}
                </Text>
                {section.node}
              </View>
            </View>
          ))
        : null}
    </View>
  );
});

export default McqReviewBody;

const styles = StyleSheet.create({
  // Card chrome mirrors ReviewBody (softCream + 18 radius + hairline + soft shadow).
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
  redeal: {
    fontSize: typography.bodySmall,
    color: colors.gold,
    fontWeight: '800',
    marginBottom: spacing.sm,
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
  chip: {
    fontSize: typography.caption,
    color: colors.pokeBlueDeep,
    backgroundColor: colors.pokeBlueFaint,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: 999,
    fontWeight: '800',
    overflow: 'hidden',
  },
  stem: {
    fontSize: typography.title3,
    lineHeight: 24,
    color: colors.inkSoft,
    fontWeight: '700',
  },
  stemEmphasis: {
    fontWeight: '900',
    color: colors.ink,
  },
  // The clamped scenario lead-in reads as secondary to the ask below it.
  stemLead: {
    color: colors.inkMuted,
  },
  showFull: {
    marginTop: spacing.xs,
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  showFullText: {
    fontSize: typography.bodySmall,
    color: colors.pokeBlueDeep,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  stemHint: {
    marginTop: spacing.sm,
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  optionList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  optionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowIdle: {
    borderColor: colors.hairline,
    backgroundColor: 'transparent',
  },
  rowSelected: {
    borderColor: colors.pokeBlue,
    backgroundColor: colors.pokeBlueFaint,
  },
  rowCorrectPicked: {
    borderColor: colors.mint,
    backgroundColor: 'rgba(126,157,94,0.14)',
  },
  rowCorrectMissed: {
    borderColor: colors.mint,
    backgroundColor: 'transparent',
  },
  rowWrongPicked: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(170,54,54,0.10)',
  },
  // Full opacity (review 2026-09-22 #4): the old `opacity: 0.55` blended inkSoft to #91867A on the
  // softCream card, 3.29:1 — below AA for body text. The row keeps its hairline and the "faded"
  // reading moves to two places that are not the text: a muted-but-AA ink on the option text
  // (optionTextMuted) and a dimmed letter disc (letterDiscDimmed; the letter is also spoken in the
  // row's accessibility label, so the disc is decorative).
  rowWrongUnpicked: {
    borderColor: colors.hairline,
    backgroundColor: 'transparent',
  },
  letterDisc: {
    minWidth: 26,
    minHeight: 26,
    borderRadius: 13,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.parchmentBgDeep,
  },
  letterDiscDimmed: {
    opacity: 0.55,
  },
  letter: {
    fontSize: typography.bodySmall,
    fontWeight: '900',
    color: colors.inkSoft,
  },
  optionBody: {
    flex: 1,
  },
  rowStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  rowGlyph: {
    fontSize: typography.body,
    fontWeight: '900',
    color: colors.inkSoft,
  },
  rowLabel: {
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkSecondary,
  },
  optionText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSoft,
    fontWeight: '500',
  },
  // inkSecondary #5A4B38 on the softCream card #FCF5EA (the wrong-unpicked row is transparent):
  // 7.76:1, AA and AAA for body text; inkSoft is 12.43:1, so the step down still reads as muted.
  optionTextMuted: {
    color: colors.inkSecondary,
  },
  why: {
    marginTop: 6,
    marginLeft: 26 + spacing.sm,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.inkSecondary,
    fontWeight: '500',
  },
  whyToggle: {
    marginTop: 6,
    marginLeft: 26 + spacing.sm,
    minHeight: 36,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  whyToggleText: {
    fontSize: typography.bodySmall,
    color: colors.pokeBlueDeep,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  overLimit: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.danger,
    fontWeight: '700',
  },
  verdictBlock: {
    marginTop: spacing.md,
  },
  banner: {
    fontSize: typography.title3,
    fontWeight: '900',
    color: colors.ink,
  },
  scheduleLine: {
    marginTop: 6,
    fontSize: typography.bodySmall,
    lineHeight: 20,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  sectionBlock: {
    paddingVertical: spacing.sm,
  },
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

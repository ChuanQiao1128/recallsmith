import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

// StatePanel — the "soft cream surface with eyebrow + title + body
// + action area" pattern that recurs on most screens (Home account
// card, Library banner, SessionSummary reward block, DrawResult
// featured card frame, etc.).
//
// Why a component: the panel chrome (radius, shadow, padding,
// eyebrow position) is brand voice. Without a single component,
// each surface drifts a little — different padding, different
// eyebrow color, slightly different shadow — and the product loses
// coherence over time.

type Props = {
  /** Tiny caps line above the title — "✦ TODAY", "+2 PULLS", etc. */
  eyebrow?: string;
  /** Headline of the panel. */
  title: string;
  /** Optional explanatory body text below the title. */
  body?: string;
  /** Optional render slot below body — usually a CTA or chip row. */
  children?: React.ReactNode;
  /** Background tone — soft cream is default, mist for "secondary". */
  tone?: 'cream' | 'mist' | 'peach';
  /** Optional eyebrow color override (default gold). */
  eyebrowColor?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function StatePanel({ eyebrow, title, body, children, tone = 'cream', eyebrowColor = colors.gold, testID, style }: Props) {
  const bg =
    tone === 'mist'
      ? colors.softMist
      : tone === 'peach'
        ? colors.softPeach
        : colors.softCream;

  return (
    <View style={[styles.panel, { backgroundColor: bg }, style]} testID={testID}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: eyebrowColor }]}>{eyebrow}</Text> : null}
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {children ? <View style={styles.slot}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: spacing.cardRadius + 4,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  eyebrow: {
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: { fontSize: typography.title3, fontWeight: '900', color: colors.inkSoft, lineHeight: 22 },
  body: { fontSize: typography.bodySmall, color: colors.inkMuted, marginTop: 6, lineHeight: 18 },
  slot: { marginTop: spacing.sm },
});

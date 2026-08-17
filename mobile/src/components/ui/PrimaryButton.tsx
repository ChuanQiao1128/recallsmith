import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';

import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

// PrimaryButton — the brand pokeBlue 56pt CTA used on every "do the
// thing" surface (Home study link, Welcome continue, SessionSummary
// rewards CTA, Draw open-pack, Permission allow, etc.).
//
// Why a component: this exact button shape was duplicated across
// 12+ screens. Even small changes (a tighter radius, a different
// disabled tone) used to require a 12-screen sweep. Centralizing
// here means brand timing and color stay coherent for free.

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Tone variant — primary is brand pokeBlue, gold is for celebration moments. */
  tone?: 'primary' | 'gold' | 'danger';
  /** Optional eyebrow (small caps line above the label, e.g. "✦ READY"). */
  eyebrow?: string;
  /** Optional sub-line below the label (e.g. "Pulls available: 3"). */
  hint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export function PrimaryButton({ label, onPress, disabled, tone = 'primary', eyebrow, hint, testID, style, labelStyle }: Props) {
  const palette =
    tone === 'gold'
      ? { bg: colors.glowGold, bgPressed: colors.gold, text: colors.ink }
      : tone === 'danger'
        ? { bg: colors.danger, bgPressed: '#8B2929', text: '#fff' }
        : { bg: colors.pokeBlue, bgPressed: colors.pokeBlueDeep, text: '#fff' };

  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed && !disabled ? palette.bgPressed : palette.bg },
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: palette.text }]}>{eyebrow}</Text> : null}
        <Text style={[styles.label, { color: palette.text }, labelStyle]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? <Text style={[styles.hint, { color: palette.text }]}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: spacing.buttonRadius + 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  inner: { alignItems: 'center', justifyContent: 'center' },
  eyebrow: {
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.4,
    opacity: 0.85,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  label: { fontSize: typography.button + 1, fontWeight: '900', letterSpacing: 0.4 },
  hint: { fontSize: typography.caption, fontWeight: '600', opacity: 0.85, marginTop: 2 },
});

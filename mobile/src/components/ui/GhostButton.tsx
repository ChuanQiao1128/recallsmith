import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';

import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

// GhostButton — transparent secondary action with hairline border.
// Brand language: ghost buttons are "I'm here if you need me, but
// I'm not the path the product wants you to take" (Skip, Cancel,
// Sign in instead, Open 1 vs Open 10).

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export function GhostButton({ label, onPress, disabled, testID, style, labelStyle }: Props) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  buttonPressed: { backgroundColor: 'rgba(67,42,18,0.04)' },
  buttonDisabled: { opacity: 0.4 },
  label: { fontSize: typography.button, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.3 },
});

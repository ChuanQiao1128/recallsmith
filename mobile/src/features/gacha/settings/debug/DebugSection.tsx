import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const DEBUG_COPY = {
  title: 'Debug',
  body: 'Developer-only tools for local diagnostics.',
  action: 'Open debug menu',
} as const;

export function DebugSection(props: { onOpenDebug: () => void }) {
  const { onOpenDebug } = props;

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {DEBUG_COPY.title}
      </Text>
      <Text style={styles.sectionBody} numberOfLines={1}>
        {DEBUG_COPY.body}
      </Text>
      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onOpenDebug}>
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {DEBUG_COPY.action}
        </Text>
      </Pressable>
    </View>
  );
}

export default DebugSection;

const styles = StyleSheet.create({
  sectionCard: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.9,
  },
});

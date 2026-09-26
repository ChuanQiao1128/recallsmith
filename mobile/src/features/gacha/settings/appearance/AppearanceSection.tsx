import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const APPEARANCE_COPY = {
  title: 'Appearance',
  body: 'Keep contrast high so daily reviews stay readable.',
} as const;

export function AppearanceSection() {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {APPEARANCE_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>
        {APPEARANCE_COPY.body}
      </Text>
    </View>
  );
}

export default AppearanceSection;

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
});

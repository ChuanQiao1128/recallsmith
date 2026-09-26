import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AudiencePreference } from '../../audience/audiencePrefs';
import { getAudiencePreferenceLabel } from '../../audience/audienceRules';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const CONTENT_COPY = {
  title: 'Content preferences',
  body: "Choose who today's new cards are aimed at.",
  chips: [
    { key: 'junior', label: getAudiencePreferenceLabel('junior') },
    { key: 'both', label: getAudiencePreferenceLabel('both') },
    { key: 'all', label: getAudiencePreferenceLabel('all') },
  ] as Array<{ key: AudiencePreference; label: string }>,
  current: (pref: AudiencePreference) => `Current lane: ${getAudiencePreferenceLabel(pref)}`,
} as const;

export function ContentSection(props: {
  audience: AudiencePreference;
  saving: boolean;
  onSelect: (next: AudiencePreference) => void;
}) {
  const { audience, saving, onSelect } = props;

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {CONTENT_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>
        {CONTENT_COPY.body}
      </Text>

      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {CONTENT_COPY.chips.map((chip) => {
          const active = chip.key === audience;
          return (
            <Pressable
              key={chip.key}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                (pressed || saving) && styles.pressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, checked: active, disabled: saving }}
              onPress={() => onSelect(chip.key)}
              disabled={saving}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.metaText}>
        {CONTENT_COPY.current(audience)}
      </Text>
    </View>
  );
}

export default ContentSection;

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
  chipRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  chipActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  chipText: {
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  chipTextActive: {
    color: colors.parchmentBg,
  },
  metaText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});

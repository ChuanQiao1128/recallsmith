import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import { ToggleRow } from '../feedback/FeedbackSection';
import type { PrivacyPrefs } from '../privacyPrefs';

export const PRIVACY_COPY = {
  title: 'Privacy',
  shareLabel: 'Share anonymous usage counts',
  shareBody:
    'Counts of first steps, like finishing setup or opening a first pack. No account, email or device ID is sent.',
} as const;

export function PrivacySection(props: { prefs: PrivacyPrefs; onToggleShare: (value: boolean) => void }) {
  const { prefs, onToggleShare } = props;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {PRIVACY_COPY.title}
      </Text>
      <ToggleRow
        testID="settings-share-usage-counts-toggle"
        label={PRIVACY_COPY.shareLabel}
        body={PRIVACY_COPY.shareBody}
        value={prefs.shareUsageCounts}
        onPress={() => onToggleShare(!prefs.shareUsageCounts)}
      />
    </View>
  );
}

export default PrivacySection;

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
});

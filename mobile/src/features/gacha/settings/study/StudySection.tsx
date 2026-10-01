import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import { ToggleRow } from '../feedback/FeedbackSection';
import type { StudyPrefs } from '../../study/studyPrefs';

export const STUDY_COPY = {
  title: 'Study',
  fourButtonsLabel: 'Show all four rating buttons',
  fourButtonsBody: 'Rate cards with Again, Hard, Good and Easy instead of Forgot and Remembered.',
} as const;

export function StudySection(props: { prefs: StudyPrefs; onToggleFourButtons: (value: boolean) => void }) {
  const { prefs, onToggleFourButtons } = props;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {STUDY_COPY.title}
      </Text>
      <ToggleRow
        testID="settings-four-buttons-toggle"
        label={STUDY_COPY.fourButtonsLabel}
        body={STUDY_COPY.fourButtonsBody}
        value={prefs.fourButtons}
        onPress={() => onToggleFourButtons(!prefs.fourButtons)}
      />
    </View>
  );
}

export default StudySection;

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

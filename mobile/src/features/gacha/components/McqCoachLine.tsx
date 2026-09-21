import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MCQ_COPY, MCQ_TEST_IDS } from '../mcq/mcqConstants';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// One-time dismissible hint for the new card type. The device-global "seen" flag lives in
// mcqCoachPrefs; marking it is the parent's job (D05). This component is presentational: it
// renders the band when visible and calls onDismiss when the button is tapped, nothing else.
export type McqCoachLineProps = { visible: boolean; onDismiss: () => void; testID?: string /* 'mcq-coach-line' */ };

export function McqCoachLine(props: McqCoachLineProps) {
  const { visible, onDismiss, testID } = props;
  if (!visible) return null;

  return (
    <View testID={testID ?? MCQ_TEST_IDS.coachLine} style={styles.band}>
      <Text style={styles.copy}>{MCQ_COPY.coach}</Text>
      <Pressable
        testID={MCQ_TEST_IDS.coachDismiss}
        accessibilityRole="button"
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.dismissText}>
          {MCQ_COPY.coachDismiss}
        </Text>
      </Pressable>
    </View>
  );
}

export default McqCoachLine;

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.parchmentBgDeep,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  copy: {
    flex: 1,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  dismiss: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pokeBlue,
  },
  dismissText: {
    color: '#FFFFFF',
    fontSize: typography.button,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  pressed: { opacity: 0.9 },
});

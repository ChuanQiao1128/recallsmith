import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MCQ_COPY, MCQ_TEST_IDS, mcqSelectedCount } from '../mcq/mcqConstants';
import type { McqConfidence } from '../mcq/mcqVerdict';
import type { McqStage } from './McqReviewBody';
import { colors } from '../../../theme/colors';

// The action dock takes over the old rating dock's slot (same default testID) and drives the three
// stages: Show options → Sure / Not sure / I don't know → Next / Finish run. Haptics and the
// verdict itself belong to the parent (D05); this component only reports which button was tapped.
export type McqActionDockProps = {
  testID?: string;                     // default 'review-rating-bar' (the untouched dock test finds a View with this testID)
  stage: McqStage;
  requiredCount: number;
  selectedCount: number;
  disabled?: boolean;                  // reviewing
  isLastNode: boolean;                 // 'Finish run' instead of 'Next'
  onShowOptions: () => void;
  onSubmit: (confidence: McqConfidence) => void;
  onDontKnow: () => void;
  onNext: () => void;
};

export function McqActionDock(props: McqActionDockProps) {
  const {
    testID = MCQ_TEST_IDS.dock,
    stage,
    requiredCount,
    selectedCount,
    disabled = false,
    isLastNode,
    onShowOptions,
    onSubmit,
    onDontKnow,
    onNext,
  } = props;

  const submitDisabled = disabled || selectedCount !== requiredCount;

  return (
    <View style={styles.wrapper} testID={testID}>
      {stage === 'stem' ? (
        <Pressable
          testID={MCQ_TEST_IDS.showOptions}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onShowOptions}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed, disabled && styles.disabledOpacity]}
        >
          <Text style={styles.primaryLabel} numberOfLines={1}>
            {MCQ_COPY.showOptions}
          </Text>
        </Pressable>
      ) : null}

      {stage === 'options' ? (
        <View>
          <Text testID={MCQ_TEST_IDS.dockHint} numberOfLines={2} style={styles.hint}>
            {MCQ_COPY.confidenceHint}
          </Text>
          {requiredCount > 1 ? (
            <Text testID={MCQ_TEST_IDS.selectedCount} numberOfLines={1} style={styles.count}>
              {mcqSelectedCount(selectedCount, requiredCount)}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              testID={MCQ_TEST_IDS.submitSure}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitDisabled }}
              disabled={submitDisabled}
              onPress={() => onSubmit('sure')}
              style={({ pressed }) => [styles.primary, styles.rowItem, pressed && styles.pressed, submitDisabled && styles.disabledOpacity]}
            >
              <Text style={styles.primaryLabel} numberOfLines={1}>
                {MCQ_COPY.sure}
              </Text>
            </Pressable>
            <Pressable
              testID={MCQ_TEST_IDS.submitUnsure}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitDisabled }}
              disabled={submitDisabled}
              onPress={() => onSubmit('unsure')}
              style={({ pressed }) => [styles.secondary, styles.rowItem, pressed && styles.pressed, submitDisabled && styles.disabledOpacity]}
            >
              <Text style={styles.secondaryLabel} numberOfLines={1}>
                {MCQ_COPY.unsure}
              </Text>
            </Pressable>
          </View>
          <Pressable
            testID={MCQ_TEST_IDS.dontKnow}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onDontKnow}
            style={({ pressed }) => [styles.link, pressed && styles.pressed, disabled && styles.disabledOpacity]}
          >
            <Text style={styles.linkLabel} numberOfLines={1}>
              {MCQ_COPY.dontKnow}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {stage === 'verdict' ? (
        <Pressable
          testID={MCQ_TEST_IDS.next}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onNext}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed, disabled && styles.disabledOpacity]}
        >
          <Text style={styles.primaryLabel} numberOfLines={1}>
            {isLastNode ? MCQ_COPY.finishRun : MCQ_COPY.next}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default McqActionDock;

const styles = StyleSheet.create({
  wrapper: {},
  hint: { fontSize: 12, color: colors.inkSecondary, marginBottom: 10 },
  count: { fontSize: 12, color: colors.inkSecondary, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  primary: {
    minHeight: 56,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pokeBlue,
  },
  primaryLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  secondary: {
    minHeight: 56,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  secondaryLabel: { color: colors.ink, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  link: {
    minHeight: 48,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  pressed: { opacity: 0.9 },
  disabledOpacity: { opacity: 0.55 },
});

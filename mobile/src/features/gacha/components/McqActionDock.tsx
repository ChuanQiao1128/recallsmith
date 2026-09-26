import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MCQ_COPY, MCQ_TEST_IDS, mcqSelectedCount } from '../mcq/mcqConstants';
import type { McqConfidence } from '../mcq/mcqVerdict';
import type { McqStage } from './McqReviewBody';
import { colors } from '../../../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../../../theme/dynamicType';

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
          <Text style={styles.primaryLabel} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
            {MCQ_COPY.showOptions}
          </Text>
        </Pressable>
      ) : null}

      {stage === 'options' ? (
        <View>
          {requiredCount > 1 ? (
            <Text testID={MCQ_TEST_IDS.selectedCount} numberOfLines={1} style={styles.count} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
              {mcqSelectedCount(selectedCount, requiredCount)}
            </Text>
          ) : null}
          <View style={styles.row} testID={MCQ_TEST_IDS.dockRow}>
            <Pressable
              testID={MCQ_TEST_IDS.submitSure}
              accessibilityRole="button"
              accessibilityHint={MCQ_COPY.confidenceHint}
              accessibilityState={{ disabled: submitDisabled }}
              disabled={submitDisabled}
              onPress={() => onSubmit('sure')}
              style={({ pressed }) => [styles.primary, styles.rowItem, styles.rowButton, pressed && styles.pressed, submitDisabled && styles.disabledOpacity]}
            >
              <Text style={[styles.primaryLabel, styles.rowLabel]} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {MCQ_COPY.sure}
              </Text>
            </Pressable>
            <Pressable
              testID={MCQ_TEST_IDS.submitUnsure}
              accessibilityRole="button"
              accessibilityHint={MCQ_COPY.confidenceHint}
              accessibilityState={{ disabled: submitDisabled }}
              disabled={submitDisabled}
              onPress={() => onSubmit('unsure')}
              style={({ pressed }) => [styles.secondary, styles.rowItem, styles.rowButton, pressed && styles.pressed, submitDisabled && styles.disabledOpacity]}
            >
              <Text style={[styles.secondaryLabel, styles.rowLabel]} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {MCQ_COPY.unsure}
              </Text>
            </Pressable>
            <Pressable
              testID={MCQ_TEST_IDS.dontKnow}
              accessibilityRole="button"
              accessibilityHint={MCQ_COPY.dontKnowHint}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onDontKnow}
              style={({ pressed }) => [styles.tertiary, styles.rowItem, styles.rowButton, pressed && styles.pressed, disabled && styles.disabledOpacity]}
            >
              <Text style={[styles.tertiaryLabel, styles.rowLabel]} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {MCQ_COPY.dontKnow}
              </Text>
            </Pressable>
          </View>
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
          <Text style={styles.primaryLabel} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
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
  count: { fontSize: 12, color: colors.inkSecondary, fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  // The options-stage row packs all three actions at 48pt (≥ 44pt touch target); the single stem /
  // verdict buttons keep their taller 56pt default.
  rowButton: { minHeight: 48, paddingHorizontal: 8 },
  rowLabel: { fontSize: 14 },
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
  // Visually tertiary "I don't know": transparent with a hairline border, same height as its row peers.
  tertiary: {
    minHeight: 56,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tertiaryLabel: { color: colors.inkSecondary, fontSize: 15, fontWeight: '700', letterSpacing: 0.4 },
  pressed: { opacity: 0.9 },
  disabledOpacity: { opacity: 0.55 },
});

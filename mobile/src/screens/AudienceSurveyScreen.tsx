import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { setStudyGoal } from '../features/goal/studyGoal';
import {
  DATE_PRESETS,
  DEFAULT_GOAL_DECK_SLUG,
  GOAL_CHOICES,
  NO_DATE_LABEL,
  canStepExamDate,
  examDateForPreset,
  formatExamDate,
  stepExamDate,
  type DatePresetKey,
} from '../features/gacha/audience/goalChoices';
import { setActiveDeckSlug } from '../content/activeDeck';
import { startStarterLesson } from '../features/gacha/onboarding/onboardingPrefs';
import { recordFunnelEvent } from '../telemetry/funnel';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../theme/dynamicType';

type Props = NativeStackScreenProps<RootStackParamList, 'AudienceSurvey'>;

// R22 §1.1 / §3: the onboarding step that used to ask for a content lane now asks what the learner
// wants to learn, then an optional exam date. The route keeps its 'AudienceSurvey' name (and the
// 'audience' onboarding stage) so existing installs mid-onboarding resume here. The lane preference
// lives on in Settings as "Card difficulty" (default Balanced); onboarding no longer writes it.
// Finishing moves the stage to 'starter': Home then sends the learner into the 5-card starter lesson.
type Step = 'goal' | 'date';
const FINISH_ERROR = "Couldn't save your choice. Please try again.";
type DateChoice = { kind: 'none' } | { kind: 'preset'; preset: DatePresetKey; examDate: string };

export function AudienceSurveyScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>('goal');
  const [deckSlug, setDeckSlug] = useState<string>(DEFAULT_GOAL_DECK_SLUG);
  const [dateChoice, setDateChoice] = useState<DateChoice>({ kind: 'none' });
  const [saving, setSaving] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  async function finish() {
    if (saving) return;
    setSaving(true);
    setFinishError(null);
    try {
      await setStudyGoal({ deckSlug, examDate: dateChoice.kind === 'preset' ? dateChoice.examDate : null });
      await setActiveDeckSlug(deckSlug);
      // R22 §4: the goal step opens the starter lesson (Home routes into it). The first pack and the
      // reminder prompt both wait for the lesson to complete (starterLesson.completeStarterLesson).
      await startStarterLesson();
    } catch {
      // A storage write failed: stay on this step and say so. Every write above is idempotent, so
      // pressing Finish setup again redoes them all.
      setFinishError(FINISH_ERROR);
      setSaving(false);
      return;
    }
    // R24 M01: anonymous funnel step (once per install; the deck slug only).
    recordFunnelEvent('goal_chosen', deckSlug);
    // No state update after this: replace unmounts the screen.
    navigation.replace('Home');
  }

  function pickPreset(preset: DatePresetKey) {
    setDateChoice({ kind: 'preset', preset, examDate: examDateForPreset(preset, Date.now()) });
  }

  function stepWeeks(weeks: number) {
    if (dateChoice.kind !== 'preset') return;
    if (!canStepExamDate(dateChoice.examDate, weeks, Date.now())) return;
    setDateChoice({ ...dateChoice, examDate: stepExamDate(dateChoice.examDate, weeks) });
  }

  function renderGoalStep() {
    return (
      <>
        <Text style={styles.eyebrow}>YOUR GOAL</Text>
        <Text style={styles.title}>What do you want to learn?</Text>
        <Text style={styles.body}>You can switch decks any time.</Text>

        <View style={styles.optionList} accessibilityRole="radiogroup">
          {GOAL_CHOICES.map((choice) => {
            const active = deckSlug === choice.deckSlug;
            return (
              <Pressable
                key={choice.deckSlug}
                testID={`goal-choice-${choice.deckSlug}`}
                style={({ pressed }) => [
                  styles.optionCard,
                  choice.highlighted && styles.optionCardHighlighted,
                  active && styles.optionCardActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, checked: active }}
                accessibilityLabel={choice.label}
                onPress={() => setDeckSlug(choice.deckSlug)}
              >
                <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
          onPress={() => setStep('date')}
        >
          <Text style={styles.primaryButtonText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>Continue</Text>
        </Pressable>
      </>
    );
  }

  function renderDateStep() {
    const noDateActive = dateChoice.kind === 'none';
    const nowMs = Date.now();
    return (
      <>
        <Text style={styles.eyebrow}>OPTIONAL</Text>
        <Text style={styles.title}>Do you have an exam date?</Text>
        <Text style={styles.body}>With a date, reviews finish the day before your exam.</Text>

        <View style={styles.optionList} accessibilityRole="radiogroup">
          <Pressable
            testID="exam-date-none"
            style={({ pressed }) => [styles.optionCard, noDateActive && styles.optionCardActive, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: noDateActive, checked: noDateActive }}
            accessibilityLabel={NO_DATE_LABEL}
            onPress={() => setDateChoice({ kind: 'none' })}
          >
            <Text style={[styles.optionTitle, noDateActive && styles.optionTitleActive]}>{NO_DATE_LABEL}</Text>
          </Pressable>

          <View style={styles.presetRow}>
            {DATE_PRESETS.map((preset) => {
              const active = dateChoice.kind === 'preset' && dateChoice.preset === preset.key;
              return (
                <Pressable
                  key={preset.key}
                  testID={`exam-date-${preset.key}`}
                  style={({ pressed }) => [styles.presetChip, active && styles.presetChipActive, pressed && styles.pressed]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active }}
                  accessibilityLabel={preset.label}
                  onPress={() => pickPreset(preset.key)}
                >
                  <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {dateChoice.kind === 'preset' ? (
            <View style={styles.stepperRow}>
              <Pressable
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="One week earlier"
                disabled={!canStepExamDate(dateChoice.examDate, -1, nowMs)}
                onPress={() => stepWeeks(-1)}
              >
                <Text style={styles.stepperButtonText}>−1 week</Text>
              </Pressable>
              <Text style={styles.stepperDate} accessibilityLiveRegion="polite">{formatExamDate(dateChoice.examDate)}</Text>
              <Pressable
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="One week later"
                onPress={() => stepWeeks(1)}
              >
                <Text style={styles.stepperButtonText}>+1 week</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.buttonDisabled]}
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void finish()}
        >
          <Text style={styles.primaryButtonText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{saving ? 'Saving…' : 'Finish setup'}</Text>
        </Pressable>

        {finishError ? (
          <Text testID="goal-finish-error" style={styles.finishError} accessibilityLiveRegion="polite">
            {finishError}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          onPress={() => setStep('goal')}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={styles.backLinkText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>Back</Text>
        </Pressable>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.parchmentBg, colors.parchmentBgDeep]} style={styles.gradient}>
        <ScrollView
          testID="audience-survey-scroll"
          contentContainerStyle={[styles.container, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
        >
          {step === 'goal' ? renderGoalStep() : renderDateStep()}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default AudienceSurveyScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  // No `flex: 1` here: as a ScrollView contentContainerStyle it takes
  // `flexGrow: 1` (added at the call site) so the content fills a tall screen
  // and `marginTop: 'auto'` still pins the CTA to the bottom, while on a short
  // screen the content can exceed the viewport and scroll instead of clipping.
  container: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '900', color: colors.ink },
  body: { marginTop: 12, fontSize: 14, lineHeight: 21, color: colors.inkSecondary, fontWeight: '600' },
  optionList: { marginTop: 24, gap: 12 },
  optionCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  optionCardHighlighted: {
    borderWidth: 2,
  },
  optionCardActive: {
    borderColor: colors.gold,
    backgroundColor: '#FFFFFF',
  },
  optionTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  optionTitleActive: { color: colors.gold },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  presetChipActive: { borderColor: colors.gold, backgroundColor: '#FFFFFF' },
  presetChipText: { fontSize: 13, fontWeight: '800', color: colors.ink },
  presetChipTextActive: { color: colors.gold },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stepperButton: {
    minHeight: 44,
    minWidth: 80,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stepperButtonText: { fontSize: 13, fontWeight: '800', color: colors.ink },
  stepperDate: { flexShrink: 1, textAlign: 'center', fontSize: 14, fontWeight: '900', color: colors.ink },
  // Primary CTA — pokeBlue 56pt to match the rest of the app
  primaryButton: {
    marginTop: 'auto',
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  // Ghost-style secondary (Back) — transparent + hairline border so it
  // doesn't compete with the primary visually.
  backLink: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  backLinkText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
  finishError: { marginTop: 12, textAlign: 'center', fontSize: 13, lineHeight: 19, fontWeight: '700', color: colors.danger },
});

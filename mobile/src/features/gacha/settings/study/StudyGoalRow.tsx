import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clearStudyGoal, setStudyGoal, type StudyGoal } from '../../../goal/studyGoal';
import {
  DATE_PRESETS,
  GOAL_CHOICES,
  NO_DATE_LABEL,
  canStepExamDate,
  formatExamDate,
  stepExamDate,
  type DatePresetKey,
} from '../../audience/goalChoices';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import {
  STUDY_GOAL_COPY,
  describeGoalDate,
  draftFromGoal,
  draftWithPreset,
  goalDeckLabel,
  goalFromDraft,
  type GoalDraft,
} from './studyGoalEditor';

export type StudyGoalRowProps = {
  /** The stored goal (getStudyGoal), or null when none is set. */
  goal: StudyGoal | null;
  /** The active deck, used as the starting deck when no goal is set yet. */
  fallbackDeckSlug: string | null;
  /** Called with what was stored after a save (or null after Remove goal). */
  onSaved: (goal: StudyGoal | null) => void;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
};

/**
 * U4: Settings › Study › Study goal. The row says what the goal is; Change opens an inline editor
 * with the onboarding goal step's choices (deck, "No date", presets, ±1 week). Save writes through
 * setStudyGoal (same validation, same device-local key); Remove goal clears it. Local only: no
 * server sync yet (follow-up).
 */
export function StudyGoalRow({ goal, fallbackDeckSlug, onSaved, now = Date.now }: StudyGoalRowProps) {
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;

  function open() {
    setError(null);
    setDraft(draftFromGoal(goal, fallbackDeckSlug));
  }

  function cancel() {
    if (saving) return;
    setError(null);
    setDraft(null);
  }

  async function run(write: () => Promise<StudyGoal | null>) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const stored = await write();
      onSaved(stored);
      setDraft(null);
    } catch {
      // Nothing was stored (setStudyGoal validates before it writes) or the write failed: keep
      // the editor open with the learner's choices so Save can simply be pressed again.
      setError(STUDY_GOAL_COPY.saveError);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!draft) return;
    void run(() => setStudyGoal(goalFromDraft(draft)));
  }

  function remove() {
    void run(async () => {
      await clearStudyGoal();
      return null;
    });
  }

  function pickPreset(preset: DatePresetKey) {
    if (!draft) return;
    setDraft(draftWithPreset(draft, preset, now()));
  }

  function stepWeeks(weeks: number) {
    if (!draft || draft.date.kind !== 'date') return;
    if (!canStepExamDate(draft.date.examDate, weeks, now())) return;
    setDraft({ ...draft, date: { kind: 'date', examDate: stepExamDate(draft.date.examDate, weeks), preset: null } });
  }

  const nowMs = now();
  const summaryDeck = goal ? goalDeckLabel(goal.deckSlug) : STUDY_GOAL_COPY.notSet;
  const summaryDate = goal ? describeGoalDate(goal.examDate, nowMs) : STUDY_GOAL_COPY.notSetBody;

  return (
    <View style={styles.wrap} testID="settings-study-goal">
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {STUDY_GOAL_COPY.title}
          </Text>
          <Text testID="settings-study-goal-deck" style={styles.rowValue}>
            {summaryDeck}
          </Text>
          <Text testID="settings-study-goal-date" style={styles.rowBody}>
            {summaryDate}
          </Text>
        </View>
        {editing ? null : (
          <Pressable
            testID="settings-study-goal-change"
            accessibilityRole="button"
            accessibilityLabel={goal ? 'Change study goal' : 'Set study goal'}
            onPress={open}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <Text style={styles.smallButtonText} numberOfLines={1}>
              {goal ? STUDY_GOAL_COPY.change : STUDY_GOAL_COPY.set}
            </Text>
          </Pressable>
        )}
      </View>

      {draft ? (
        <View style={styles.editor} testID="settings-study-goal-editor">
          <Text style={styles.heading}>{STUDY_GOAL_COPY.deckHeading}</Text>
          <View style={styles.optionList} accessibilityRole="radiogroup">
            {GOAL_CHOICES.map((choice) => {
              const active = draft.deckSlug === choice.deckSlug;
              return (
                <Pressable
                  key={choice.deckSlug}
                  testID={`settings-goal-deck-${choice.deckSlug}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active, disabled: saving }}
                  accessibilityLabel={choice.label}
                  disabled={saving}
                  onPress={() => setDraft({ ...draft, deckSlug: choice.deckSlug })}
                  style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.heading, styles.headingSpaced]}>{STUDY_GOAL_COPY.dateHeading}</Text>
          <Text style={styles.rowBody}>{STUDY_GOAL_COPY.dateBody}</Text>
          <View style={styles.optionList} accessibilityRole="radiogroup">
            <Pressable
              testID="settings-goal-date-none"
              accessibilityRole="radio"
              accessibilityState={{ selected: draft.date.kind === 'none', checked: draft.date.kind === 'none', disabled: saving }}
              accessibilityLabel={NO_DATE_LABEL}
              disabled={saving}
              onPress={() => setDraft({ ...draft, date: { kind: 'none' } })}
              style={({ pressed }) => [styles.option, draft.date.kind === 'none' && styles.optionActive, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, draft.date.kind === 'none' && styles.optionTextActive]}>{NO_DATE_LABEL}</Text>
            </Pressable>
            <View style={styles.chipRow}>
              {DATE_PRESETS.map((preset) => {
                const active = draft.date.kind === 'date' && draft.date.preset === preset.key;
                return (
                  <Pressable
                    key={preset.key}
                    testID={`settings-goal-date-${preset.key}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active, disabled: saving }}
                    accessibilityLabel={preset.label}
                    disabled={saving}
                    onPress={() => pickPreset(preset.key)}
                    style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {draft.date.kind === 'date' ? (
              <View style={styles.stepperRow}>
                <Pressable
                  testID="settings-goal-date-earlier"
                  accessibilityRole="button"
                  accessibilityLabel="One week earlier"
                  disabled={saving || !canStepExamDate(draft.date.examDate, -1, nowMs)}
                  onPress={() => stepWeeks(-1)}
                  style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
                >
                  <Text style={styles.smallButtonText}>−1 week</Text>
                </Pressable>
                <Text testID="settings-goal-date-value" style={styles.stepperDate} accessibilityLiveRegion="polite">
                  {formatExamDate(draft.date.examDate)}
                </Text>
                <Pressable
                  testID="settings-goal-date-later"
                  accessibilityRole="button"
                  accessibilityLabel="One week later"
                  disabled={saving || !canStepExamDate(draft.date.examDate, 1, nowMs)}
                  onPress={() => stepWeeks(1)}
                  style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
                >
                  <Text style={styles.smallButtonText}>+1 week</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.actionRow}>
            <Pressable
              testID="settings-study-goal-save"
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={save}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.disabled]}
            >
              <Text style={styles.primaryButtonText} numberOfLines={1}>
                {saving ? STUDY_GOAL_COPY.saving : STUDY_GOAL_COPY.save}
              </Text>
            </Pressable>
            <Pressable
              testID="settings-study-goal-cancel"
              accessibilityRole="button"
              disabled={saving}
              onPress={cancel}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText} numberOfLines={1}>
                {STUDY_GOAL_COPY.cancel}
              </Text>
            </Pressable>
          </View>
          {goal ? (
            <Pressable
              testID="settings-study-goal-remove"
              accessibilityRole="button"
              disabled={saving}
              onPress={remove}
              style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
            >
              <Text style={styles.removeText} numberOfLines={1}>
                {STUDY_GOAL_COPY.clear}
              </Text>
            </Pressable>
          ) : null}
          {error ? (
            <Text testID="settings-study-goal-error" style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Text style={styles.meta}>{STUDY_GOAL_COPY.deviceOnly}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default StudyGoalRow;

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  rowText: { flex: 1, paddingRight: spacing.sm },
  rowLabel: { fontSize: typography.bodySmall, fontWeight: '700', color: colors.ink },
  rowValue: { marginTop: 2, fontSize: typography.bodySmall, fontWeight: '600', color: colors.ink },
  rowBody: { marginTop: 2, fontSize: typography.caption, color: colors.inkSecondary, lineHeight: 17 },
  editor: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.hairline },
  heading: { fontSize: typography.caption, fontWeight: '900', color: colors.inkSecondary, letterSpacing: 0.6, textTransform: 'uppercase' },
  headingSpaced: { marginTop: spacing.md },
  optionList: { marginTop: spacing.xs, gap: spacing.xs },
  option: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  optionActive: { borderColor: colors.gold, backgroundColor: '#FFFFFF' },
  optionText: { fontSize: typography.bodySmall, fontWeight: '700', color: colors.ink },
  optionTextActive: { color: colors.gold },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  chipActive: { borderColor: colors.gold, backgroundColor: '#FFFFFF' },
  chipText: { fontSize: typography.caption, fontWeight: '800', color: colors.ink },
  chipTextActive: { color: colors.gold },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  stepperDate: { flexShrink: 1, textAlign: 'center', fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  smallButton: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
  },
  smallButtonText: { fontSize: typography.caption, fontWeight: '800', color: colors.ink },
  actionRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.xs },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.parchmentBg, fontSize: typography.button, fontWeight: '800' },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.ink, fontSize: typography.button, fontWeight: '700' },
  removeButton: { marginTop: spacing.xs, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: typography.bodySmall, fontWeight: '700', color: colors.danger },
  error: { marginTop: spacing.xs, fontSize: typography.caption, fontWeight: '700', color: colors.danger, textAlign: 'center' },
  meta: { marginTop: spacing.xs, fontSize: typography.caption, color: colors.inkSecondary, textAlign: 'center' },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.9 },
});

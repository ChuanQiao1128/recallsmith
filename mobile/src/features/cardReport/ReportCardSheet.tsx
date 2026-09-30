// mobile/src/features/cardReport/ReportCardSheet.tsx
//
// V11 "Report a problem" sheet: a React Native Modal (no bottom-sheet dependency,
// no navigation, so it is safe over SessionCard whose unmount resets the session).
// Callers mount it only while it is open, so every open starts from a clean form.
// The note is untrusted learner text: it is only ever sent as a JSON string field.
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import appJson from '../../../app.json';
import { colors } from '../../theme/colors';
import { a11y } from '../../theme/a11y';
import { CHROME_MAX_FONT_SCALE } from '../../theme/dynamicType';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import {
  CARD_REPORT_COPY,
  CARD_REPORT_NOTE_MAX,
  CARD_REPORT_REASONS,
  CardReportSignedOutError,
  cardReportErrorMessage,
  getCardReportToken,
  submitCardReport,
  type CardReportReason,
} from './cardReportApi';

type Phase = 'checking' | 'signed_out' | 'form' | 'submitting' | 'success' | 'duplicate';

type Props = {
  deckSlug: string;
  stableUid: string;
  onClose: () => void;
  visible?: boolean;
};

export function ReportCardSheet({ deckSlug, stableUid, onClose, visible = true }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [reason, setReason] = useState<CardReportReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCardReportToken().then((token) => {
      if (!cancelled) setPhase(token ? 'form' : 'signed_out');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChangeNote = (text: string) => setNote(text.slice(0, CARD_REPORT_NOTE_MAX));

  const onSubmit = async () => {
    if (!reason || phase !== 'form') return;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitCardReport({
        deckSlug,
        stableUid,
        reason,
        note,
        clientVersion: appJson.expo.version,
      });
      setPhase(result.duplicate ? 'duplicate' : 'success');
    } catch (e) {
      if (e instanceof CardReportSignedOutError) {
        setPhase('signed_out');
        return;
      }
      setError(cardReportErrorMessage(e));
      setPhase('form');
    }
  };

  const done = phase === 'success' || phase === 'duplicate' || phase === 'signed_out';
  const submitting = phase === 'submitting';
  const canSubmit = reason !== null && phase === 'form';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View testID="report-card-sheet" style={styles.sheet} accessibilityViewIsModal>
          <Text
            testID="report-card-title"
            accessibilityRole="header"
            style={styles.title}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          >
            {CARD_REPORT_COPY.entry}
          </Text>

          {phase === 'signed_out' ? (
            <Text testID="report-card-signed-out" style={styles.message} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
              {CARD_REPORT_COPY.signedOut}
            </Text>
          ) : null}
          {phase === 'success' ? (
            <Text
              testID="report-card-success"
              accessibilityLiveRegion="polite"
              style={styles.message}
              maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
            >
              {CARD_REPORT_COPY.success}
            </Text>
          ) : null}
          {phase === 'duplicate' ? (
            <Text
              testID="report-card-duplicate"
              accessibilityLiveRegion="polite"
              style={styles.message}
              maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
            >
              {CARD_REPORT_COPY.duplicate}
            </Text>
          ) : null}

          {phase === 'form' || submitting ? (
            <View testID="report-card-form">
              <Text style={styles.label} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                What is wrong with this card?
              </Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {CARD_REPORT_REASONS.map((option) => {
                  const selected = reason === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      testID={`report-reason-${option.value}`}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected, disabled: submitting }}
                      disabled={submitting}
                      onPress={() => setReason(option.value)}
                      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                    >
                      <Text
                        style={[styles.chipText, selected && styles.chipTextSelected]}
                        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                testID="report-card-note"
                accessibilityLabel="Note for the author (optional)"
                accessibilityHint={`Up to ${CARD_REPORT_NOTE_MAX} characters`}
                placeholder="Add a note (optional)"
                placeholderTextColor={colors.inkMuted}
                value={note}
                onChangeText={onChangeNote}
                maxLength={CARD_REPORT_NOTE_MAX}
                multiline
                editable={!submitting}
                style={styles.note}
                maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
              />
              <Text testID="report-card-note-counter" style={styles.counter} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {`${note.length}/${CARD_REPORT_NOTE_MAX}`}
              </Text>
              {error ? (
                <Text
                  testID="report-card-error"
                  accessibilityRole="alert"
                  style={styles.error}
                  maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
                >
                  {error}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              testID="report-card-cancel"
              accessibilityRole="button"
              accessibilityLabel={done ? 'Close' : 'Cancel'}
              accessibilityHint="Closes the report without leaving this card"
              onPress={onClose}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {done ? 'Close' : 'Cancel'}
              </Text>
            </Pressable>
            {phase === 'form' || submitting ? (
              <Pressable
                testID="report-card-submit"
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                accessibilityHint="Sends your report to the card's author"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                disabled={!canSubmit}
                onPress={() => void onSubmit()}
                style={({ pressed }) => [styles.primary, !canSubmit && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  {submitting ? 'Sending…' : 'Submit'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.parchmentBg,
    borderTopLeftRadius: spacing.cardRadius,
    borderTopRightRadius: spacing.cardRadius,
    padding: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.title3,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.inkSecondary,
    marginBottom: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  chip: {
    minHeight: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
  },
  chipSelected: {
    borderColor: colors.pokeBlueDeep,
    backgroundColor: colors.pokeBlueFaint,
  },
  chipText: {
    fontSize: typography.bodySmall,
    color: colors.ink,
  },
  chipTextSelected: {
    fontWeight: '700',
  },
  note: {
    minHeight: 88,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
    padding: spacing.sm,
    fontSize: typography.body,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: typography.caption,
    color: colors.inkMuted,
  },
  error: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondary: {
    minHeight: a11y.minTouch,
    minWidth: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: spacing.buttonRadius,
  },
  secondaryText: {
    fontSize: typography.button,
    fontWeight: '700',
    color: colors.inkSecondary,
  },
  primary: {
    minHeight: a11y.minTouch,
    minWidth: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.pokeBlueDeep,
  },
  primaryText: {
    fontSize: typography.button,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
});

export default ReportCardSheet;

// mobile/src/features/cardReport/SessionReportButton.tsx
//
// V11: the small "Report" text button under a revealed card in a review session. It
// opens ReportCardSheet in place: navigating away from SessionCard would unmount it
// and reset the session store. Callers key it by card so a new card starts closed.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../../theme/colors';
import { a11y } from '../../theme/a11y';
import { CHROME_MAX_FONT_SCALE } from '../../theme/dynamicType';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { CARD_REPORT_COPY } from './cardReportApi';
import { ReportCardSheet } from './ReportCardSheet';

type Props = { deckSlug: string; stableUid: string };

export function SessionReportButton({ deckSlug, stableUid }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        testID="session-card-report"
        accessibilityRole="button"
        accessibilityLabel="Report a problem with this card"
        accessibilityHint="Opens a short form without leaving the session"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
          {CARD_REPORT_COPY.sessionEntry}
        </Text>
      </Pressable>
      {open ? <ReportCardSheet deckSlug={deckSlug} stableUid={stableUid} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-end',
    minHeight: a11y.minTouch,
    minWidth: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  text: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.inkSecondary,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.75,
  },
});

export default SessionReportButton;

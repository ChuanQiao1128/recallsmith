import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DeckTranslationsState } from './useDeckTranslations';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { a11y } from '../../../theme/a11y';

/** Pack availability belongs next to the language control, not behind a missing toggle. */
export function TranslationAvailability({ state }: { state: DeckTranslationsState }) {
  if (state.status === 'ready') return null;
  return (
    <View style={styles.row} testID="card-translation-availability">
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {state.status === 'loading' ? 'Checking card languages…' : state.status === 'error'
          ? 'Couldn’t load Chinese text. You can keep studying in English.'
          : 'This pack is available in English only.'}
      </Text>
      {state.status === 'error' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading Chinese text"
          testID="card-translation-retry" onPress={state.retry} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs, marginBottom: spacing.xs },
  text: { flex: 1, color: colors.inkSecondary, fontSize: typography.caption, lineHeight: 18 },
  retry: { minHeight: a11y.minTouch, justifyContent: 'center', paddingHorizontal: spacing.sm },
  retryText: { color: colors.ink, fontWeight: '700', fontSize: typography.bodySmall, textDecorationLine: 'underline' },
});

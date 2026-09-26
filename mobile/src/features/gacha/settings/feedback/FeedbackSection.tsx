import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import type { FeedbackPrefs } from '../feedbackPrefs';

export const FEEDBACK_COPY = {
  title: 'Sound & haptics',
  soundLabel: 'Sound effects',
  soundBody: 'Draw ceremony sounds. They stay quiet when your ringer is on silent.',
  hapticsLabel: 'Haptics',
  hapticsBody: 'A light tap when you reveal, pick and rate cards.',
} as const;

type ToggleRowProps = {
  testID: string;
  label: string;
  body: string;
  value: boolean;
  onPress: () => void;
};

// A Switch-shaped row without RN's Switch: the per-file RN mocks in the test suite
// do not provide Switch, so we use a Pressable with accessibilityRole="switch" and a
// visible On/Off pill instead.
function ToggleRow({ testID, label, body, value, onPress }: ToggleRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <View style={[styles.pill, value ? styles.pillOn : styles.pillOff]}>
        <Text style={[styles.pillText, value ? styles.pillTextOn : styles.pillTextOff]} numberOfLines={1}>
          {value ? 'On' : 'Off'}
        </Text>
      </View>
    </Pressable>
  );
}

export function FeedbackSection(props: {
  prefs: FeedbackPrefs;
  onToggle: (key: keyof FeedbackPrefs, value: boolean) => void;
}) {
  const { prefs, onToggle } = props;
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {FEEDBACK_COPY.title}
      </Text>
      <ToggleRow
        testID="settings-sound-effects-toggle"
        label={FEEDBACK_COPY.soundLabel}
        body={FEEDBACK_COPY.soundBody}
        value={prefs.soundEffects}
        onPress={() => onToggle('soundEffects', !prefs.soundEffects)}
      />
      <ToggleRow
        testID="settings-haptics-toggle"
        label={FEEDBACK_COPY.hapticsLabel}
        body={FEEDBACK_COPY.hapticsBody}
        value={prefs.haptics}
        onPress={() => onToggle('haptics', !prefs.haptics)}
      />
    </View>
  );
}

export default FeedbackSection;

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
  row: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  rowText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.ink,
  },
  rowBody: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  pill: {
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillOn: {
    backgroundColor: colors.pokeBlue,
    borderColor: colors.pokeBlue,
  },
  pillOff: {
    backgroundColor: 'rgba(42,34,24,0.06)',
    borderColor: colors.hairline,
  },
  pillText: {
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  pillTextOn: {
    color: '#FFFFFF',
  },
  pillTextOff: {
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});

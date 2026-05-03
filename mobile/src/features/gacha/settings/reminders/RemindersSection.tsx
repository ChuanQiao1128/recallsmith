import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReminderPlanVM } from '../../reminders/reminderPlanner';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const REMINDERS_COPY = {
  title: 'Reminders',
  body: "Send a reminder if you haven't started by your selected time.",
  signInGate: 'Sign in to sync reminder times across devices.',
  signInAction: 'Sign in',
} as const;

export function RemindersSection(props: {
  signedIn: boolean;
  plan: ReminderPlanVM;
  onSignIn: () => void;
}) {
  const { signedIn, plan, onSignIn } = props;

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {REMINDERS_COPY.title}
      </Text>
      <Text style={styles.sectionBody} numberOfLines={1}>
        {REMINDERS_COPY.body}
      </Text>

      <Text style={styles.metaLine} numberOfLines={1}>
        {plan.statusLine}
      </Text>
      <Text style={styles.metaLine} numberOfLines={1}>
        {plan.eveningLine}
      </Text>

      {!signedIn ? (
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onSignIn}>
          <Text style={styles.secondaryButtonText} numberOfLines={1}>
            {REMINDERS_COPY.signInAction}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default RemindersSection;

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
  sectionBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  metaLine: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.9,
  },
});

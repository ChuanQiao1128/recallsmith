import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const ACCOUNT_COPY = {
  title: 'Account',
  body: 'Manage sign-in and keep your progress tied to this account.',
  signedOutState: 'Signed out',
  signedInState: (email: string) => `Signed in as ${email}`,
  signIn: 'Sign in',
  signOut: 'Sign out',
  freshStartTitle: 'Fresh Start',
  freshStartBody: 'Clear today’s schedule. Keeps your owned cards.',
  resetSchedule: 'Reset review schedule',
} as const;

export function AccountSection(props: {
  signedIn: boolean;
  email: string | null;
  resetting: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onResetReviewSchedule: () => void;
  primaryCtaTestID?: string;
}) {
  const {
    signedIn,
    email,
    resetting,
    onSignIn,
    onSignOut,
    onResetReviewSchedule,
    primaryCtaTestID,
  } = props;

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {ACCOUNT_COPY.title}
      </Text>
      <Text style={styles.sectionBody} numberOfLines={1}>
        {ACCOUNT_COPY.body}
      </Text>

      <Text style={styles.metaText} numberOfLines={1}>
        {signedIn ? ACCOUNT_COPY.signedInState(email ?? 'your account') : ACCOUNT_COPY.signedOutState}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        onPress={signedIn ? onSignOut : onSignIn}
        testID={primaryCtaTestID}
      >
        <Text style={styles.primaryButtonText} numberOfLines={1}>
          {signedIn ? ACCOUNT_COPY.signOut : ACCOUNT_COPY.signIn}
        </Text>
      </Pressable>

      <View style={styles.rule} />

      <Text style={styles.sectionTitle} numberOfLines={1}>
        {ACCOUNT_COPY.freshStartTitle}
      </Text>
      <Text style={styles.sectionBody} numberOfLines={1}>
        {ACCOUNT_COPY.freshStartBody}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.secondaryButton, (pressed || resetting) && styles.pressed]}
        onPress={onResetReviewSchedule}
        disabled={resetting}
      >
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {resetting ? 'Resetting...' : ACCOUNT_COPY.resetSchedule}
        </Text>
      </Pressable>
    </View>
  );
}

export default AccountSection;

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
  metaText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: typography.button,
    fontWeight: '800',
    color: colors.parchmentBg,
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: typography.button,
    fontWeight: '700',
    color: colors.ink,
  },
  rule: {
    marginVertical: spacing.sm,
    height: 1,
    backgroundColor: 'rgba(42,34,24,0.12)',
  },
  pressed: {
    opacity: 0.9,
  },
});

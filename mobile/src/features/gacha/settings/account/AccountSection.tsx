import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';
import { AccountDeletionError } from '../../../../auth/deleteServerAccount';

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
  deleteTitle: 'Delete account',
  deleteBody:
    'Permanently deletes your account and the progress, cards and wallet saved for it on our servers and on this device. This cannot be undone.',
  subscriptionNotice:
    'Deleting your account does not cancel an App Store subscription. Cancel it first in iOS Settings > Apple Account > Subscriptions.',
  deleteOpen: 'Delete account',
  deleteConfirmPrompt: 'Type DELETE to confirm',
  deleteConfirmCta: 'Delete my account',
  deleteCancel: 'Keep my account',
  deleting: 'Deleting...',
  deleteError: 'Could not delete your account. Check your connection and try again.',
  retry: 'Try again',
  deletedNotice: 'Your account was deleted and you are signed out.',
} as const;

export const DELETE_CONFIRM_TOKEN = 'DELETE';

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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const armed = confirmText.trim() === DELETE_CONFIRM_TOKEN;

  async function onConfirmDelete() {
    if (deleting || confirmText.trim() !== DELETE_CONFIRM_TOKEN) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { useAuthStore } = await import('../../../../auth/authStore');
      await useAuthStore.getState().deleteAccountNow();
      setDeleted(true);
      setConfirmOpen(false);
      setConfirmText('');
    } catch (e) {
      // Keep confirmText so a retry does not require retyping DELETE. A typed
      // deletion error carries friendly copy; anything else uses the generic one.
      setDeleteError(e instanceof AccountDeletionError ? e.message : ACCOUNT_COPY.deleteError);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {ACCOUNT_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>
        {ACCOUNT_COPY.body}
      </Text>

      <Text style={styles.metaText}>
        {signedIn ? ACCOUNT_COPY.signedInState(email ?? 'your account') : ACCOUNT_COPY.signedOutState}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        accessibilityRole="button"
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
      <Text style={styles.sectionBody}>
        {ACCOUNT_COPY.freshStartBody}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.secondaryButton, (pressed || resetting) && styles.pressed]}
        accessibilityRole="button"
        onPress={onResetReviewSchedule}
        disabled={resetting}
      >
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {resetting ? 'Resetting...' : ACCOUNT_COPY.resetSchedule}
        </Text>
      </Pressable>

      {deleted || signedIn ? <View style={styles.rule} /> : null}

      {deleted ? (
        <Text style={styles.noticeText}>{ACCOUNT_COPY.deletedNotice}</Text>
      ) : signedIn && !confirmOpen ? (
        <>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {ACCOUNT_COPY.deleteTitle}
          </Text>
          <Text style={styles.sectionBody}>{ACCOUNT_COPY.deleteBody}</Text>
          <Text style={styles.sectionBody}>{ACCOUNT_COPY.subscriptionNotice}</Text>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            onPress={() => setConfirmOpen(true)}
            testID="settings-delete-account-open"
          >
            <Text style={styles.secondaryButtonText} numberOfLines={1}>
              {ACCOUNT_COPY.deleteOpen}
            </Text>
          </Pressable>
        </>
      ) : signedIn && confirmOpen ? (
        <>
          <Text style={styles.sectionBody}>{ACCOUNT_COPY.deleteConfirmPrompt}</Text>
          <Text
            style={styles.sectionBody}
            testID="settings-delete-account-subscription-notice"
          >
            {ACCOUNT_COPY.subscriptionNotice}
          </Text>
          <TextInput
            testID="settings-delete-account-input"
            style={styles.confirmInput}
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={DELETE_CONFIRM_TOKEN}
            editable={!deleting}
          />
          <Pressable
            style={({ pressed }) => [
              styles.dangerButton,
              (!armed || deleting) && styles.disabledButton,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            onPress={onConfirmDelete}
            disabled={!armed || deleting}
            testID="settings-delete-account-confirm"
          >
            <Text style={styles.dangerButtonText} numberOfLines={1}>
              {deleting ? ACCOUNT_COPY.deleting : ACCOUNT_COPY.deleteConfirmCta}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            onPress={() => {
              setConfirmOpen(false);
              setConfirmText('');
              setDeleteError(null);
            }}
            accessibilityRole="button"
            disabled={deleting}
            testID="settings-delete-account-cancel"
          >
            <Text style={styles.secondaryButtonText} numberOfLines={1}>
              {ACCOUNT_COPY.deleteCancel}
            </Text>
          </Pressable>
          {deleteError !== null ? (
            <>
              <Text style={styles.errorText}>{deleteError}</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  deleting && styles.disabledButton,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                onPress={onConfirmDelete}
                disabled={deleting}
                testID="settings-delete-account-retry"
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  {ACCOUNT_COPY.retry}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      ) : null}
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
  dangerButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: '#B42318',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    fontSize: typography.button,
    fontWeight: '800',
    color: colors.parchmentBg,
  },
  disabledButton: {
    opacity: 0.45,
  },
  confirmInput: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    borderRadius: spacing.buttonRadius,
    paddingHorizontal: spacing.sm,
    fontSize: typography.body,
    color: colors.ink,
  },
  errorText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: '#B42318',
  },
  noticeText: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});

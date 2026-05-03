import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const ABOUT_COPY = {
  title: 'About',
  body: 'Get support, read policy updates, and check app version.',
  support: 'Support',
  privacy: 'Privacy policy',
  version: (appVersion: string) => `App version ${appVersion}`,
} as const;

export function AboutSection(props: {
  appVersion: string;
  onSupport: () => void;
  onPrivacy: () => void;
}) {
  const { appVersion, onSupport, onPrivacy } = props;

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {ABOUT_COPY.title}
      </Text>
      <Text style={styles.sectionBody} numberOfLines={1}>
        {ABOUT_COPY.body}
      </Text>

      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onSupport}>
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {ABOUT_COPY.support}
        </Text>
      </Pressable>

      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onPrivacy}>
        <Text style={styles.secondaryButtonText} numberOfLines={1}>
          {ABOUT_COPY.privacy}
        </Text>
      </Pressable>

      <Text style={styles.metaText} numberOfLines={1}>
        {ABOUT_COPY.version(appVersion)}
      </Text>
    </View>
  );
}

export default AboutSection;

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
  metaText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.9,
  },
});

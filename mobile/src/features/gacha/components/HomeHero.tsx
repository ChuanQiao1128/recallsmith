import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HomeHeroVM } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

export function HomeHero(props: { hero: HomeHeroVM; onPress: () => void }) {
  const { hero, onPress } = props;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow} numberOfLines={1}>
        {hero.eyebrow}
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {hero.title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {hero.subtitle}
      </Text>
      <Text style={styles.helper} numberOfLines={2}>
        {hero.helper}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed, hero.ctaDisabled && styles.ctaDisabled]}
        disabled={hero.ctaDisabled}
        onPress={onPress}
      >
        <Text style={styles.ctaText} numberOfLines={1}>
          {hero.ctaLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  eyebrow: { fontSize: typography.caption, fontWeight: '800', color: colors.gold, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: spacing.xs, fontSize: typography.title1, lineHeight: 30, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: spacing.xs, fontSize: typography.bodySmall, lineHeight: 18, color: colors.inkSecondary },
  helper: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.inkSecondary },
  ctaButton: {
    marginTop: spacing.md,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaButtonPressed: { opacity: 0.92 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: colors.parchmentBg, fontSize: 14, fontWeight: '800' },
});

export default HomeHero;

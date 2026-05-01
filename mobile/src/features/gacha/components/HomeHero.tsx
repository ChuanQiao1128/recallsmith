import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HomeHeroVM } from '../contracts';

export function HomeHero(props: { hero: HomeHeroVM; onPress: () => void }) {
  const { hero, onPress } = props;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{hero.eyebrow}</Text>
      <Text style={styles.title}>{hero.title}</Text>
      <Text style={styles.subtitle}>{hero.subtitle}</Text>
      <Text style={styles.helper}>{hero.helper}</Text>

      <Pressable
        style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed, hero.ctaDisabled && styles.ctaDisabled]}
        disabled={hero.ctaDisabled}
        onPress={onPress}
      >
        <Text style={styles.ctaText}>{hero.ctaLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 8, fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 8, fontSize: 13, lineHeight: 18, color: '#374151' },
  helper: { marginTop: 10, fontSize: 12, lineHeight: 17, color: '#6B7280' },
  ctaButton: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaButtonPressed: { opacity: 0.92 },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});

export default HomeHero;

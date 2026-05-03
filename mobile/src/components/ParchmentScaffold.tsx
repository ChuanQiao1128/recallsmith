import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type ScaffoldProps = {
  eyebrow: string;
  title: string;
  body: string;
  chips?: string[];
  children: React.ReactNode;
  footer?: React.ReactNode;
};

type MetricProps = {
  value: string;
  label: string;
  accent?: string;
};

type ActionButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function ParchmentScaffold({ eyebrow, title, body, chips = [], children, footer }: ScaffoldProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.parchmentBg, '#F6EEE0', '#F3ECFF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.heroDivider} />
            <Text style={styles.body}>{body}</Text>
            {chips.length ? (
              <View style={styles.chipsRow}>
                {chips.map((chip) => (
                  <View key={chip} style={styles.heroChip}>
                    <Text style={styles.heroChipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {children}
          {footer}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export function MetricCard({ value, label, accent = colors.gold }: MetricProps) {
  return (
    <View style={styles.metricCard}>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function SectionCard(props: { kicker?: string; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      {props.kicker ? <Text style={styles.sectionKicker}>{props.kicker}</Text> : null}
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.body ? <Text style={styles.sectionBody}>{props.body}</Text> : null}
      {props.children}
    </View>
  );
}

export function MicroChip(props: { label: string; active?: boolean }) {
  return (
    <View style={[styles.microChip, props.active && styles.microChipActive]}>
      <Text style={[styles.microChipText, props.active && styles.microChipTextActive]}>{props.label}</Text>
    </View>
  );
}

export function ActionButton({ label, onPress, variant = 'primary' }: ActionButtonProps) {
  return (
    <Pressable
      style={[
        styles.actionButton,
        variant === 'primary' && styles.actionButtonPrimary,
        variant === 'secondary' && styles.actionButtonSecondary,
        variant === 'ghost' && styles.actionButtonGhost,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'secondary' && styles.actionButtonTextSecondary,
          variant === 'ghost' && styles.actionButtonTextGhost,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.xl + 84,
  },
  heroCard: {
    borderRadius: 28,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    backgroundColor: 'rgba(255, 250, 240, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(200, 136, 58, 0.16)',
    shadowColor: '#2A2218',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  eyebrow: {
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  title: {
    marginTop: spacing.sm,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '900',
    color: colors.ink,
  },
  heroDivider: {
    width: 48,
    height: 3,
    borderRadius: 999,
    backgroundColor: colors.gold,
    marginTop: spacing.md,
  },
  body: {
    marginTop: spacing.md,
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSecondary,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  heroChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#EFE6CC',
  },
  heroChipText: {
    color: '#8C7A5B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricCard: {
    flex: 1,
    minWidth: 92,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.06)',
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
  },
  metricLabel: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 14,
    color: '#8C7A5B',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionCard: {
    marginTop: spacing.md,
    borderRadius: 24,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.05)',
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#8C7A5B',
  },
  sectionTitle: {
    marginTop: 8,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    marginTop: 8,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    color: colors.inkSecondary,
  },
  microChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F5EBD6',
  },
  microChipActive: {
    backgroundColor: colors.ink,
  },
  microChipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  microChipTextActive: {
    color: '#FFFFFF',
  },
  actionButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionButtonPrimary: {
    backgroundColor: colors.ink,
  },
  actionButtonSecondary: {
    backgroundColor: '#EEE3CF',
  },
  actionButtonGhost: {
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.1)',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: typography.button,
    fontWeight: '800',
  },
  actionButtonTextSecondary: {
    color: colors.ink,
  },
  actionButtonTextGhost: {
    color: colors.ink,
  },
});

export default ParchmentScaffold;

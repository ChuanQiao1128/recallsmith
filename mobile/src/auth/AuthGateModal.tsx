import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  bullets?: string[];

  primaryText?: string;   // default: Sign in
  secondaryText?: string; // default: Create account

  onPrimary: () => void;
  onSecondary: () => void;
  onClose: () => void;
};

export default function AuthGateModal(props: Props) {
  const {
    visible,
    title,
    subtitle,
    bullets = [],
    primaryText = 'Sign in',
    secondaryText = 'Create account',
    onPrimary,
    onSecondary,
    onClose,
  } = props;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>

            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.9 }]}
              onPress={onClose}
              accessibilityLabel="Close"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {bullets.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              {bullets.map((t, idx) => (
                <View key={idx} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{t}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.ctaRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.92 }]}
              onPress={onSecondary}
            >
              <Text style={styles.secondaryText}>{secondaryText}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.92 }]}
              onPress={onPrimary}
            >
              <Text style={styles.primaryText}>{primaryText}</Text>
            </Pressable>
          </View>

          <Text style={styles.footnote}>
            Free decks still work without an account. Sign in unlocks advanced features.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(17,24,39,0.30)',
  },
  backdrop: { ...StyleSheet.absoluteFillObject },

  card: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },

  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '900', color: '#111827' },
  subtitle: { marginTop: 4, fontSize: 12, color: '#6B7280', fontWeight: '700' },

  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  closeText: { fontSize: 16, fontWeight: '900', color: '#111827' },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletDot: { width: 18, fontSize: 14, color: '#374151', lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },

  ctaRow: { flexDirection: 'row', marginTop: 12 },
  secondaryBtn: {
    flex: 1,
    marginRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  secondaryText: { fontSize: 13, fontWeight: '900', color: '#111827' },

  primaryBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },

  footnote: { marginTop: 10, fontSize: 11, color: '#6B7280', lineHeight: 16 },
});
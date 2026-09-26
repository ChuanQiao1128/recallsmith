// mobile/src/auth/SessionExpiredBanner.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from './authStore';

export const SESSION_EXPIRED_COPY = 'Session expired, sign in to keep syncing';

export function SessionExpiredBanner(props: { onSignIn: () => void }) {
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  if (!sessionExpired) return null;

  return (
    <Pressable
      testID="session-expired-banner"
      accessibilityRole="button"
      accessibilityLabel={SESSION_EXPIRED_COPY}
      onPress={props.onSignIn}
      style={styles.banner}
    >
      <View style={styles.textWrap}>
        <Text style={styles.message}>{SESSION_EXPIRED_COPY}</Text>
      </View>
      <Text style={styles.action}>Sign in</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  textWrap: { flex: 1, paddingRight: 12 },
  message: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  action: { fontSize: 13, fontWeight: '900', color: '#B45309' },
});

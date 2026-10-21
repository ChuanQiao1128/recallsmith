import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { forceProgressSync, getProgressSyncStatus } from '../../../sync/progressSync';
import { colors } from '../../../theme/colors';
import { useAuthStore } from '../../../auth/authStore';

type Status = Awaited<ReturnType<typeof getProgressSyncStatus>>;
export function ProgressSyncStatus() {
  const user = useAuthStore(s => s.userId);
  const userRef = useRef(user);
  userRef.current = user;
  const [status, setStatus] = useState<Status | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let live = true;
    setStatus(null);
    setRetrying(false);
    const refresh = () => { void getProgressSyncStatus().then(s => { if (live) setStatus(s); }).catch(() => { if (live) setStatus(null); }); };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [user]);
  const text = !status ? 'Checking sync status…' : !status.signedIn ? 'Saved on this device · Sign in to sync'
    : status.error ? status.automaticRetry ? 'Saved on this device · Will retry automatically' : 'Saved on this device · Sync needs retry'
    : status.pending > 0 ? `Saved on this device · ${status.pending} waiting to sync`
    : status.syncing || retrying ? 'Saved on this device · Syncing…'
    : status.lastPullAtMs && status.lastPullAtMs >= (status.lastPushAtMs ?? 0) ? 'Progress synced' : 'Saved on this device · Sync not confirmed';
  return <View style={styles.row} testID="progress-sync-status">
    <Text style={styles.text} accessibilityLiveRegion="polite">{text}</Text>
    {status?.signedIn && (status.error || status.pending > 0 || (!status.lastPullAtMs || status.lastPullAtMs < (status.lastPushAtMs ?? 0))) ?
      <Pressable accessibilityRole="button" accessibilityLabel="Retry progress sync" disabled={retrying}
        style={styles.retry} onPress={() => {
          setRetrying(true);
          const origin = user;
          void forceProgressSync('manual').then(() => getProgressSyncStatus()).then(s => { if (userRef.current === origin) setStatus(s); })
            .catch(() => { if (userRef.current === origin) setStatus(null); }).finally(() => { if (userRef.current === origin) setRetrying(false); });
        }}><Text style={styles.retryText}>{retrying ? 'Syncing…' : 'Retry'}</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8, marginBottom: 8 },
  text: { flex: 1, fontSize: 12, color: colors.inkSecondary },
  retry: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.ink, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
});

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { forceProgressSync, getProgressSyncStatus } from '../../../sync/progressSync';
import { colors } from '../../../theme/colors';
import { useAuthStore } from '../../../auth/authStore';
import { getAuthSessionGeneration } from '../../../auth/sessionBoundary';

type Status = Awaited<ReturnType<typeof getProgressSyncStatus>>;
type Snapshot = { user: string | null; generation: number; status: Status };
export function ProgressSyncStatus() {
  const user = useAuthStore(s => s.userId);
  const userRef = useRef(user);
  userRef.current = user;
  const generation = getAuthSessionGeneration();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const status = snapshot?.user === user && snapshot.generation === generation ? snapshot.status : null;
  const [retryGeneration, setRetryGeneration] = useState<number | null>(null);
  const retrying = retryGeneration === generation;
  const retryingRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const announcementRef = useRef<{ user: string | null; generation: number; key: string } | null>(null);
  const isCurrent = (origin: string | null, session: number, request: number) =>
    userRef.current === origin && useAuthStore.getState().userId === origin &&
    getAuthSessionGeneration() === session && requestRef.current === request;
  useEffect(() => {
    let live = true;
    setSnapshot(null);
    setRetryGeneration(null);
    retryingRef.current = null;
    const refresh = () => {
      const session = getAuthSessionGeneration();
      if (retryingRef.current === session) return;
      const request = ++requestRef.current;
      void getProgressSyncStatus().then(s => {
        if (live && isCurrent(user, session, request)) setSnapshot({ user, generation: session, status: s });
      }).catch(() => { if (live && isCurrent(user, session, request)) setSnapshot(null); });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { live = false; requestRef.current += 1; clearInterval(timer); };
  }, [user]);
  const text = !status ? 'Checking sync status…' : !status.signedIn ? 'Saved on this device · Sign in to sync'
    : status.error ? status.automaticRetry ? 'Saved on this device · Will retry automatically' : 'Saved on this device · Sync needs retry'
    : status.pending > 0 ? `Saved on this device · ${status.pending} waiting to sync`
    : status.syncing || retrying ? 'Saved on this device · Syncing…'
    : status.lastPullAtMs && status.lastPullAtMs >= (status.lastPushAtMs ?? 0) ? 'Progress synced' : 'Saved on this device · Sync not confirmed';
  const announcementKey = !status ? null : !status.signedIn ? 'local'
    : status.error ? status.automaticRetry ? 'automatic-retry' : 'error'
    : status.pending > 0 ? 'pending'
    : status.syncing || retrying ? 'syncing'
    : status.lastPullAtMs && status.lastPullAtMs >= (status.lastPushAtMs ?? 0) ? 'synced' : 'unconfirmed';
  useEffect(() => {
    if (!announcementKey || userRef.current !== user || getAuthSessionGeneration() !== generation) return;
    const previous = announcementRef.current;
    announcementRef.current = { user, generation, key: announcementKey };
    if (Platform.OS === 'ios' && previous?.user === user && previous.generation === generation && previous.key !== announcementKey) {
      AccessibilityInfo.announceForAccessibility(text);
    }
  }, [user, generation, announcementKey, text]);
  return <View style={styles.row} testID="progress-sync-status">
    <Text style={styles.text} accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{text}</Text>
    {status?.signedIn && (status.error || status.pending > 0 || (!status.lastPullAtMs || status.lastPullAtMs < (status.lastPushAtMs ?? 0))) ?
      <Pressable accessibilityRole="button" accessibilityLabel="Retry progress sync" disabled={retrying}
        accessibilityState={{ disabled: retrying, busy: retrying }}
        style={styles.retry} onPress={() => {
          const session = getAuthSessionGeneration();
          if (retryingRef.current === session) return;
          retryingRef.current = session;
          setRetryGeneration(session);
          const origin = user;
          const request = ++requestRef.current;
          void forceProgressSync('manual').then(() => isCurrent(origin, session, request) ? getProgressSyncStatus() : null).then(s => {
            if (s && isCurrent(origin, session, request)) setSnapshot({ user: origin, generation: session, status: s });
          }).catch(() => { if (isCurrent(origin, session, request)) setSnapshot(null); }).finally(() => {
            if (isCurrent(origin, session, request)) { retryingRef.current = null; setRetryGeneration(null); }
          });
        }}><Text style={styles.retryText}>{retrying ? 'Syncing…' : 'Retry'}</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8, marginBottom: 8 },
  text: { flex: 1, fontSize: 12, color: colors.inkSecondary },
  retry: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.ink, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
});

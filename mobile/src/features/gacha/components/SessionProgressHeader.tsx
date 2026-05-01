import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SessionProgressVM } from '../session/sessionReviewHelpers';

export function SessionProgressHeader(props: { vm: SessionProgressVM }) {
  const { vm } = props;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{vm.title}</Text>
        <Text style={styles.value}>{vm.progressText}</Text>
      </View>

      {vm.currentRoleLabel ? <Text style={styles.roleLabel}>{vm.currentRoleLabel}</Text> : null}

      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { flex: vm.percent, opacity: vm.percent === 0 ? 0 : 1 }]} />
        <View style={{ flex: 1 - vm.percent }} />
      </View>

      <Text style={styles.hint}>{vm.hint}</Text>
    </View>
  );
}

const CARD_GLASS = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.5)';

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 13, color: '#111827', fontWeight: '500' },
  value: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },
  roleLabel: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#4338CA' },
  progressBarBg: {
    marginTop: 6,
    marginBottom: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: {
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  hint: { fontSize: 12, color: '#6B7280' },
});

export default SessionProgressHeader;

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RoutePreviewNode } from '../contracts';
import { colors } from '../../../theme/colors';

function roleLabel(role: RoutePreviewNode['role']) {
  if (role === 'warmup') return 'Warm-up';
  if (role === 'elite') return 'Elite';
  if (role === 'boss') return 'Boss';
  return 'Normal';
}

export function RoutePreview(props: { nodes: RoutePreviewNode[] }) {
  const { nodes } = props;

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        Route preview
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        Today should feel like one short run, not a long to-do list.
      </Text>

      <View style={styles.nodes}>
        {nodes.map((node, index) => (
          <View key={node.id} style={styles.nodeRow}>
            <View style={styles.nodeIndexWrap}>
              <Text style={styles.nodeIndex}>{index + 1}</Text>
            </View>
            <View style={styles.nodeBody}>
              <Text style={styles.nodeRole} numberOfLines={1}>
                {roleLabel(node.role)}
              </Text>
              <Text style={styles.nodeTitle} numberOfLines={2}>
                {node.title}
              </Text>
              <Text style={styles.nodeSubtitle} numberOfLines={1}>
                {node.subtitle}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: colors.ink,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: 6, fontSize: 12, color: colors.inkSecondary },
  nodes: { marginTop: 14, gap: 10 },
  nodeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  nodeIndexWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  nodeIndex: { fontSize: 12, fontWeight: '800', color: colors.gold },
  nodeBody: { flex: 1 },
  nodeRole: { fontSize: 10, fontWeight: '800', color: colors.inkSecondary, textTransform: 'uppercase' },
  nodeTitle: { marginTop: 2, fontSize: 13, fontWeight: '700', color: colors.ink },
  nodeSubtitle: { marginTop: 2, fontSize: 11, lineHeight: 16, color: colors.inkSecondary },
});

export default RoutePreview;

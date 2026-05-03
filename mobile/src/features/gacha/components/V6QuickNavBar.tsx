import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const ITEMS = [
  { label: 'Home', route: 'Home' },
  { label: 'Library', route: 'Library' },
  { label: 'Plan', route: 'PlanOverview' },
  { label: 'Milestones', route: 'MilestoneHall' },
  { label: 'Settings', route: 'Settings' },
] as const;

export function V6QuickNavBar() {
  const navigation = useNavigation<any>();

  return (
    <View style={styles.wrap}>
      {ITEMS.map((item) => (
        <Pressable key={item.label} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} onPress={() => navigation.navigate(item.route)}>
          <Text style={styles.chipText}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
  chipText: { fontSize: 11, fontWeight: '800', color: '#374151' },
  pressed: { opacity: 0.92 },
});

export default V6QuickNavBar;

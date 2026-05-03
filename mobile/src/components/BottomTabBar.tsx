import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { MAIN_TABS, type MainTabKey } from "../navigation/mainTabs";

export function BottomTabBar(props: { active: MainTabKey; navigate: (route: string, params?: any) => void }) {
  return (
    <View style={styles.shell}>
      {MAIN_TABS.map((tab) => {
        const active = tab.key === props.active;
        return (
          <Pressable key={tab.key} style={[styles.item, active && styles.itemActive]} onPress={() => props.navigate(tab.route)}>
            <View style={[styles.indicator, active && styles.indicatorActive]} />
            <View style={[styles.iconBadge, active && styles.iconBadgeActive]}>
              <Text style={[styles.icon, active && styles.iconActive]}>{tab.icon}</Text>
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(90,75,56,0.12)',
    backgroundColor: 'rgba(250,243,224,0.96)',
    borderRadius: 22,
    gap: 4,
    shadowColor: '#2A2218',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingVertical: 4,
    borderRadius: 16,
  },
  itemActive: {
    backgroundColor: 'rgba(255,250,240,0.88)',
  },
  indicator: {
    width: 14,
    height: 3,
    borderRadius: 999,
    marginBottom: 5,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: colors.gold,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(90,75,56,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.08)',
    marginBottom: 4,
  },
  iconBadgeActive: {
    backgroundColor: 'rgba(200,136,58,0.16)',
    borderColor: 'rgba(200,136,58,0.28)',
  },
  icon: {
    fontSize: 15,
    fontWeight: '800',
    color: '#8C7A5B',
  },
  iconActive: {
    color: colors.gold,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: '#8C7A5B',
  },
  labelActive: {
    color: colors.ink,
  },
});

export default BottomTabBar;

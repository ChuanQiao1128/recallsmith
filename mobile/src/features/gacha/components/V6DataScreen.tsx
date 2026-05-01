import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import V6QuickNavBar from './V6QuickNavBar';

export function V6DataScreen(props: {
  eyebrow: string;
  title: string;
  body: string;
  items?: Array<{ title: string; subtitle?: string }>;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>{props.eyebrow}</Text>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.body}>{props.body}</Text>
          <V6QuickNavBar />

          {(props.items ?? []).map((item, index) => (
            <View key={`${item.title}-${index}`} style={styles.itemCard}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.itemSubtitle}>{item.subtitle}</Text> : null}
            </View>
          ))}

          {props.primaryLabel ? (
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={props.onPrimary}>
              <Text style={styles.primaryButtonText}>{props.primaryLabel}</Text>
            </Pressable>
          ) : null}

          {props.secondaryLabel ? (
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={props.onSecondary}>
              <Text style={styles.secondaryButtonText}>{props.secondaryLabel}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#111827' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#4B5563' },
  itemCard: { marginTop: 12, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.9)' },
  itemTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  itemSubtitle: { marginTop: 4, fontSize: 12, lineHeight: 18, color: '#6B7280' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#4F46E5', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(79,70,229,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#4F46E5', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.92 },
});

export default V6DataScreen;

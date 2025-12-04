// mobile/src/screens/SettingsScreen.tsx

import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const APP_VERSION = '1.0.0';

const SUPPORT_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Support-Help-2bfa758eb545809ead04d8f8321a40dc?pvs=74';

const PRIVACY_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74';

async function openExternalLink(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Cannot open link', 'Please try again later.');
      return;
    }
    await Linking.openURL(url);
  } catch (err) {
    Alert.alert('Error', 'Failed to open link. Please try again.');
  }
}

export function SettingsScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          {/* 顶部 header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Settings</Text>
              <Text style={styles.subtitle}>
                Support, privacy and app information.
              </Text>
            </View>
          </View>

          {/* App 信息卡片 */}
          <View style={styles.appCard}>
            <Text style={styles.appName}>RecallSmith</Text>
            <Text style={styles.appTagline}>
              Full‑stack interview trainer with spaced repetition.
            </Text>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>App version</Text>
              <Text style={styles.versionValue}>{APP_VERSION}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Deck</Text>
              <Text style={styles.versionValue}>JavaScript Core Basics</Text>
            </View>
          </View>

          {/* 链接卡片 */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Help & Legal</Text>
            <Text style={styles.sectionSubtitle}>
              These pages open in your browser so you can read them comfortably.
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.linkRow,
                pressed && styles.linkRowPressed,
              ]}
              onPress={() => openExternalLink(SUPPORT_URL)}
            >
              <View>
                <Text style={styles.linkTitle}>Support & FAQ</Text>
                <Text style={styles.linkSubtitle}>
                  Common questions, troubleshooting and contact info.
                </Text>
              </View>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.linkRow,
                pressed && styles.linkRowPressed,
              ]}
              onPress={() => openExternalLink(PRIVACY_URL)}
            >
              <View>
                <Text style={styles.linkTitle}>Privacy Policy</Text>
                <Text style={styles.linkSubtitle}>
                  How we handle your data and what we store.
                </Text>
              </View>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>
          </View>

          {/* 最底下小字 */}
          <View style={styles.footerBox}>
            <Text style={styles.footerText}>
              Made with focus for developers preparing full‑stack interviews.
            </Text>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SettingsScreen;

const CARD_GLASS = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F3FF',
  },
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: {
    opacity: 0.9,
  },
  backText: {
    fontSize: 13,
    color: '#111827',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  appCard: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 16,
  },
  appName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  appTagline: {
    marginTop: 4,
    fontSize: 13,
    color: '#4B5563',
  },
  versionRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  versionLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  versionValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  sectionCard: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 10,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkRowPressed: {
    opacity: 0.9,
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  linkSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  linkChevron: {
    marginLeft: 'auto',
    fontSize: 20,
    color: '#9CA3AF',
  },
  footerBox: {
    marginTop: 'auto',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
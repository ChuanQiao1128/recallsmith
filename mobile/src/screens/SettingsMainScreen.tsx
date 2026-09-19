import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { SETTINGS_SNAPSHOT } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsMain'>;

export function SettingsMainScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Settings"
      title="Preferences and account"
      body="Manage notifications, content preferences, account, and appearance."
      chips={['Preferences', 'Support', 'Safety']}
      stats={[
        { label: 'Pools', value: String(SETTINGS_SNAPSHOT.pools.length) },
        { label: 'Theme', value: SETTINGS_SNAPSHOT.appearance },
      ]}
      sections={[
        {
          title: 'Daily rhythm',
          items: [
            { title: 'Notifications', subtitle: SETTINGS_SNAPSHOT.notificationsEnabled ? 'enabled' : 'disabled' },
            { title: 'Quiet hours', subtitle: SETTINGS_SNAPSHOT.quietHours },
          ],
        },
        {
          title: 'Study rules',
          body: 'These are the controls that change recommendations and support surfaces without rewriting the core due-review engine.',
          items: [
            { title: 'Audience', subtitle: SETTINGS_SNAPSHOT.audience },
            { title: 'Appearance', subtitle: SETTINGS_SNAPSHOT.appearance },
          ],
        },
        {
          title: 'Account safety',
          items: [
            { title: 'Pool access', subtitle: `${SETTINGS_SNAPSHOT.pools.filter((pool) => pool.state === 'active').length} active · ${SETTINGS_SNAPSHOT.pools.filter((pool) => pool.state !== 'active').length} paused` },
            { title: 'Recovery path', subtitle: 'Fresh Start and account controls stay available, but remain secondary to studying.' },
          ],
        },
      ]}
      primaryLabel="Notifications & reminders"
      onPrimary={() => navigation.navigate('SettingsNotifications')}
      secondaryLabel="Content preferences"
      onSecondary={() => navigation.navigate('SettingsAudience')}
      footer={
        <View style={styles.footerGrid}>
          <Pressable style={styles.footerCard} onPress={() => navigation.navigate('SettingsPools')}>
            <Text style={styles.footerTitle}>Pools and availability</Text>
            <Text style={styles.footerBody}>Review active and paused pools without leaving settings.</Text>
          </Pressable>
          <Pressable style={styles.footerCard} onPress={() => navigation.navigate('SettingsAppearance')}>
            <Text style={styles.footerTitle}>Theme and reading density</Text>
            <Text style={styles.footerBody}>Control parchment/cosmic presentation and reading comfort.</Text>
          </Pressable>
        </View>
      }
    />
  );
}

export default SettingsMainScreen;

const styles = StyleSheet.create({
  footerGrid: { gap: 10 },
  footerCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.06)',
  },
  footerTitle: { fontSize: 14, fontWeight: '800', color: '#2A2218' },
  footerBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#5A4B38' },
});
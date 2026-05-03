import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsAppearance'>;

export function SettingsAppearanceScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Appearance"
      title="Theme and reading density"
      body="Keep the app readable first, while separating everyday parchment surfaces from the cosmic ceremony moments."
      chips={['Parchment', 'Cosmic']}
      sections={[
        {
          title: 'Theme',
          items: [
            { title: 'Parchment', subtitle: 'Core workflow screens' },
            { title: 'Cosmic', subtitle: 'Ceremony and reveal surfaces' },
          ],
        },
        {
          title: 'Density',
          items: [{ title: 'Standard', subtitle: 'Balanced spacing for scanning and reading' }],
        },
        {
          title: 'Motion and ceremony',
          body: 'Visual flourish should stay lightweight. Reading screens need stability first; reveal and milestone moments can carry the extra glow.' ,
          items: [{ title: 'Preferred posture', subtitle: 'Calm reading surfaces with stronger emphasis only on celebration moments' }],
        },
      ]}
      primaryLabel="Back to settings"
      onPrimary={() => navigation.navigate('SettingsMain')}
    />
  );
}

export default SettingsAppearanceScreen;
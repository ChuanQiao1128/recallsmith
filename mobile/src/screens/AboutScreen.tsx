import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'About'>;

export function AboutScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="About"
      title="Version, credits, and design direction"
      body="Keep versioning, authorship, and product language in one place so the screen feels informational, not like a leftover spec note. Use it as a lightweight product identity page, not a technical dump."
      sections={[
        {
          title: 'Version',
          items: [
            { title: 'Build', subtitle: 'DeveloperCards mobile v6 candidate build' },
            { title: 'Design language', subtitle: 'Parchment core with cosmic ceremony surfaces' },
          ],
        },
        {
          title: 'Credits',
          items: [
            { title: 'Product', subtitle: 'DeveloperCards v6' },
            { title: 'Platform', subtitle: 'React Native + Expo' },
          ],
        },
      ]}
      primaryLabel="FAQ"
      onPrimary={() => navigation.navigate('HelpFAQ')}
      secondaryLabel="Back to more"
      onSecondary={() => navigation.navigate('More')}
    />
  );
}

export default AboutScreen;
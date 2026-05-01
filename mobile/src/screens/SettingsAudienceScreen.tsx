import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { SETTINGS_SNAPSHOT } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsAudience'>;

export function SettingsAudienceScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Content preference"
      title="Content preference"
      body="Choose which audience lens should shape new recommendations. Due review stays the same."
      chips={['Rules', 'Recommendations']}
      sections={[
        {
          title: 'Current setting',
          items: [
            { title: 'Audience', subtitle: SETTINGS_SNAPSHOT.audience },
            { title: 'Rule', subtitle: 'Due review stays the same; recommendations adapt around it' },
          ],
        },
        {
          title: 'Recommendation surfaces',
          body: 'This preference should change how new content is framed in draw, library, and discovery surfaces — not how already-due memory work is scheduled.',
          items: [
            { title: 'Affected areas', subtitle: 'Draw suggestions, pool discovery, and non-due browsing surfaces' },
          ],
        },
      ]}
      primaryLabel="Back to settings"
      onPrimary={() => navigation.navigate('SettingsMain')}
    />
  );
}

export default SettingsAudienceScreen;
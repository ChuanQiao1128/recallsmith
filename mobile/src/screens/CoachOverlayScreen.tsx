import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { COACH_STEPS } from '../mock/coach';

type Props = NativeStackScreenProps<RootStackParamList, 'CoachOverlay'>;

export function CoachOverlayScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Coach overlay"
      title="First-visit teaching flow"
      body="Coach overlays should orient the learner quickly, then disappear. Teach only the next important action instead of narrating the whole product at once."
      chips={['Guided onboarding', 'Light touch']}
      sections={[
        {
          title: 'Coach steps',
          items: COACH_STEPS.map((step) => ({ title: step.screen, subtitle: step.text })),
        },
        {
          title: 'Teaching posture',
          body: 'Use overlays to reduce first-run confusion on Home, Library, and Settlement, but keep the learning route itself feeling direct and uncluttered.',
        },
      ]}
      primaryLabel="Back home"
      onPrimary={() => navigation.navigate('Home')}
    />
  );
}

export default CoachOverlayScreen;
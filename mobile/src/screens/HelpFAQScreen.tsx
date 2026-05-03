import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { FAQ_LIST } from '../mock/faq';

type Props = NativeStackScreenProps<RootStackParamList, 'HelpFAQ'>;

export function HelpFAQScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="FAQ"
      title="Help and answers"
      body="Get quick answers for draw rules, resets, reminders, and other product questions without leaving the app. Treat help like a support companion that gets the learner back on track fast."
      cosmic
      chips={['Support', 'Answers']}
      stats={[
        { label: 'Top questions', value: String(FAQ_LIST.length) },
      ]}
      sections={[
        {
          title: 'FAQ',
          items: FAQ_LIST.map((item) => ({ title: item.q, subtitle: item.a })),
        },
      ]}
      primaryLabel="Back to me"
      onPrimary={() => navigation.navigate('More')}
    />
  );
}

export default HelpFAQScreen;

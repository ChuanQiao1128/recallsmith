import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { navigateToTab } from '../navigation/tabNavigation';
import AppInfoScreen from '../components/AppInfoScreen';
import { FAQ_LIST } from '../content/faq';

type Props = NativeStackScreenProps<RootStackParamList, 'HelpFAQ'>;

export function HelpFAQScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="FAQ"
      title="Help and answers"
      body="Short answers to what people ask most: pulls, pity, locked cards, offline, Android and dark mode. Missing something? Open Support from the Me tab."
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
      onPrimary={() => navigateToTab(navigation, 'More')}
    />
  );
}

export default HelpFAQScreen;

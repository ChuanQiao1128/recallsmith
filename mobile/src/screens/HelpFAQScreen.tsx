import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { navigateToTab } from '../navigation/tabNavigation';
import AppInfoScreen from '../components/AppInfoScreen';
import { FAQ_DISCLAIMER, FAQ_LIST } from '../content/faq';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'HelpFAQ'>;

export function HelpFAQScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="FAQ"
      title="Help and answers"
      body="Short answers to what people ask most: draws, rare cards, what you study, offline use and how cards are made. Missing something? Open Support from the Me tab."
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
      footer={
        <View>
          {FAQ_DISCLAIMER.map((line) => (
            <Text key={line} testID="help-faq-disclaimer" style={styles.disclaimer}>
              {line}
            </Text>
          ))}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  disclaimer: {
    marginTop: spacing.xs,
    textAlign: 'center',
    fontSize: typography.caption,
    lineHeight: 16,
    color: '#D9D0AE',
  },
});

export default HelpFAQScreen;

// mobile/src/premium/trialDialogs.ts
import { Alert } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function showTrialUpsellDialog(
  navigation: Nav,
  opts: { deckTitle: string; previewCount: number; totalCards: number },
) {
  const { deckTitle, previewCount, totalCards } = opts;

  Alert.alert(
    'Free Trial Completed',
    `You have finished studying the first ${previewCount} cards (out of ${totalCards}) that can be learned for free in "${deckTitle}".\n\nYou can still review these ${previewCount} cards unlimitedly.\nUpgrade to Premium to unlock the remaining content and continue your progress.`,
    [
      { text: 'Continue Reviewing', style: 'cancel' },
      { text: 'Upgrade to Premium', onPress: () => navigation.navigate('Paywall') },
    ],
  );
}
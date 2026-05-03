import { Alert } from 'react-native';
import { resetAllReviewSchedules } from '../../../../review/storage';

export async function runResetReviewSchedule(now: Date = new Date()): Promise<void> {
  await resetAllReviewSchedules(now);
}

export function confirmResetReviewSchedule(params: {
  onConfirm: () => Promise<void>;
}): void {
  const { onConfirm } = params;

  Alert.alert(
    'Reset review schedule',
    'Keep your library. Bring learned cards back into today. Continue?',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        onPress: async () => {
          await onConfirm();
          Alert.alert(
            'Review schedule reset',
            'Learned cards are due again today. Your library stays intact.',
          );
        },
      },
    ],
  );
}

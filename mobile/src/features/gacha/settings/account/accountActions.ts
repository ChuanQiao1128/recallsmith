import { Alert } from 'react-native';
import { loadAllProgress, resetAllReviewSchedules } from '../../../../review/storage';

export async function runResetReviewSchedule(now: Date = new Date()): Promise<void> {
  await resetAllReviewSchedules(now);
}

// Counts every learned card across all decks in the current user scope, using the
// same predicate as resetAllReviewSchedules. Returns null if the read throws so the
// confirm can fall back to generic copy instead of blocking the action.
export async function countLearnedCards(): Promise<number | null> {
  try {
    const all = await loadAllProgress();
    let count = 0;
    for (const cards of Object.values(all)) {
      for (const card of cards) {
        if (typeof card?.lastReviewedAt === 'number' && card.lastReviewedAt > 0) count += 1;
      }
    }
    return count;
  } catch {
    return null;
  }
}

export async function confirmResetReviewSchedule(params: {
  onConfirm: () => Promise<void>;
}): Promise<void> {
  const { onConfirm } = params;

  const count = await countLearnedCards();

  if (count === 0) {
    Alert.alert('Nothing to reset', 'You have not studied any cards yet.');
    return;
  }

  const message =
    count === null
      ? "Every learned card across all your decks will be due now. This can't be undone."
      : `${count} learned ${count === 1 ? 'card' : 'cards'} across all your decks will be due now. This can't be undone.`;

  Alert.alert('Make all learned cards due today?', message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Make due now',
      style: 'destructive',
      onPress: async () => {
        await onConfirm();
        Alert.alert('Cards are due now', 'Your library and owned cards are unchanged.');
      },
    },
  ]);
}

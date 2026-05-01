import type { ReminderPrefs } from '../../../notifications/reminders';

export type ReminderPlanVM = {
  statusLine: string;
  morningLine: string;
  eveningLine: string;
};

export function buildReminderPlanVM(prefs: ReminderPrefs): ReminderPlanVM {
  const morning = prefs.morningEnabled ? `Morning nudge at ${prefs.morningTime}` : 'Morning nudge off';
  const evening = prefs.eveningEnabled
    ? `Evening rescue at ${prefs.eveningTime} · only if due cards remain`
    : 'Evening rescue off';

  return {
    statusLine: `${morning} · ${evening}`,
    morningLine: 'Use the morning slot for a low-friction first card.',
    eveningLine: 'The evening check-in stays conditional so it only fires when due cards remain.',
  };
}

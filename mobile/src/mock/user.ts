import type { AudiencePreference } from '../features/gacha/audience/audiencePrefs';

export const MOCK_USER = {
  id: 'device-local',
  audiencePreference: 'both' as AudiencePreference,
  streak: 4,
  weekStreak: 2,
  hasCompletedOnboarding: true,
  accountMode: 'device' as const,
};

// mobile/src/navigation/types.ts

export type StudyMode = 'review-due' | 'learn-new' | 'mixed';

export type RootStackParamList = {
  Home: undefined;
  Deck: undefined;
  Review: { mode?: StudyMode; limit?: number } | undefined;
  Settings: undefined;
};
// mobile/src/navigation/types.ts
export type StudyMode = 'learn-new' | 'review-due' | 'mixed';

export type RootStackParamList = {
  Auth: { mode?: 'login' | 'register' } | undefined;

  Home: undefined;
  Settings: undefined;

  Deck: { slug?: string } | undefined;

  Review: { slug?: string; mode?: StudyMode; limit?: number } | undefined;
};
export type StudyMode = 'learn-new' | 'review-due' | 'mixed';

export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;

  // ✅ 允许不传，也允许传 slug
  Deck: { slug?: string } | undefined;

  // ✅ Review 也带上 slug（可选），否则还是会用当前 active deck
  Review: { slug?: string; mode?: StudyMode; limit?: number } | undefined;
};
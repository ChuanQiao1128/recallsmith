// mobile/src/navigation/types.ts

export type StudyMode = 'review-due' | 'learn-new' | 'mixed';

export type RootStackParamList = {
  Home: undefined;
  Deck: undefined; // 目前只有一个 JS Deck，将来可以加参数
  Review:
    | {
        mode: StudyMode;
        limit: number; // 本次 session 计划学习多少张
      }
    | undefined;
};
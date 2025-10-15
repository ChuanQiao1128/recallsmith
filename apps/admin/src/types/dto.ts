// 请求
export type CreateDeckRequest = { slug: string; title: string; locale?: string };
export type CreateDraftCardRequest = {
  stableUid: string;
  frontMd: string;
  backMd: string;
  keyPoint: string;
  tags?: string[];
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
};
export type PublishDeckRequest = { version: string; changelog?: string };

// 响应（全部 camelCase）
export type CreateDeckResponse = { deckId: string };
export type CreateDraftCardResponse = { cardId: string; stableUid: string };
export type PublishDeckResponse = { version: string; totalCards: number; publishedAt: string };
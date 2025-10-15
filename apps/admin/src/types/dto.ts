// Admin — Create Deck
export type CreateDeckRequest = { slug: string; title: string; locale?: string | null };
export type CreateDeckResponse = { deckId: string };

// Admin — Create Draft Card
export type CreateDraftCardRequest = {
  stableUid: string;
  frontMd: string;
  backMd: string;
  keyPoint: string;
  tags?: string[] | null;
  difficulty?: string | null;
};
export type CreateDraftCardResponse = { cardId: string; stableUid: string };

// Admin — Publish
export type PublishDeckRequest = { version: string; changelog?: string | null };
export type PublishDeckResponse = { version: string; totalCards: number; publishedAt: string };
export type Deck = {
  id: string;
  slug: string;
  title: string;
  locale?: string;
  createdAt: string;
};

export type CardDifficulty = 'beginner' | 'intermediate' | 'advanced';

export type Card = {
  id: string;
  deckId: string;
  stableUid: string;
  frontMd: string; // question
  backMd: string;  // explanation & code
  keyPoint: string;
  tags: string[];
  difficulty?: CardDifficulty;
  createdAt: string;
  updatedAt: string;
};

export type PublishInfo = {
  version: string;
  totalCards: number;
  publishedAt: string;
};
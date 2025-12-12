export interface Deck {
  id: number;
  slug: string;
  title: string;
  author: string;
  description?: string | null;
  locale: string;
  deckType: number;
  canRead?: boolean;
  canWrite?: boolean;

  version: number;
  createdAt: string;
  updatedAt: string;
  isDeleted?: number;

  contentVersion?: string | null;
  isFreeStarter?: boolean | null;
  freeCardCount?: number | null;
}

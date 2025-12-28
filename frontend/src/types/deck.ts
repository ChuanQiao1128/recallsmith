// src/types/deck.ts

export type DeckTier = 'free' | 'premium';
export type DeckAvailability = 'live' | 'coming' | 'retired';

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

  // ✅ mobile/manifest fields (DB-backed)
  tier?: DeckTier | null; // null => infer by deckType
  availability?: DeckAvailability | null;
  eta?: string | null;
  manifestOrder?: number | null;
  totalCards?: number | null;
  previewCards?: number | null;
  retiredAtMs?: number | null;

  // legacy/optional (keep if you already use)
  contentVersion?: string | null;
  isFreeStarter?: boolean | null;
  freeCardCount?: number | null;
}
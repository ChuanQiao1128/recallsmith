// mobile/src/types/deckExport.ts

export interface DeckExport {
  Slug: string;
  Title: string;
  Locale: string;
  Version: string;
  DeckType: number;      // 1 = Starter, 2 = Paid
  IsFreeStarter: boolean;
  TotalCards: number;
  FreeCardCount: number;
  Cards: CardExport[];
}

export interface CardExport {
  StableUid: string;
  Question: string;
  Explanation?: string | null;
  CodeSnippet?: string | null;
  CodeLanguage?: string | null; // 'js' | 'ts' | 'cs' | 'sql' | ...
  Difficulty: number;           // 1 / 2 / 3
  OrderInDeck: number;
}
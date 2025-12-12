export interface Card {
  id: number;
  deckId: number;
  stableUid: string;
  question: string;

  difficulty: number;
  orderInDeck: number;

  explanation?: string | null;
  realWorldUsage?: string | null;
  codeSnippet?: string | null;
  codeLanguage?: string | null;
  revision?: number | null;

  version: number;
  isDeleted?: number;

  createdAt: string;
  updatedAt: string;
}
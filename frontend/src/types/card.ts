export interface Card {
  id: number;
  deckId: number;
  stableUid: string;
  question: string;
  explanation: string | null;
  codeSnippet: string | null;
  codeLanguage: string | null;
  difficulty: number;
  orderInDeck: number;
  isDeleted: number;
  version: number;
  createdAt: number;
  updatedAt: number;

  // ✅ optional mobile fields
  realWorldUsage?: string | null;
  revision?: number | null;
}
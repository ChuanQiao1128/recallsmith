// src/types/card.ts

export interface Card {
  id: number;
  deckId: number;
  stableUid: string;
  question: string;
  explanation: string | null;
  codeSnippet: string | null;
  codeLanguage: string | null;
  difficulty: number;   // 1=Easy,2=Medium,3=Hard
  orderInDeck: number;
  isDeleted: number;    // 0 / 1
  version: number;
  createdAt: number;    // epoch ms
  updatedAt: number;
}
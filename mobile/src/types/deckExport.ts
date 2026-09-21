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
  Revision?: number; // ✅ Phase 0: 内容版本号（整数递增），改题/修订时+1
  Question: string;
  Explanation?: string | null;
  CodeSnippet?: string | null;
  RealWorldUsage?: string;
  CodeLanguage?: string | null; // 'js' | 'ts' | 'cs' | 'sql' | ...
  Difficulty: number;           // 1 / 2 / 3
  OrderInDeck: number;
  Topic?: string | null;        // C05 cards.topic; absent in pre-018 files, null when untagged
  Mcq?: McqExport | null;       // C08/C09 cards.mcq. Server-shaped, unvalidated on this type: read only through normalizeMcq / resolveMcq / isMcqCard (D00 §0)
}

export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
export interface McqExport { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }

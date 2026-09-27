// src/types/draft.ts
//
// The AI draft review queue (R18 contract §8.1, §8.3). The local authoring agent
// submits cited DraftCards; a person accepts, edits or rejects each one on the
// console's /review page before it can reach the publish pipeline.
import type { McqBlob } from './mcq';

export type DraftStatus = 'pending' | 'accepted' | 'rejected';

/** Contract §3.5. The first four count as defects in the Automation Ledger (§9.1b). */
export type DraftRejectReason =
  | 'incorrect'
  | 'ambiguous'
  | 'duplicate'
  | 'unsupported_source'
  | 'off_topic'
  | 'low_value'
  | 'other';

/** Unlike CardSource, a draft's quote is required: it is the supporting passage. */
export type DraftSource = { url: string; quote: string };

export type DraftCard = {
  stableUid: string;
  difficulty: number;
  topic?: string | null;
  question: string;
  explanation: string;
  codeSnippet?: string | null;
  codeLanguage?: string | null;
  realWorldUsage?: string | null;
  mcq?: McqBlob | null;
  source: DraftSource;
};

export type DraftAgent = { name?: string; model?: string; skillVersion?: string };

/** A §8.2 similar-card match. */
export type SimilarCardMatch = {
  cardId: number;
  deckId: number;
  deckSlug: string;
  stableUid: string;
  question: string;
  similarity: number;
  likelyDuplicate: boolean;
};

export type DraftReviewEvent = {
  id: number;
  action: 'submitted' | 'accepted' | 'edited_accepted' | 'rejected';
  actorSub: string | null;
  reason: string | null;
  note: string | null;
  reviewMs: number | null;
  createdAt: string;
};

export type DraftSummary = {
  draftId: number;
  deckId: number;
  batchId: string;
  stableUid: string;
  question: string;
  topic: string | null;
  status: DraftStatus;
  likelyDuplicate: boolean;
  createdAt: string;
  decidedAt: string | null;
};

export type Draft = DraftSummary & {
  clientDraftKey: string;
  card: DraftCard;
  similar: SimilarCardMatch[];
  agent: DraftAgent | null;
  submittedBySub: string | null;
  decidedBySub: string | null;
  acceptedCardId: number | null;
  events: DraftReviewEvent[];
};

export type DraftsPage = { items: DraftSummary[]; nextCursor: string | null };

export type DraftAcceptResult = {
  draftId: number;
  cardId: number;
  stableUid: string;
  action: 'accepted' | 'edited_accepted';
};

export type DraftRejectResult = { draftId: number; action: 'rejected' };

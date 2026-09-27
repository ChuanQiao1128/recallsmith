// src/types/draft.ts
//
// The AI draft review queue (R18 contract §8.1, §8.3). The local authoring agent
// submits cited DraftCards; a person accepts, edits or rejects each one on the
// console's /review page before it can reach the publish pipeline.
import type { McqBlob } from './mcq';

export type DraftStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Contract §3.5. The first four are the agent's defects: they count in the
 * Automation Ledger's AI draft defect rate, never as defects caught before
 * publish (a rejected draft records review time only; X01 automation-4).
 */
export type DraftRejectReason =
  | 'incorrect'
  | 'ambiguous'
  | 'duplicate'
  | 'unsupported_source'
  | 'off_topic'
  | 'low_value'
  | 'other';

/**
 * Where the draft's quote was found in the ingested source. Cross-wave contract
 * (r18z-c, ai-agent-24): the MCP server's submit_draft sends it INSIDE the card
 * as `card.source.grounding = { chunkId, sourceId, matched: true, quoteChars }`,
 * core-vpc keeps it on the stored draft and returns it on GET drafts, and strips
 * it on accept. Absent when the draft was submitted outside the MCP server.
 */
export type DraftGrounding = { chunkId: string; sourceId: string; matched: boolean; quoteChars: number };

/** Unlike CardSource, a draft's quote is required: it is the supporting passage. */
export type DraftSource = { url: string; quote: string; grounding?: DraftGrounding };

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

/**
 * What became of the AI QA run an accept with `runQa: true` chained
 * (automation-17): `queued`/`in_progress` carry the run id; `nothing_to_review`,
 * `not_started` and `disabled` carry the reason in `code`/`message`.
 */
export type DraftAcceptQa = { status: string; runId: string | null; code: string | null; message: string | null };

export type DraftAcceptResult = {
  draftId: number;
  cardId: number;
  stableUid: string;
  action: 'accepted' | 'edited_accepted';
  /** Present only when the accept asked for runQa. */
  qa?: DraftAcceptQa;
};

export type DraftRejectResult = { draftId: number; action: 'rejected' };

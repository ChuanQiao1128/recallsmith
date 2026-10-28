import type { ImportCardInput } from '../api/authoring';
import type { ApiResult } from './api';

export interface ReleaseCardReview {
  stableUid: string;
  verdict: 'PASS';
  cardContentHash: string;
  schema: 'legacy-v1' | 'front-help-v1';
  revision: number;
  orderInDeck: number;
  blockers: [];
  unknowns: [];
}

export interface ReleaseEvidence {
  runId: string;
  batchAuthorizationRef: string;
  authorizationScope: 'aws-saa-fundamentals:full-deck-bilingual-release';
  model: string;
  mainSHA: string;
  evidenceRef: string;
  evidenceHash: string;
  evidenceVersion: string;
  reportRef: string;
  reportHash: string;
  reportVersion: string;
  promptHash: string;
  promptVersion: string;
  corpusHash: string;
  corpusVersion: string;
  expiresAt: string;
}

export interface ReleaseBundle {
  schema: 'aws-basics-release-bundle-v1';
  deckId: 15;
  deckSlug: 'aws-saa-fundamentals';
  releaseId: string;
  cards: Array<ImportCardInput & { source: NonNullable<ImportCardInput['source']>; frontHelp: ImportCardInput['frontHelp']; translations: NonNullable<ImportCardInput['translations']> }>;
  review: ReleaseEvidence & { cards: ReleaseCardReview[] };
}

export interface ReleaseSnapshot {
  deckId: number;
  policy: string;
  policyHash: string;
  reviewSchema: string;
  schemaHash: string;
  editingSnapshot: string;
  publishSnapshot: string;
  deck: Record<string, unknown> & { id: number; slug: string; live_build_id: string | null };
  /** Complete rows, including deleted cards, untouched for backup download. */
  backup: Record<string, unknown>[];
  cards: Array<Omit<ReleaseCardReview, 'verdict' | 'blockers' | 'unknowns'> & { version: number }>;
}

export interface ReleaseActions {
  action: { Body?: string; body?: string; StatusCode?: number; statusCode?: number };
  receipts: Array<{ id: string; revoked: boolean; expires_at: string }>;
  jobs: Array<{ job_id: string; status: string; build_id: string; content_sha256: string | null; error_message: string | null }>;
  liveBuildId: string | null;
  manifestVerified: false;
}

export type ReleaseKind = 'import' | 'review' | 'publish';
export interface ReleaseAction {
  kind: ReleaseKind;
  actionId: string;
  /** Exact JSON bytes are persisted before dispatch and reused on every replay. */
  payload: string;
  outcome: 'unknown' | 'confirmed';
  queried: boolean;
  /** Only a response/query in this mounted session can authorize dependent writes. */
  reconciled: boolean;
  result?: ApiResult<Record<string, unknown>>;
  query?: ReleaseActions;
}

/** Frozen at first capture; detects row omission/identity changes while preserving raw backup data. */
export interface ReleaseBackupInventory {
  editingSnapshot: string;
  rows: Array<{ id: number; stableUid: string; orderInDeck: number; version: number; revision: number; isDeleted: 0 | 1 }>;
}

export interface ReleaseSession {
  schema: 'aws-basics-console-session-v1';
  ownerSubject: string;
  baseline: ReleaseSnapshot;
  baselineInventory: ReleaseBackupInventory;
  bundle: ReleaseBundle;
  actions: Partial<Record<ReleaseKind, ReleaseAction>>;
  verifiedSnapshot?: ReleaseSnapshot;
}

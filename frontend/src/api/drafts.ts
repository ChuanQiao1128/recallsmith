// src/api/drafts.ts
// AI draft review queue API (R18 contract §8.3), served under /api/v1/authoring/drafts.
// Every call returns an ApiResult and never throws, like src/api/admin.ts.
// The contract does not spell out every summary field, so the client normalises:
// the id is `draftId ?? id`, and stableUid/question/topic fall back to the nested
// card. Numbers are coerced, because a Postgres bigint may arrive as a string.
import type { ApiResult } from '../types/api';
import type {
  Draft,
  DraftAcceptResult,
  DraftAgent,
  DraftCard,
  DraftRejectReason,
  DraftRejectResult,
  DraftReviewEvent,
  DraftsPage,
  DraftStatus,
  DraftSummary,
  SimilarCardMatch,
} from '../types/draft';
import type { McqBlob } from '../types/mcq';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toStatus(value: unknown): DraftStatus {
  return value === 'accepted' || value === 'rejected' ? value : 'pending';
}

function normalizeSimilar(value: unknown): SimilarCardMatch | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const cardId = toNumber(raw.cardId);
  if (cardId === null) return null;
  return {
    cardId,
    deckId: toNumber(raw.deckId) ?? 0,
    deckSlug: toText(raw.deckSlug),
    stableUid: toText(raw.stableUid),
    question: toText(raw.question),
    similarity: toNumber(raw.similarity) ?? 0,
    likelyDuplicate: raw.likelyDuplicate === true,
  };
}

function similarList(raw: Raw): SimilarCardMatch[] {
  if (!Array.isArray(raw.similar)) return [];
  return raw.similar.map(normalizeSimilar).filter((m): m is SimilarCardMatch => m !== null);
}

function normalizeCard(value: unknown): DraftCard | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const source = asRecord(raw.source);
  if (!source) return null;
  return {
    stableUid: toText(raw.stableUid),
    difficulty: toNumber(raw.difficulty) ?? 0,
    topic: toNullableText(raw.topic),
    question: toText(raw.question),
    explanation: toText(raw.explanation),
    codeSnippet: toNullableText(raw.codeSnippet),
    codeLanguage: toNullableText(raw.codeLanguage),
    realWorldUsage: toNullableText(raw.realWorldUsage),
    mcq: asRecord(raw.mcq) ? (raw.mcq as McqBlob) : null,
    source: { url: toText(source.url), quote: toText(source.quote) },
  };
}

function normalizeAgent(value: unknown): DraftAgent | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const agent: DraftAgent = {};
  if (typeof raw.name === 'string') agent.name = raw.name;
  if (typeof raw.model === 'string') agent.model = raw.model;
  if (typeof raw.skillVersion === 'string') agent.skillVersion = raw.skillVersion;
  return agent;
}

function normalizeEvent(value: unknown): DraftReviewEvent | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const action = raw.action;
  if (action !== 'submitted' && action !== 'accepted' && action !== 'edited_accepted' && action !== 'rejected') {
    return null;
  }
  return {
    id: toNumber(raw.id) ?? 0,
    action,
    actorSub: toNullableText(raw.actorSub),
    reason: toNullableText(raw.reason),
    note: toNullableText(raw.note),
    reviewMs: toNumber(raw.reviewMs),
    createdAt: toText(raw.createdAt),
  };
}

export function normalizeDraftSummary(value: unknown): DraftSummary | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const draftId = toNumber(raw.draftId ?? raw.id);
  if (draftId === null) return null;
  const card = asRecord(raw.card) ?? {};
  const topic = raw.topic ?? card.topic;
  return {
    draftId,
    deckId: toNumber(raw.deckId) ?? 0,
    batchId: toText(raw.batchId),
    stableUid: toText(raw.stableUid ?? card.stableUid),
    question: toText(raw.question ?? card.question),
    topic: typeof topic === 'string' && topic.trim() !== '' ? topic : null,
    status: toStatus(raw.status),
    likelyDuplicate:
      typeof raw.likelyDuplicate === 'boolean'
        ? raw.likelyDuplicate
        : similarList(raw).some(match => match.likelyDuplicate),
    createdAt: toText(raw.createdAt),
    decidedAt: toNullableText(raw.decidedAt),
  };
}

export function normalizeDraft(value: unknown): Draft | null {
  const summary = normalizeDraftSummary(value);
  const raw = asRecord(value);
  if (!summary || !raw) return null;
  const card = normalizeCard(raw.card);
  if (!card) return null;
  return {
    ...summary,
    clientDraftKey: toText(raw.clientDraftKey),
    card,
    similar: similarList(raw),
    agent: normalizeAgent(raw.agent),
    submittedBySub: toNullableText(raw.submittedBySub),
    decidedBySub: toNullableText(raw.decidedBySub),
    acceptedCardId: toNumber(raw.acceptedCardId),
    events: Array.isArray(raw.events)
      ? raw.events.map(normalizeEvent).filter((e): e is DraftReviewEvent => e !== null)
      : [],
  };
}

/** Only the keys whose value is set, so an unset filter never reaches the query string. */
function setKeys<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(params) as Array<keyof T>) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

/** Re-shapes a success through `normalize`; a failure passes through unchanged. */
function mapSuccess<T>(res: ApiResult<unknown>, normalize: (data: unknown) => T | null): ApiResult<T> {
  if (!res.success) return { ...res, data: null };
  const data = normalize(res.data);
  if (data === null) return failResult<T>('The server sent an unexpected draft response.', 'BAD_RESPONSE');
  return { ...res, data };
}

export async function listDrafts(params: {
  deckId: number;
  status?: DraftStatus | 'all';
  limit?: number;
  cursor?: string | null;
}): Promise<ApiResult<DraftsPage>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/authoring/drafts', { params: setKeys(params) });
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      if (!raw || !Array.isArray(raw.items)) return null;
      return {
        items: raw.items.map(normalizeDraftSummary).filter((d): d is DraftSummary => d !== null),
        nextCursor: typeof raw.nextCursor === 'string' && raw.nextCursor !== '' ? raw.nextCursor : null,
      };
    });
  } catch (err) {
    return apiResultFromError<DraftsPage>(err);
  }
}

export async function fetchDraft(draftId: number): Promise<ApiResult<Draft>> {
  try {
    const resp = await http.get<ApiResult<unknown>>(`/api/v1/authoring/drafts/${draftId}`);
    return mapSuccess(resp.data, normalizeDraft);
  } catch (err) {
    return apiResultFromError<Draft>(err);
  }
}

export async function acceptDraft(
  draftId: number,
  body: { card?: DraftCard; reviewMs?: number },
): Promise<ApiResult<DraftAcceptResult>> {
  try {
    const resp = await http.post<ApiResult<unknown>>(`/api/v1/authoring/drafts/${draftId}/accept`, body);
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      const cardId = raw ? toNumber(raw.cardId) : null;
      if (!raw || cardId === null) return null;
      return {
        draftId: toNumber(raw.draftId) ?? draftId,
        cardId,
        stableUid: toText(raw.stableUid),
        action: raw.action === 'edited_accepted' ? 'edited_accepted' : 'accepted',
      };
    });
  } catch (err) {
    return apiResultFromError<DraftAcceptResult>(err);
  }
}

export async function rejectDraft(
  draftId: number,
  body: { reason: DraftRejectReason; note?: string; reviewMs?: number },
): Promise<ApiResult<DraftRejectResult>> {
  try {
    const resp = await http.post<ApiResult<unknown>>(`/api/v1/authoring/drafts/${draftId}/reject`, body);
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      return { draftId: (raw ? toNumber(raw.draftId) : null) ?? draftId, action: 'rejected' };
    });
  } catch (err) {
    return apiResultFromError<DraftRejectResult>(err);
  }
}

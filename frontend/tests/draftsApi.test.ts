// What src/api/drafts.ts sends and how it normalises what comes back.
//
// src/api/http is replaced wholesale, as in adminConsoleRequests.test.tsx:
// .env.development points VITE_API_BASE at a real origin, so with the module
// mocked an outbound request has nowhere to go.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';
import { mcqDraftCard, qaDraftCard } from './support/draftFixtures';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/drafts');

function axiosFailure(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: 'Error',
    headers: {},
    config,
    data,
  });
}

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('src/api/drafts', () => {
  it('lists pending drafts for a deck from GET /api/v1/authoring/drafts', async () => {
    httpMock.get.mockResolvedValue({
      data: ok({
        items: [
          {
            draftId: '41',
            deckId: '7',
            batchId: 'b1',
            stableUid: 'sample-qa-topic-02',
            question: 'Q?',
            topic: null,
            status: 'pending',
            likelyDuplicate: true,
            createdAt: '2026-09-27T09:00:00Z',
            decidedAt: null,
          },
          { stableUid: 'no-id' },
        ],
        nextCursor: 'c2',
      }),
    });

    const res = await api.listDrafts({ deckId: 7, status: 'pending' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/authoring/drafts', {
      params: { deckId: 7, status: 'pending' },
    });
    expect(res.success).toBe(true);
    expect(res.data?.nextCursor).toBe('c2');
    expect(res.data?.items).toHaveLength(1);
    expect(res.data?.items[0]).toMatchObject({ draftId: 41, deckId: 7, likelyDuplicate: true, status: 'pending' });

    await api.listDrafts({ deckId: 7, cursor: null, limit: 20 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/authoring/drafts', { params: { deckId: 7, limit: 20 } });
  });

  it('reads stableUid and question from the nested card when the summary omits them', async () => {
    const card = qaDraftCard();
    httpMock.get.mockResolvedValue({
      data: ok({
        items: [
          {
            id: 9,
            deckId: 7,
            status: 'pending',
            card,
            similar: [{ cardId: 3, deckId: 7, deckSlug: 'aws-saa-c03', stableUid: 'x', question: 'y', similarity: 0.9, likelyDuplicate: true }],
          },
        ],
        nextCursor: null,
      }),
    });

    const res = await api.listDrafts({ deckId: 7 });
    expect(res.data?.items[0]).toMatchObject({
      draftId: 9,
      stableUid: card.stableUid,
      question: card.question,
      topic: card.topic,
      likelyDuplicate: true,
    });
  });

  it('accepts with the edited card and reviewMs through POST /api/v1/authoring/drafts/:draftId/accept', async () => {
    const card = mcqDraftCard({ question: 'Edited stem? (Choose two.)' });
    httpMock.post.mockResolvedValue({
      data: ok({ draftId: 41, cardId: '901', stableUid: card.stableUid, action: 'edited_accepted' }),
    });

    const res = await api.acceptDraft(41, { card, reviewMs: 42_000 });
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/authoring/drafts/41/accept', { card, reviewMs: 42_000 });
    expect(res.data).toEqual({ draftId: 41, cardId: 901, stableUid: card.stableUid, action: 'edited_accepted' });
  });

  it('sends runQa and reads the chained AI QA run back (automation-17)', async () => {
    httpMock.post.mockResolvedValue({
      data: ok({
        draftId: 41,
        cardId: 901,
        stableUid: 's',
        action: 'accepted',
        qa: { status: 'queued', runId: 'run-5', code: null, message: null },
      }),
    });
    const res = await api.acceptDraft(41, { reviewMs: 1, runQa: true });
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/authoring/drafts/41/accept', { reviewMs: 1, runQa: true });
    expect(res.data?.qa).toEqual({ status: 'queued', runId: 'run-5', code: null, message: null });
  });

  it('rejects with a reason through POST /api/v1/authoring/drafts/:draftId/reject', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ draftId: 41, action: 'rejected' }) });

    const res = await api.rejectDraft(41, { reason: 'incorrect', note: 'Wrong class.', reviewMs: 5_000 });
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/authoring/drafts/41/reject', {
      reason: 'incorrect',
      note: 'Wrong class.',
      reviewMs: 5_000,
    });
    expect(res.data).toEqual({ draftId: 41, action: 'rejected' });
  });

  it('keeps the server error code when a request fails', async () => {
    httpMock.post.mockRejectedValue(
      axiosFailure(409, {
        success: false,
        data: null,
        error: { code: 'STABLE_UID_TAKEN', message: 'The stable uid is taken.' },
        traceId: 't-1',
      }),
    );

    const res = await api.acceptDraft(41, { reviewMs: 1 });
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'STABLE_UID_TAKEN', message: 'The stable uid is taken.', httpStatus: 409 });
  });

  it('reports BAD_RESPONSE when a draft has no card', async () => {
    httpMock.get.mockResolvedValue({ data: ok({ draftId: 41, deckId: 7, status: 'pending' }) });

    const res = await api.fetchDraft(41);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/authoring/drafts/41');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValue({ data: ok({ items: 'nope' }) });
    expect((await api.listDrafts({ deckId: 7 })).error?.code).toBe('BAD_RESPONSE');
  });

  it('normalises a full draft', () => {
    const card = qaDraftCard();
    const draft = api.normalizeDraft({ draftId: 41, deckId: 7, status: 'pending', card, events: [{ id: 1, action: 'submitted', createdAt: 'now' }] });
    expect(draft?.card).toEqual(card);
    expect(draft?.events).toEqual([
      { id: 1, action: 'submitted', actorSub: null, reason: null, note: null, reviewMs: null, createdAt: 'now' },
    ]);
    expect(api.normalizeDraft({ draftId: 41, card: { question: 'q' } })).toBeNull();
    expect(api.normalizeDraftSummary({ question: 'q' })).toBeNull();
  });

  it('keeps source.grounding when the draft carries it (Y06 contract), and adds nothing otherwise', () => {
    const card = qaDraftCard();
    const grounded = api.normalizeDraft({
      draftId: 41,
      deckId: 7,
      status: 'pending',
      card: { ...card, source: { ...card.source, grounding: { chunkId: 'c-1', sourceId: 's-1', matched: true, quoteChars: '47' } } },
    });
    expect(grounded?.card.source.grounding).toEqual({ chunkId: 'c-1', sourceId: 's-1', matched: true, quoteChars: 47 });

    const plain = api.normalizeDraft({ draftId: 41, deckId: 7, status: 'pending', card });
    expect(plain?.card.source).toEqual(card.source);
    expect(Object.prototype.hasOwnProperty.call(plain?.card.source, 'grounding')).toBe(false);

    const malformed = api.normalizeDraft({
      draftId: 41,
      card: { ...card, source: { ...card.source, grounding: { chunkId: 'c-1' } } },
    });
    expect(malformed?.card.source.grounding).toBeUndefined();
  });
});

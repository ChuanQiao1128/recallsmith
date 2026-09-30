// What src/api/embeddings.ts sends and keeps (R20 contract §5: card-embeddings
// status and a deck's semantic duplicates), below every page-level mock.
// src/api/http is replaced wholesale, so nothing here can leave the process.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';

const httpMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/embeddings');

function vectorNotReady(): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
    status: 503,
    statusText: '',
    headers: {},
    config,
    data: { success: false, data: null, error: { code: 'VECTOR_NOT_READY', message: 'No vector store.' }, traceId: 't' },
  });
}

beforeEach(() => {
  httpMock.get.mockReset();
});

describe('fetchEmbeddingsStatus', () => {
  it('reads GET /api/v1/admin/card-embeddings/status for one deck, coercing the counts', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({ engine: 'vector', model: 'BAAI/bge-small-en-v1.5', cards: '120', embedded: 118, stale: '2' }),
    });
    const res = await api.fetchEmbeddingsStatus(7);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/card-embeddings/status', { params: { deckId: 7 } });
    expect(res.data).toEqual({ engine: 'vector', model: 'BAAI/bge-small-en-v1.5', cards: 120, embedded: 118, stale: 2 });
  });

  it('sends no deckId without one and reads an unknown engine as none', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ engine: 'pgvector?', model: '', cards: -1 }) });
    const res = await api.fetchEmbeddingsStatus();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/card-embeddings/status', { params: {} });
    expect(res.data).toEqual({ engine: 'none', model: null, cards: 0, embedded: 0, stale: 0 });
  });

  it('keeps VECTOR_NOT_READY as the error code', async () => {
    httpMock.get.mockRejectedValueOnce(vectorNotReady());
    const res = await api.fetchEmbeddingsStatus(7);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VECTOR_NOT_READY');
  });
});

describe('fetchSemanticDuplicates', () => {
  it('reads GET /api/v1/admin/decks/:deckId/semantic-duplicates with the contract defaults', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({
        engine: 'vector',
        minCosine: '0.9',
        pairs: [
          {
            cosine: '0.9731',
            a: { cardId: 11, stableUid: 'aws-0011', question: 'What is S3?' },
            b: { cardId: '12', stableUid: 'aws-0012', question: 'What does Amazon S3 do?' },
          },
          { cosine: 0.95, a: { cardId: 13 }, b: null },
          { cosine: null, a: { cardId: 1 }, b: { cardId: 2 } },
        ],
      }),
    });
    const res = await api.fetchSemanticDuplicates(7);
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/decks/7/semantic-duplicates', {
      params: { minCosine: 0.9, limit: 50 },
    });
    expect(res.data).toEqual({
      engine: 'vector',
      minCosine: 0.9,
      pairs: [
        {
          cosine: 0.9731,
          a: { cardId: 11, stableUid: 'aws-0011', question: 'What is S3?' },
          b: { cardId: 12, stableUid: 'aws-0012', question: 'What does Amazon S3 do?' },
        },
      ],
    });
  });

  it('passes a custom floor and limit, and refuses a payload without pairs', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ engine: 'vector' }) });
    const res = await api.fetchSemanticDuplicates(9, { minCosine: 0.95, limit: 10 });
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/decks/9/semantic-duplicates', {
      params: { minCosine: 0.95, limit: 10 },
    });
    expect(res.error?.code).toBe('BAD_RESPONSE');
  });

  it('keeps VECTOR_NOT_READY as the error code and never throws', async () => {
    httpMock.get.mockRejectedValueOnce(vectorNotReady());
    const res = await api.fetchSemanticDuplicates(7);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VECTOR_NOT_READY');
  });
});

// What importCardsBatch actually puts on the wire, mocking the seam below it
// (../src/api/http) the way authoringRequestBody.test.ts does. A page-level test
// stops at the api function boundary; this one proves the request itself carries
// F01's route, the long timeout that keeps a large batch from looking like a
// failure, and the abort signal the cancel button depends on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpMock = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../src/api/http', () => ({ http: httpMock }));

// A static import (not `await import`) so tests/apiSurfaceCensus.test.ts, which
// only sees static import clauses, counts IMPORT_REQUEST_TIMEOUT_MS as consumed.
// vi.mock is hoisted above this, so authoring.ts still binds the mocked http.
import { importCardsBatch, IMPORT_REQUEST_TIMEOUT_MS, type ImportCardInput } from '../src/api/authoring';

function response(data: unknown) {
  return { data: { success: true, data, error: null, traceId: 't' } };
}

function card(stableUid: string, orderInDeck: number): ImportCardInput {
  return {
    stableUid,
    question: 'q',
    explanation: 'e',
    codeSnippet: '',
    codeLanguage: '',
    realWorldUsage: '',
    topic: '',
    mcq: null,
    difficulty: 2,
    orderInDeck,
  };
}

beforeEach(() => {
  httpMock.post.mockResolvedValue(
    response({ deckId: 7, created: 0, updated: 0, unchanged: 0, cards: [] }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('importCardsBatch', () => {
  it('posts to /api/v1/authoring/cards/import with the long timeout and the abort signal', async () => {
    const controller = new AbortController();
    const cards = [card('cs-a-001', 5), card('cs-b-002', 10)];

    await importCardsBatch({ deckId: 7, cards, signal: controller.signal });

    expect(httpMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = httpMock.post.mock.calls[0];
    expect(url).toBe('/api/v1/authoring/cards/import');
    expect(body).toEqual({ deckId: 7, cards });
    expect(config).toMatchObject({ timeout: IMPORT_REQUEST_TIMEOUT_MS, signal: controller.signal });
    // The long timeout is the point: API Gateway cuts off at 30 s.
    expect(IMPORT_REQUEST_TIMEOUT_MS).toBe(29_000);
  });

  it('maps the server counts onto created, updated and unchanged', async () => {
    httpMock.post.mockResolvedValue(
      response({ deckId: 7, created: 3, updated: 2, unchanged: 5, cards: [] }),
    );

    const result = await importCardsBatch({ deckId: 7, cards: [card('cs-a-001', 5)] });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ created: 3, updated: 2, unchanged: 5 });
  });

  it('defaults a missing count to zero', async () => {
    httpMock.post.mockResolvedValue(response({ deckId: 7, created: 4 }));

    const result = await importCardsBatch({ deckId: 7, cards: [card('cs-a-001', 5)] });

    expect(result.data).toEqual({ created: 4, updated: 0, unchanged: 0 });
  });
});

// What fetchCardsByDeck and fetchCardById actually put on the wire.
//
// fetchCardsByDeck used to hit the unbounded GET /authoring/cards and hand back
// whatever one response carried. It now walks the keyset route
// /authoring/cards/page in pages of CARDS_PAGE_LIMIT, so the assertions that
// matter are below the api result: which URL, which params, and that a refused
// page is the whole answer rather than a partial list wearing a success
// envelope. Those live one level under the page-mocking tests, the same seam
// authoringRequestBody.test.ts mocks — the http client itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../src/types/card';
// Static imports so the api-surface census (which reads static import specifiers)
// sees CARDS_PAGE_LIMIT and fetchCardById consumed. vi.mock/vi.hoisted are
// hoisted above these, so authoring still loads against the mocked http client.
import { CARDS_PAGE_LIMIT, fetchCardById, fetchCardsByDeck } from '../src/api/authoring';
import { clearDedupe } from '../src/api/dedupe';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const DECK_ID = 7;

function card(id: number, orderInDeck: number): Card {
  return {
    id,
    deckId: DECK_ID,
    stableUid: `cs-${id}`,
    question: `Question ${id}`,
    difficulty: 2,
    orderInDeck,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  } as Card;
}

/** One page of the /cards/page envelope, wrapped as the http client returns it. */
function page(items: Card[], nextCursor: string | null, hasMore: boolean) {
  return { data: { success: true, data: { items, nextCursor, hasMore }, error: null, traceId: 't' } };
}

/** A single-record GET /cards?id= response: the handler answers with an array. */
function cardsArray(items: Card[]) {
  return { data: { success: true, data: items, error: null, traceId: 't-id' } };
}

beforeEach(() => {
  // Requests are deduped for 100ms by key; clearing between cases keeps one
  // test's promise from being handed to the next for the same deckId.
  clearDedupe();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchCardsByDeck walks the paginated route', () => {
  it('walks /cards/page until hasMore is false and returns every card in order', async () => {
    httpMock.get
      .mockResolvedValueOnce(page([card(1, 10), card(2, 20)], 'cursor-1', true))
      .mockResolvedValueOnce(page([card(3, 30)], null, false));

    const result = await fetchCardsByDeck(DECK_ID);

    expect(httpMock.get).toHaveBeenCalledTimes(2);
    expect(httpMock.get.mock.calls[0][0]).toBe('/api/v1/authoring/cards/page');
    expect(result.success).toBe(true);
    expect(result.data?.map(c => c.id)).toEqual([1, 2, 3]);
  });

  it('asks for CARDS_PAGE_LIMIT cards per page and passes the cursor back', async () => {
    httpMock.get
      .mockResolvedValueOnce(page([card(1, 10)], 'cursor-1', true))
      .mockResolvedValueOnce(page([card(2, 20)], null, false));

    await fetchCardsByDeck(DECK_ID);

    // First request carries no cursor; the second passes back the one the first
    // handed out. Both ask for the server's MaxLimit.
    expect(httpMock.get.mock.calls[0][1]).toEqual({
      params: { deckId: DECK_ID, limit: CARDS_PAGE_LIMIT },
    });
    expect(httpMock.get.mock.calls[1][1]).toEqual({
      params: { deckId: DECK_ID, limit: CARDS_PAGE_LIMIT, cursor: 'cursor-1' },
    });
    expect(CARDS_PAGE_LIMIT).toBe(200);
  });

  it('returns the failing page error instead of a partial list', async () => {
    httpMock.get
      .mockResolvedValueOnce(page([card(1, 10)], 'cursor-1', true))
      .mockResolvedValueOnce({
        data: {
          success: false,
          data: null,
          error: { code: 'CARDS_UNAVAILABLE', message: 'Card index is being rebuilt.' },
          traceId: 't-fail',
        },
      });

    const result = await fetchCardsByDeck(DECK_ID);

    // The one card from page 1 must not leak out under a success envelope.
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('CARDS_UNAVAILABLE');
  });
});

describe('fetchCardById reads one card', () => {
  it('fetchCardById reads one card through ?id=', async () => {
    httpMock.get.mockResolvedValueOnce(cardsArray([card(101, 10)]));

    const result = await fetchCardById(101);

    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/authoring/cards', {
      params: { id: 101 },
    });
    expect(result.success).toBe(true);
    expect(result.data?.id).toBe(101);
    expect(result.traceId).toBe('t-id');
  });

  it('fetchCardById says NOT_FOUND for an empty result', async () => {
    httpMock.get.mockResolvedValueOnce(cardsArray([]));

    const result = await fetchCardById(999);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.error?.message).toBe('Card not found.');
  });
});

// useDeckSnapshot — the shared hook that reads a deck through deckCache and
// exposes { deck, loading, error, reload }. deckCache is mocked so the hook's
// contract (loads once, reload invalidates then re-reads) is observed without a
// real file read. RN-free: react-test-renderer + act, like the other hook tests.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCachedDeckMock = vi.fn(async (_slug: string) => null as any);
const invalidateDeckCacheMock = vi.fn((_slug?: string) => {});

vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: (slug: string) => getCachedDeckMock(slug),
  invalidateDeckCache: (slug?: string) => invalidateDeckCacheMock(slug),
}));

import { useDeckSnapshot } from '../../src/content/useDeckSnapshot';

type Snapshot = ReturnType<typeof useDeckSnapshot>;

let latest: Snapshot;
function Harness({ slug }: { slug: string | null }) {
  latest = useDeckSnapshot(slug);
  return null;
}

const deck = (slug: string) => ({ Slug: slug, Cards: [] }) as any;

beforeEach(() => {
  getCachedDeckMock.mockReset();
  invalidateDeckCacheMock.mockReset();
});

describe('useDeckSnapshot', () => {
  it('useDeckSnapshot loads the deck through the cache', async () => {
    getCachedDeckMock.mockResolvedValue(deck('aws-saa-c03'));

    await act(async () => {
      renderer.create(<Harness slug="aws-saa-c03" />);
    });

    expect(getCachedDeckMock).toHaveBeenCalledTimes(1);
    expect(getCachedDeckMock).toHaveBeenCalledWith('aws-saa-c03');
    expect(latest.deck).toEqual(deck('aws-saa-c03'));
    expect(latest.loading).toBe(false);
    expect(latest.error).toBeNull();
  });

  it('useDeckSnapshot reload re-reads after invalidation', async () => {
    getCachedDeckMock
      .mockResolvedValueOnce(deck('v1'))
      .mockResolvedValueOnce(deck('v2'));

    await act(async () => {
      renderer.create(<Harness slug="aws-saa-c03" />);
    });
    expect(latest.deck).toEqual(deck('v1'));
    expect(getCachedDeckMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest.reload();
    });

    // reload invalidates this slug, then re-reads through the cache.
    expect(invalidateDeckCacheMock).toHaveBeenCalledWith('aws-saa-c03');
    expect(getCachedDeckMock).toHaveBeenCalledTimes(2);
    expect(latest.deck).toEqual(deck('v2'));
  });
});

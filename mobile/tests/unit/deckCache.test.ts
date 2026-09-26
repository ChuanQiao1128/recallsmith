// deckCache — non-frozen memo around the frozen resolveDeckBySlug/installDeckFromUrl
// read/install paths (MCORE-10). deckRepository and progressScope are mocked so
// these tests observe how often the real read is invoked and under which scope
// key. invalidateDeckCache() runs in beforeEach because the cache is module
// state that vitest shares across a file.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveDeckBySlugMock = vi.fn(async (_slug: string) => null as any);
const installDeckFromUrlMock = vi.fn(
  async (
    _slug: string,
    _url: string,
    _remoteVersion: string | null,
    _remoteSha256: string | null,
  ) => true,
);

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: (slug: string) => resolveDeckBySlugMock(slug),
  installDeckFromUrl: (
    slug: string,
    url: string,
    remoteVersion: string | null,
    remoteSha256: string | null,
  ) => installDeckFromUrlMock(slug, url, remoteVersion, remoteSha256),
}));

// Mutable scope so a test can flip the "signed-in user" between reads.
let currentScope = 'anon';
vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => currentScope,
}));

import {
  DECK_CACHE_TTL_MS,
  getCachedDeck,
  installDeckAndInvalidate,
  invalidateDeckCache,
} from '../../src/content/deckCache';

const deck = (slug: string) => ({ Slug: slug, Cards: [] }) as any;

beforeEach(() => {
  invalidateDeckCache();
  resolveDeckBySlugMock.mockReset();
  installDeckFromUrlMock.mockReset();
  installDeckFromUrlMock.mockResolvedValue(true);
  currentScope = 'anon';
});

describe('deckCache', () => {
  it('reads a deck once for repeated calls', async () => {
    resolveDeckBySlugMock.mockResolvedValue(deck('aws-saa-c03'));

    const first = await getCachedDeck('aws-saa-c03');
    const second = await getCachedDeck('aws-saa-c03');

    expect(first).toEqual(deck('aws-saa-c03'));
    expect(second).toBe(first);
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    let release!: (value: any) => void;
    resolveDeckBySlugMock.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );

    const a = getCachedDeck('aws-saa-c03');
    const b = getCachedDeck('aws-saa-c03');
    // Let the guarded scope import settle for both callers; the read itself is
    // still blocked. Both must have queued against the single in-flight read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);

    release(deck('aws-saa-c03'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a missing deck', async () => {
    resolveDeckBySlugMock.mockResolvedValue(null);

    expect(await getCachedDeck('aws-saa-c03')).toBeNull();
    expect(await getCachedDeck('aws-saa-c03')).toBeNull();
    // A null answer is never memoized, so the second call re-reads.
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);
  });

  it('re-reads a slug after installDeckAndInvalidate', async () => {
    resolveDeckBySlugMock.mockResolvedValue(deck('aws-saa-c03'));

    await getCachedDeck('aws-saa-c03');
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);

    // A successful install clears the memo, so the next read hits the file.
    await expect(
      installDeckAndInvalidate('aws-saa-c03', 'https://x/deck', 'v2', null),
    ).resolves.toBe(true);
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);

    // Invalidation must fire even when the install reports false: the read now
    // starts cached again, and the false install must still force a re-read.
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);
    installDeckFromUrlMock.mockResolvedValueOnce(false);
    await expect(
      installDeckAndInvalidate('aws-saa-c03', 'https://x/deck', 'v3', null),
    ).resolves.toBe(false);
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(3);

    // ...and even when the install rejects.
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(3);
    installDeckFromUrlMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      installDeckAndInvalidate('aws-saa-c03', 'https://x/deck', 'v4', null),
    ).rejects.toThrow('boom');
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(4);
  });

  it('keys entries by the signed-in user scope', async () => {
    resolveDeckBySlugMock.mockImplementation(async (slug: string) => deck(slug));

    currentScope = 'u:alice';
    await getCachedDeck('aws-saa-c03');
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);

    // A different user shares no cache entry: the deck files live under a
    // per-user dir, so a hit for alice must not serve bob.
    currentScope = 'u:bob';
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);

    // Back to alice — still cached from her first read.
    currentScope = 'u:alice';
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);
  });

  it('expires an entry after DECK_CACHE_TTL_MS', async () => {
    resolveDeckBySlugMock.mockImplementation(async (slug: string) => deck(slug));
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);

    // Still inside the TTL window: served from the memo.
    nowSpy.mockReturnValue(1_000 + DECK_CACHE_TTL_MS - 1);
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(1);

    // At/after the TTL boundary: the stale entry is dropped and re-read.
    nowSpy.mockReturnValue(1_000 + DECK_CACHE_TTL_MS);
    await getCachedDeck('aws-saa-c03');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('invalidateDeckCache with no slug clears every entry', async () => {
    resolveDeckBySlugMock.mockImplementation(async (slug: string) => deck(slug));

    await getCachedDeck('aws-saa-c03');
    await getCachedDeck('claude-ccdv-f');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(2);

    invalidateDeckCache();

    // Both scopes/slugs are gone, so each re-reads.
    await getCachedDeck('aws-saa-c03');
    await getCachedDeck('claude-ccdv-f');
    expect(resolveDeckBySlugMock).toHaveBeenCalledTimes(4);
  });
});

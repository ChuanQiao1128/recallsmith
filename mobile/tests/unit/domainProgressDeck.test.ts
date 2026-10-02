import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  active: null as string | null,
  installed: new Set<string>(),
  brokenSlug: null as string | null,
  listError: false,
}));

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => fixtures.active),
}));

vi.mock('../../src/content/deckCache', () => ({
  getCachedDeck: vi.fn(async (slug: string) => {
    if (slug === fixtures.brokenSlug) throw new Error('read failed');
    return fixtures.installed.has(slug) ? { Slug: slug } : null;
  }),
}));

vi.mock('../../src/content/starterOffline', () => ({
  listInstalledDeckEntries: vi.fn(async () => {
    if (fixtures.listError) throw new Error('list failed');
    return [...fixtures.installed].sort().map((slug) => ({ slug }));
  }),
}));

import { resolveDomainProgressSlug } from '../../src/features/domains/domainProgressDeck';

describe('resolveDomainProgressSlug', () => {
  beforeEach(() => {
    fixtures.active = null;
    fixtures.installed = new Set();
    fixtures.brokenSlug = null;
    fixtures.listError = false;
  });

  it('returns the active deck when it is installed', async () => {
    fixtures.active = 'csharp-basics';
    fixtures.installed = new Set(['aws-saa-c03', 'csharp-basics']);
    await expect(resolveDomainProgressSlug()).resolves.toBe('csharp-basics');
  });

  it('falls back to the first installed deck when the active deck is not installed', async () => {
    fixtures.active = 'gone-deck';
    fixtures.installed = new Set(['csharp-basics', 'aws-saa-c03']);
    await expect(resolveDomainProgressSlug()).resolves.toBe('aws-saa-c03');
  });

  it('falls back to the first installed deck when the active deck cannot be read', async () => {
    fixtures.active = 'csharp-basics';
    fixtures.brokenSlug = 'csharp-basics';
    fixtures.installed = new Set(['claude-ccdv-f']);
    await expect(resolveDomainProgressSlug()).resolves.toBe('claude-ccdv-f');
  });

  it('uses the first installed deck when no active deck is stored', async () => {
    fixtures.installed = new Set(['claude-ccdv-f']);
    await expect(resolveDomainProgressSlug()).resolves.toBe('claude-ccdv-f');
  });

  it('returns null when no deck is installed or the list cannot be read', async () => {
    fixtures.active = 'gone-deck';
    await expect(resolveDomainProgressSlug()).resolves.toBeNull();
    fixtures.listError = true;
    await expect(resolveDomainProgressSlug()).resolves.toBeNull();
  });
});

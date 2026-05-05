import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

import { clearOwnedSet, loadOwnedSet, markCardsOwned, saveOwnedSet } from '../../src/features/gacha/draw/ownedStore';

describe('ownedStore', () => {
  const slug = 'csharp';

  beforeEach(() => {
    store.clear();
  });

  it('saves and loads an owned set', async () => {
    await saveOwnedSet(slug, new Set(['a', 'b']));
    const loaded = await loadOwnedSet(slug);

    expect(Array.from(loaded).sort()).toEqual(['a', 'b']);
  });

  it('markCardsOwned is additive across calls', async () => {
    const first = await markCardsOwned(slug, ['a', 'b']);
    const second = await markCardsOwned(slug, ['c']);

    expect(Array.from(first).sort()).toEqual(['a', 'b']);
    expect(Array.from(second).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty set when key is missing', async () => {
    const loaded = await loadOwnedSet(slug);
    expect(loaded.size).toBe(0);
  });

  it('clears saved data', async () => {
    await saveOwnedSet(slug, new Set(['a']));
    await clearOwnedSet(slug);
    const loaded = await loadOwnedSet(slug);

    expect(loaded.size).toBe(0);
  });
});

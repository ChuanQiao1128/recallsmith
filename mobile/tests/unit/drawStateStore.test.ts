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

import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
// store.clear() below wipes the keys behind the store's back, the same way the
// debug reset does in production -- and, like production, the in-memory read
// model has to be told or one test's collection leaks into the next.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

// This file is what is left of tests/unit/ownedStore.test.ts after
// ownedStore.ts was deleted (issue #11: zero importers in src/). Its four
// cases were accounted for one by one rather than dropped:
//
//   "saves and loads an owned set"        -> kept, retargeted at the store
//                                            that actually holds the set.
//   "returns an empty set when key missing" -> kept, same reason.
//   "markCardsOwned is additive"          -> described a helper with no
//                                            callers. The live additive
//                                            path is commitDraw, pinned by
//                                            drawAtomicity.test.ts
//                                            ("commits owned and pity in a
//                                            single storage write" and the
//                                            pre-merge migration case).
//   "clears saved data"                   -> described clearOwnedSet, also
//                                            callerless. The live wipe is
//                                            resetAllProgress, which works
//                                            by key prefix and never went
//                                            through this module.
//
// The two survivors moved here rather than staying implicit inside the
// draw and user-scope suites, where they were only ever exercised through
// commitDraw. A round trip that only holds when a whole draw runs is a
// weaker claim than the one the store makes.
describe('drawStateStore', () => {
  const slug = 'csharp';

  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
  });

  it('round-trips a record through storage', async () => {
    await saveDrawState(slug, { owned: ['a', 'b'], pity: { draws: 3, threshold: 10 } });

    const loaded = await loadDrawState(slug);

    expect([...loaded.owned].sort()).toEqual(['a', 'b']);
    expect(loaded.pity).toEqual({ draws: 3, threshold: 10 });
  });

  it('returns an empty collection and no pity when the deck has never been drawn', async () => {
    const loaded = await loadDrawState(slug);

    expect(loaded.owned).toEqual([]);
    // null, not a fabricated default: the pity defaults live in pity.ts and
    // this layer is not allowed to guess a gameplay constant it does not own.
    expect(loaded.pity).toBeNull();
  });
});

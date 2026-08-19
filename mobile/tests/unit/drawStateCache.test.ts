import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const getItemCalls: string[] = [];
// Crash injection: returns true for a key whose read (or write) should fail.
// Set per test, cleared in beforeEach.
let failGetItemFor: ((key: string) => boolean) | null = null;
let failSetItemFor: ((key: string) => boolean) | null = null;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      getItemCalls.push(key);
      if (failGetItemFor?.(key)) throw new Error(`storage read killed: ${key}`);
      return store.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (failSetItemFor?.(key)) throw new Error(`storage write killed: ${key}`);
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
  },
}));

// review/storage is deliberately NOT mocked: the user partition is one of
// the dimensions under test here, and a fake scope helper would prove
// nothing about the key the cache is actually filed under.
import { setActiveUserSubForStorage } from '../../src/review/storage';
import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

const SLUG = 'csharp';

function stateKeyFor(sub: string | null): string {
  return `devcards:u:${sub ?? 'anon'}:devcards:draw-state:${SLUG}`;
}

function stateReadCount(sub: string | null = null): number {
  const key = stateKeyFor(sub);
  return getItemCalls.filter((k) => k === key).length;
}

describe('drawStateStore read model', () => {
  beforeEach(() => {
    store.clear();
    getItemCalls.length = 0;
    failGetItemFor = null;
    failSetItemFor = null;
    setActiveUserSubForStorage(null);
    // Clearing `store` wipes the keys behind the module's back, exactly like
    // the debug reset does in production -- and, exactly like production, the
    // cache has to be told. Without this a suite leaks one test's collection
    // into the next one's fixture.
    invalidateDrawStateCache();
  });

  it('reads storage once per deck, then answers from memory', async () => {
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));

    const first = await loadDrawState(SLUG);
    const second = await loadDrawState(SLUG);

    expect(first.owned).toEqual(['c1']);
    expect(second.owned).toEqual(['c1']);
    // Was 2 before the cache: one getItem + one JSON.parse per call. Gating
    // every card list on the owned set turns this from per-pull into
    // per-render, which is why it had to stop scaling with the caller count.
    expect(stateReadCount()).toBe(1);
  });

  it('runs the legacy-key scan once for a never-drawn deck, not once per call', async () => {
    // The worst case for read amplification, and the one the gate would have
    // multiplied: a miss on the scoped key falls through to three more reads
    // looking for pre-partition data that will never appear.
    await loadDrawState(SLUG);
    await loadDrawState(SLUG);

    // Was 8 (4 per call). "Nothing here" is a real answer and is cached like
    // any other; only a *failed* read is left uncached.
    expect(getItemCalls.length).toBe(4);
  });

  it('does not report a card as owned merely because it was studied', async () => {
    // The store's own claim, and the reason the grandfather union in
    // effectiveOwned.ts has to exist: a 1.4.0 client can hand this device a
    // learned card through progressSync without it ever passing through a
    // draw, and nothing in this record will ever mention it.
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));

    expect((await loadDrawState(SLUG)).owned).toEqual(['c1']);
  });

  it('answers a write from memory without reading it back', async () => {
    await saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: { draws: 3, threshold: 10 } });

    const loaded = await loadDrawState(SLUG);

    expect(loaded.owned).toEqual(['c1', 'c2']);
    expect(loaded.pity).toEqual({ draws: 3, threshold: 10 });
    // Write-through, not write-invalidate: a draw already knows the post-draw
    // record, so making the next reader re-parse it from disk buys nothing.
    expect(stateReadCount()).toBe(0);
    // Still durable. A cache that swallowed the write would pass every
    // assertion above and lose the collection at the next launch.
    expect(JSON.parse(store.get(stateKeyFor(null))!).owned).toEqual(['c1', 'c2']);
  });

  it('goes back to storage after the cache is invalidated', async () => {
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));
    await loadDrawState(SLUG);

    invalidateDrawStateCache();
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1', 'c2'], pity: null }));

    expect((await loadDrawState(SLUG)).owned).toEqual(['c1', 'c2']);
    expect(stateReadCount()).toBe(2);
  });

  it('forgets a wiped collection when the debug reset runs', async () => {
    const { resetAllProgress } = await import('../../src/features/debug/resetProgress');
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));
    await loadDrawState(SLUG);

    await resetAllProgress();

    // The reset deletes by key prefix, which is the one production path that
    // changes this data without going through saveDrawState. Left cached, the
    // next draw would read the pre-reset collection out of memory and write it
    // straight back: the reset would appear to work and then undo itself.
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });

  it('keeps one account collection out of another', async () => {
    setActiveUserSubForStorage('user-a');
    await saveDrawState(SLUG, { owned: ['a1'], pity: null });

    setActiveUserSubForStorage('user-b');
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
    await saveDrawState(SLUG, { owned: ['b1'], pity: null });

    setActiveUserSubForStorage('user-a');
    expect((await loadDrawState(SLUG)).owned).toEqual(['a1']);
    // Signed out is its own partition, not a view of whoever was last in.
    setActiveUserSubForStorage(null);
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });

  it('does not cache the empty answer a failed read falls back to', async () => {
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));
    failGetItemFor = (key) => key === stateKeyFor(null);

    expect((await loadDrawState(SLUG)).owned).toEqual([]);

    failGetItemFor = null;

    // One bad read must cost one bad read. Caching the fallback would turn a
    // transient storage error into "your collection is gone until you restart".
    expect((await loadDrawState(SLUG)).owned).toEqual(['c1']);
  });

  it('leaves memory agreeing with disk when a write is killed', async () => {
    store.set(stateKeyFor(null), JSON.stringify({ owned: ['c1'], pity: null }));
    await loadDrawState(SLUG);

    failSetItemFor = (key) => key === stateKeyFor(null);
    await expect(
      saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: null }),
    ).rejects.toThrow(/storage write killed/);
    failSetItemFor = null;

    // The atomicity work these keys exist for reaches as far as the cache:
    // a record that never landed on disk must not be readable from memory,
    // or a killed draw looks committed until the next launch takes it back.
    expect((await loadDrawState(SLUG)).owned).toEqual(['c1']);
    expect(JSON.parse(store.get(stateKeyFor(null))!).owned).toEqual(['c1']);
  });

  it('hands out records that callers cannot mutate into the cache', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: { draws: 1, threshold: 10 } });

    const first = await loadDrawState(SLUG);
    first.owned.push('ghost');
    first.pity!.draws = 99;

    // Before the cache every load returned freshly parsed JSON, so callers
    // could scribble on it harmlessly -- pity.ts hands the array it got back
    // straight to saveDrawState. Sharing the stored object would have made
    // that aliasing, where a local edit silently rewrites what everyone reads.
    const second = await loadDrawState(SLUG);
    expect(second.owned).toEqual(['c1']);
    expect(second.pity).toEqual({ draws: 1, threshold: 10 });
  });
});

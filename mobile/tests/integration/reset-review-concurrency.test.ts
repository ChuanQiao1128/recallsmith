import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import type { DeckExport } from '../../src/types/deckExport';

const fixture = vi.hoisted(() => ({
  store: new Map<string, string>(),
  pauseRead: null as null | ((keys: readonly string[]) => Promise<void>),
  pauseEnumeration: null as null | (() => Promise<void>),
  failWrite: '',
  failRead: '',
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      const value = fixture.store.get(key) ?? null;
      await fixture.pauseRead?.([key]);
      if (key === fixture.failRead) throw new Error('storage read failed');
      return value;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (key === fixture.failWrite) throw new Error('storage full');
      fixture.store.set(key, value);
    }),
    getAllKeys: vi.fn(async () => {
      const keys = [...fixture.store.keys()];
      await fixture.pauseEnumeration?.();
      return keys;
    }),
    multiGet: vi.fn(async (keys: string[]) => {
      const values = keys.map(key => [key, fixture.store.get(key) ?? null]);
      await fixture.pauseRead?.(keys);
      return values;
    }),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      for (const [key, value] of pairs) {
        if (key === fixture.failWrite) throw new Error('storage full');
        fixture.store.set(key, value);
      }
    }),
  },
}));

import {
  resetAllReviewSchedules, saveDeckProgress, setActiveUserSubForStorage, updateDeckProgress,
  captureProgressUserSub, invalidateActiveUserSubCache,
} from '../../src/review/storage';
import { subscribeProgressChanges } from '../../src/sync/progressChanges';

const key = (sub: string) => `devcards:u:${sub}:deck-progress:deck`;
const deck = { Slug: 'deck', Version: '1', Cards: [{ StableUid: 'one', Revision: 1 }] } as DeckExport;
const previous: CardProgress = {
  stableUid: 'one', stage: 1, lastReviewedAt: 100, nextReviewAt: 999,
  fsrsStability: 1, fsrsDifficulty: 5, fsrsAnchorAt: 100, fsrsReviewedAt: 100,
};
const newer: CardProgress = {
  ...previous, stage: 2, lastReviewedAt: 200, nextReviewAt: 2000,
  fsrsStability: 4, fsrsAnchorAt: 200, fsrsReviewedAt: 200,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function read(sub = 'A'): CardProgress {
  return JSON.parse(fixture.store.get(key(sub))!)[0];
}

beforeEach(() => {
  fixture.store.clear();
  fixture.pauseRead = null;
  fixture.pauseEnumeration = null;
  fixture.failWrite = '';
  fixture.failRead = '';
  fixture.store.set(key('A'), JSON.stringify([previous]));
  setActiveUserSubForStorage('A');
});

describe('schedule reset serializes with reviews and remote merges', () => {
  it('fails closed when the owner cannot be read instead of resetting anonymous progress', async () => {
    fixture.store.set(key('anon'), JSON.stringify([previous]));
    invalidateActiveUserSubCache();
    fixture.failRead = 'devcards:auth:activeUserSub:v1';

    await expect(resetAllReviewSchedules(new Date(1000))).rejects.toThrow('storage read failed');

    expect(read('anon')).toEqual(previous);
    expect(read('A')).toEqual(previous);
  });

  it.each([false, true])('does not let an old identity read replace the next account cache (read failure: %s)', async fail => {
    const activeKey = 'devcards:auth:activeUserSub:v1';
    fixture.store.set(activeKey, 'A');
    invalidateActiveUserSubCache();
    const entered = deferred();
    const release = deferred();
    fixture.pauseRead = async keys => {
      if (!keys.includes(activeKey)) return;
      fixture.pauseRead = null;
      entered.resolve();
      await release.promise;
    };
    const oldRead = captureProgressUserSub();
    await entered.promise;
    fixture.store.set(activeKey, 'B');
    setActiveUserSubForStorage('B');
    if (fail) fixture.failRead = activeKey;
    release.resolve();
    expect(await oldRead).toBe(fail ? 'anon' : 'A');
    fixture.failRead = '';
    expect(await captureProgressUserSub()).toBe('B');
  });

  it('cannot roll back a newer write while its old snapshot is pending', async () => {
    const captured = deferred();
    const release = deferred();
    fixture.pauseRead = async keys => {
      if (!keys.includes(key('A'))) return;
      fixture.pauseRead = null;
      captured.resolve();
      await release.promise;
    };
    const reset = resetAllReviewSchedules(new Date(1000));
    await captured.promise;
    const save = saveDeckProgress(deck, [newer], 'A');
    await new Promise<void>(resolve => setImmediate(resolve));
    release.resolve();
    await Promise.all([reset, save]);
    expect(read()).toMatchObject(newer);
  });

  it('resets the latest projection after waiting for an already running update', async () => {
    const entered = deferred();
    const release = deferred();
    const save = updateDeckProgress(deck, async () => {
      entered.resolve();
      await release.promise;
      return [newer];
    }, 'A');
    await entered.promise;
    const reset = resetAllReviewSchedules(new Date(1000));
    await new Promise<void>(resolve => setImmediate(resolve));
    release.resolve();
    await Promise.all([save, reset]);
    expect(read()).toEqual({ ...newer, nextReviewAt: 1000 });
  });

  it('captures A before enumeration and never follows a later switch to B', async () => {
    fixture.store.set(key('B'), JSON.stringify([newer]));
    const entered = deferred();
    const release = deferred();
    fixture.pauseEnumeration = async () => {
      entered.resolve();
      await release.promise;
    };
    const reset = resetAllReviewSchedules(new Date(1000));
    await entered.promise;
    setActiveUserSubForStorage('B');
    release.resolve();
    await reset;
    expect(read('A').nextReviewAt).toBe(1000);
    expect(read('B')).toEqual(newer);
  });

  it('reports storage failure without claiming a reset succeeded', async () => {
    fixture.failWrite = key('A');
    await expect(resetAllReviewSchedules(new Date(1000))).rejects.toThrow('storage full');
    expect(read()).toEqual(previous);
  });

  it('notifies the captured owner only after the changed progress is durable', async () => {
    const changes: unknown[] = [];
    const unsubscribe = subscribeProgressChanges(change => {
      changes.push({ ...change, nextReviewAt: read().nextReviewAt });
    });
    try {
      await resetAllReviewSchedules(new Date(1000));
      expect(changes).toEqual([{ userSub: 'A', deckSlug: 'deck', nextReviewAt: 1000 }]);
    } finally { unsubscribe(); }
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sync pull keyset-pagination tests for progressSync.pullProgressAndApply,
 * driven through the public surface (setActiveUserSub + setSyncAccessToken +
 * forceProgressSync) so the module's export surface stays untouched:
 * - old server (no nextCursor/hasMore) -> exactly one request, legacy behavior
 * - 3-page drain applies batches in order, persists cursor only after each batch
 * - hasMore=false still persists nextCursor; next sync resumes from it
 * - page-boundary duplicate rows are tolerated (real merge is idempotent)
 * - runaway hasMore=true is stopped by the hard page cap (20)
 */

const USER = 'user1';
const CURSOR_V1_KEY = `devcards:u:${USER}:sync:cursorMs:v1`;
const CURSOR_V2_KEY = `devcards:u:${USER}:sync:cursor:v2`;

/** In-memory AsyncStorage. */
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
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidN}`),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: 'test' } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

/** Scripted API: bootstrap + push are canned; pull pages come from pullResponder. */
const pullPaths: string[] = [];
const cursorTokenAtRequest: Array<string | null> = [];
let pullResponder: (idx: number, path: string) => any = () => ({
  serverTimeMs: 1,
  sinceMs: null,
  items: [],
});

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, _opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: USER, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      return ok({
        serverTimeMs: 1,
        receivedCount: 0,
        acceptedCount: 0,
        acceptedEventIds: [],
        duplicateEventIds: [],
      });
    }
    if (path.startsWith('/api/v1/sync/progress')) {
      const idx = pullPaths.length;
      pullPaths.push(path);
      // Snapshot the persisted keyset cursor at request time: proves the cursor
      // is only persisted AFTER the previous batch was applied.
      cursorTokenAtRequest.push(store.get(CURSOR_V2_KEY) ?? null);
      const r = pullResponder(idx, path);
      if (r && r.__throw) {
        // Simulate a non-2xx apiJson rejection (real client attaches status/code).
        const err: any = new Error(r.__throw.message ?? 'bad request');
        err.status = r.__throw.status;
        err.apiErrorCode = r.__throw.code ?? null;
        throw err;
      }
      return ok(r);
    }
    throw new Error(`unexpected apiJson path: ${path}`);
  }),
}));

/** Installed decks by slug. */
const decks = new Map<string, any>();
vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async (slug: string) => decks.get(slug) ?? null),
}));

/** Stateful local progress store so page N+1 merges against page N's result. */
const localProgress = new Map<string, any[]>();
const saveCalls: Array<{ slug: string; merged: any[] }> = [];
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async (deck: any) => localProgress.get(String(deck?.slug)) ?? []),
  saveDeckProgress: vi.fn(async (deck: any, merged: any[]) => {
    saveCalls.push({ slug: String(deck?.slug), merged });
    localProgress.set(String(deck?.slug), merged);
  }),
  setActiveUserSubForStorage: vi.fn(),
}));

import {
  forceProgressSync,
  resetProgressSyncState,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

function row(slug: string, uid: string, t: number) {
  return {
    deckSlug: slug,
    stableUid: uid,
    status: 1,
    reviewCount: 1,
    lastRating: 3,
    lastReviewedAtMs: t,
    nextReviewAtMs: t + 86_400_000,
    updatedAtMs: t,
  };
}

const emptyPage = () => ({ serverTimeMs: 1, sinceMs: null, items: [] });

beforeAll(async () => {
  // Set user first (no token yet -> no schedule), then token; drain the
  // token_set schedule deterministically so tests start from an idle module.
  await setActiveUserSub(USER);
  await setSyncAccessToken('test-token');
  await forceProgressSync('manual');
});

beforeEach(async () => {
  // Clears devcards:u:<sub>:* keys and resets in-memory throttle/heal state.
  await resetProgressSyncState();
  pullPaths.length = 0;
  cursorTokenAtRequest.length = 0;
  saveCalls.length = 0;
  localProgress.clear();
  decks.clear();
  pullResponder = () => emptyPage();
});

describe('pullProgressAndApply keyset pagination drain', () => {
  it('old server without nextCursor/hasMore -> exactly one request, legacy ms cursor only', async () => {
    decks.set('algo', { slug: 'algo', cards: [{ stableUid: 'u1' }, { stableUid: 'u2' }] });
    pullResponder = (idx) =>
      idx === 0
        ? { serverTimeMs: 1, sinceMs: null, items: [row('algo', 'u1', 1000), row('algo', 'u2', 2000)] }
        : emptyPage();

    await forceProgressSync('manual');

    expect(pullPaths).toHaveLength(1);
    expect(pullPaths[0]).toContain('limit=5000');
    // No cursor of either kind on the very first request.
    expect(pullPaths[0]).not.toContain('cursor=');
    expect(pullPaths[0]).not.toContain('sinceMs=');
    // Legacy behavior preserved: ms cursor = max(updatedAtMs); no keyset cursor stored.
    expect(store.get(CURSOR_V1_KEY)).toBe('2000');
    expect(store.get(CURSOR_V2_KEY)).toBeUndefined();
    expect(localProgress.get('algo')).toHaveLength(2);
  });

  it('3-page drain applies batches in order and persists the cursor only after each batch', async () => {
    decks.set('algo', {
      slug: 'algo',
      cards: [{ stableUid: 'u1' }, { stableUid: 'u2' }, { stableUid: 'u3' }],
    });
    pullResponder = (idx) => {
      if (idx === 0)
        return { serverTimeMs: 1, sinceMs: null, items: [row('algo', 'u1', 1000)], nextCursor: 'CUR1', hasMore: true };
      // u2 shares u1's updatedAt: the page-boundary timestamp tie the keyset cursor fixes.
      if (idx === 1)
        return { serverTimeMs: 1, sinceMs: null, items: [row('algo', 'u2', 1000)], nextCursor: 'CUR2', hasMore: true };
      if (idx === 2)
        return { serverTimeMs: 1, sinceMs: null, items: [row('algo', 'u3', 3000)], nextCursor: 'CUR3', hasMore: false };
      return emptyPage();
    };

    await forceProgressSync('manual');

    expect(pullPaths).toHaveLength(3);
    // Each follow-up request carries the previous page's server-issued cursor.
    expect(pullPaths[1]).toContain('cursor=CUR1');
    expect(pullPaths[2]).toContain('cursor=CUR2');
    // Legacy sinceMs still sent alongside for old-server/rollback compatibility.
    expect(pullPaths[1]).toContain('sinceMs=1000');
    // Cursor was persisted only AFTER the batch that produced it was applied.
    expect(cursorTokenAtRequest).toEqual([null, 'CUR1', 'CUR2']);
    // Final page's cursor persisted too: the next sync resumes from the exact tuple.
    expect(store.get(CURSOR_V2_KEY)).toBe('CUR3');
    expect(store.get(CURSOR_V1_KEY)).toBe('3000');
    // All batches merged in order; the equal-timestamp row was NOT skipped.
    expect(localProgress.get('algo')!.map((p: any) => p.stableUid)).toEqual(['u1', 'u2', 'u3']);
  });

  it(
    'hasMore=false still persists nextCursor and the next sync resumes from it',
    async () => {
      decks.set('algo', { slug: 'algo', cards: [{ stableUid: 'u1' }] });
      pullResponder = (idx) =>
        idx === 0
          ? { serverTimeMs: 1, sinceMs: null, items: [row('algo', 'u1', 1000)], nextCursor: 'CURX', hasMore: false }
          : { ...emptyPage(), nextCursor: 'CURX', hasMore: false };

      await forceProgressSync('manual');

      expect(pullPaths).toHaveLength(1);
      expect(store.get(CURSOR_V2_KEY)).toBe('CURX');

      // Wait out MIN_PULL_INTERVAL_MS (2s) so the second sync's pull is not throttled.
      await new Promise((r) => setTimeout(r, 2100));
      await forceProgressSync('manual');

      expect(pullPaths).toHaveLength(2);
      expect(pullPaths[1]).toContain('cursor=CURX');
      expect(pullPaths[1]).toContain('sinceMs=1000');
    },
    15_000,
  );

  it('duplicate rows straddling a page boundary are tolerated (real merge is idempotent)', async () => {
    decks.set('algo', { slug: 'algo', cards: [{ stableUid: 'u1' }, { stableUid: 'u2' }] });
    const dup = row('algo', 'u2', 1000);
    pullResponder = (idx) => {
      if (idx === 0)
        return {
          serverTimeMs: 1,
          sinceMs: null,
          items: [row('algo', 'u1', 1000), dup],
          nextCursor: 'C1',
          hasMore: true,
        };
      if (idx === 1)
        return { serverTimeMs: 1, sinceMs: null, items: [{ ...dup }], nextCursor: 'C2', hasMore: false };
      return emptyPage();
    };

    await forceProgressSync('manual');

    expect(pullPaths).toHaveLength(2);
    const finalLocal = localProgress.get('algo')!;
    // u2 exists exactly once — the duplicate re-delivery did not double-count.
    expect(finalLocal).toHaveLength(2);
    expect(finalLocal.filter((p: any) => p.stableUid === 'u2')).toHaveLength(1);
    // The duplicate page merged as a no-op: only page 1 triggered a save.
    expect(saveCalls).toHaveLength(1);
    expect(store.get(CURSOR_V2_KEY)).toBe('C2');
  });

  it('a stale v2 cursor rejected with 400 self-heals: cursor cleared, page retried via sinceMs', async () => {
    decks.set('algo', { slug: 'algo', cards: [{ stableUid: 'u1' }, { stableUid: 'u2' }] });
    // Seed a corrupt persisted keyset cursor + legacy ms cursor from an earlier
    // sync, plus a remote-cache key so healCursorIfCacheMissing does NOT clear
    // the cursors first (we want the 400 path itself to do the healing).
    store.set(CURSOR_V2_KEY, 'BAD_CURSOR');
    store.set(CURSOR_V1_KEY, '1000');
    store.set(`devcards:u:${USER}:sync:remoteCache:v1:algo`, JSON.stringify({ u1: { updatedAtMs: 1000 } }));

    pullResponder = (idx, path) => {
      if (idx === 0) {
        // First attempt carries the bad cursor -> server rejects loudly.
        expect(path).toContain('cursor=BAD_CURSOR');
        return { __throw: { status: 400, message: 'cursor is malformed', code: 'VALIDATION_ERROR' } };
      }
      // Self-heal retry: no cursor param, legacy sinceMs only.
      expect(path).not.toContain('cursor=');
      expect(path).toContain('sinceMs=1000');
      return {
        serverTimeMs: 1,
        sinceMs: 1000,
        items: [row('algo', 'u2', 2000)],
        nextCursor: 'FRESH',
        hasMore: false,
      };
    };

    await forceProgressSync('manual');

    // Two requests: rejected cursor attempt + sinceMs retry that succeeded.
    expect(pullPaths).toHaveLength(2);
    // The batch from the retry was applied and a FRESH server cursor persisted.
    expect(localProgress.get('algo')!.some((p: any) => p.stableUid === 'u2')).toBe(true);
    expect(store.get(CURSOR_V2_KEY)).toBe('FRESH');
    // Pull is not permanently poisoned: the bad token is gone.
    expect(store.get(CURSOR_V2_KEY)).not.toBe('BAD_CURSOR');
  });

  it('a server that always answers hasMore=true is stopped by the hard 20-page cap', async () => {
    decks.set('algo', {
      slug: 'algo',
      cards: Array.from({ length: 30 }, (_, i) => ({ stableUid: `u${i}` })),
    });
    pullResponder = (idx) => ({
      serverTimeMs: 1,
      sinceMs: null,
      items: [row('algo', `u${idx}`, 1000 + idx)],
      nextCursor: `C${idx}`,
      hasMore: true,
    });

    await forceProgressSync('manual');

    expect(pullPaths).toHaveLength(20);
    // Progress made so far is kept; the next sync resumes from the last cursor.
    expect(store.get(CURSOR_V2_KEY)).toBe('C19');
  });
});

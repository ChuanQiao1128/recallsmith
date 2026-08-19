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

// review/storage stays real: "which account's collection did the union start
// from" is one of the claims here, and a stubbed scope helper would answer it
// for the code instead of asking it.
import { setActiveUserSubForStorage } from '../../src/review/storage';
import type { CardProgress } from '../../src/review/model';
import { resolveEffectiveOwned } from '../../src/features/gacha/draw/effectiveOwned';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

const SLUG = 'csharp';

/** Studied at least once: what every other screen already calls "Learning". */
function learned(stableUid: string): CardProgress {
  return { stableUid, stage: 2, lastReviewedAt: 1_700_000_000_000, nextReviewAt: 1_700_086_400_000 };
}

/** Present in the progress list but never answered. */
function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0 };
}

describe('resolveEffectiveOwned', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('grandfathers a card that was studied but never drawn', async () => {
    // The shape a 1.4.0 client produces and keeps producing: progressSync
    // delivers a rating for a card this device never pulled. A one-shot
    // migration would have closed the door on c2 the day after it ran.
    await saveDrawState(SLUG, { owned: ['c1'], pity: null });

    const effective = await resolveEffectiveOwned(SLUG, [learned('c2')]);

    expect([...effective].sort()).toEqual(['c1', 'c2']);
  });

  it('leaves a card nobody has drawn or studied out', async () => {
    // Without this the gate has nothing to gate: a resolver that answers
    // "everything" passes every union test above and still ships no gate.
    await saveDrawState(SLUG, { owned: ['c1'], pity: null });

    const effective = await resolveEffectiveOwned(SLUG, [learned('c2'), untouched('c3')]);

    expect(effective.has('c3')).toBe(false);
  });

  it('does not grandfather a card that is only scheduled', async () => {
    // nextReviewAt without lastReviewedAt is a card the scheduler has an
    // opinion about and the user has never answered -- a revision demotion or
    // a merged remote row can produce it. Studied means answered.
    await saveDrawState(SLUG, { owned: [], pity: null });

    const scheduledOnly: CardProgress = { stableUid: 'c4', stage: 0, nextReviewAt: 1_700_086_400_000 };
    const effective = await resolveEffectiveOwned(SLUG, [scheduledOnly]);

    expect(effective.has('c4')).toBe(false);
  });

  it('counts a card that was both drawn and studied once', async () => {
    await saveDrawState(SLUG, { owned: ['c1'], pity: null });

    const effective = await resolveEffectiveOwned(SLUG, [learned('c1')]);

    expect(effective.size).toBe(1);
  });

  it('unions against the signed-in account collection, not the previous one', async () => {
    // The other half of the grandfather rule: it is per account. Signing in
    // must not hand the new account the device's anon collection, and the
    // read model must not serve one partition's cards to another.
    await saveDrawState(SLUG, { owned: ['anon-card'], pity: null });

    setActiveUserSubForStorage('user-a');
    const effective = await resolveEffectiveOwned(SLUG, [learned('c2')]);

    expect([...effective]).toEqual(['c2']);

    setActiveUserSubForStorage(null);
    expect([...(await resolveEffectiveOwned(SLUG, []))]).toEqual(['anon-card']);
  });

  it('includes a card the moment its draw is committed, before any sync', async () => {
    // Product ruling: a draw made offline is studiable immediately. Local
    // ownership is the fact; the cloud copy is a backup of it. Nothing here
    // may wait on a network round trip.
    await saveDrawState(SLUG, { owned: [], pity: null });
    expect((await resolveEffectiveOwned(SLUG, [])).size).toBe(0);

    await saveDrawState(SLUG, { owned: ['fresh'], pity: null });

    expect([...(await resolveEffectiveOwned(SLUG, []))]).toEqual(['fresh']);
  });
});

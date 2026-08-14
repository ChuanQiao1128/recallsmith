// A deck revision pulls a learned card back to due so the user relearns the
// changed content. That demotion used to survive exactly until the next pull:
// the server still held the due date from the last real review, the merge had
// no way to tell "older answer" from "newer truth", and the relearn was undone
// silently, every time, on every device. The content update reached the deck
// and never reached the user.
//
// The mark that separates the two is revisionDemotedAt, written by storage.ts
// when it demotes and cleared by scheduleNextReview when a real review finally
// happens. These tests drive the whole loop (demote -> pull -> still due)
// through the real storage and the real merge, because the bug lived in the
// seam between them and either half alone looks correct.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

// progressSync reaches for the app's runtime deps at import time. Only the pure
// merge is exercised here, so these stubs exist to make the module importable.
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));

import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import { isDue, scheduleNextReview, type CardProgress } from '../../src/review/model';
import { mergeRemoteIntoLocalProgress } from '../../src/sync/progressSync';
import type { DeckExport } from '../../src/types/deckExport';

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_REVIEW = Date.now() - 10 * DAY_MS;
const OLD_DUE = Date.now() + 20 * DAY_MS;

function deckAtRevision(revision: number): DeckExport {
  return {
    Slug: 'revision-deck',
    Title: 'Revision Deck',
    Locale: 'en',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: 1,
    FreeCardCount: 1,
    Cards: [
      {
        StableUid: 'uid-a',
        Revision: revision,
        Question: 'q',
        Difficulty: 1,
        OrderInDeck: 1,
      },
    ],
  } as DeckExport;
}

/** The row the server holds: the last real review, with its pre-update due date. */
function remoteRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    deckSlug: 'revision-deck',
    stableUid: 'uid-a',
    status: 1,
    reviewCount: 1,
    lastRating: 3,
    lastReviewedAtMs: LAST_REVIEW,
    nextReviewAtMs: OLD_DUE,
    srsStage: 4,
    updatedAtMs: Date.now(),
    ...overrides,
  };
}

/** Save a learned card at revision 1, then load it against a newer revision. */
async function demoteByRevisionBump(): Promise<CardProgress> {
  const saved: CardProgress = {
    stableUid: 'uid-a',
    stage: 4,
    lastReviewedAt: LAST_REVIEW,
    nextReviewAt: OLD_DUE,
    lastSeenRevision: 1,
  };

  await saveDeckProgress(deckAtRevision(1), [saved]);
  const [demoted] = await loadDeckProgress(deckAtRevision(2));
  return demoted;
}

describe('revision demotion survives a pull', () => {
  beforeEach(() => {
    store.clear();
  });

  it('marks the demotion with a timestamp, not just a due date', async () => {
    const demoted = await demoteByRevisionBump();

    expect(isDue(demoted, new Date())).toBe(true);
    expect(demoted.stage).toBe(3);
    expect(typeof demoted.revisionDemotedAt).toBe('number');
    expect(demoted.revisionDemotedAt!).toBeGreaterThan(LAST_REVIEW);
  });

  it('demote -> pull -> the card is still due', async () => {
    const demoted = await demoteByRevisionBump();

    // The pull that used to undo everything: same review, old due date.
    const { merged } = mergeRemoteIntoLocalProgress([demoted], [remoteRow()] as any);

    expect(merged[0].nextReviewAt).toBe(demoted.nextReviewAt);
    expect(isDue(merged[0], new Date())).toBe(true);
    // The rung stays local too: the demotion is one verdict about one card, and
    // taking the remote rung next to a local due date is the stitched state the
    // merge is written to avoid.
    expect(merged[0].stage).toBe(3);

    // Idempotent: a second pull of the same row does not chip away at it, which
    // is what "silently, on every pull" used to mean.
    const again = mergeRemoteIntoLocalProgress(merged, [remoteRow()] as any);
    expect(again.merged[0].nextReviewAt).toBe(demoted.nextReviewAt);
    expect(isDue(again.merged[0], new Date())).toBe(true);
  });

  it('survives the AsyncStorage round trip between two pulls', async () => {
    const demoted = await demoteByRevisionBump();
    const { merged } = mergeRemoteIntoLocalProgress([demoted], [remoteRow()] as any);

    await saveDeckProgress(deckAtRevision(2), merged);
    const [reloaded] = await loadDeckProgress(deckAtRevision(2));

    expect(reloaded.revisionDemotedAt).toBeDefined();
    expect(isDue(reloaded, new Date())).toBe(true);
  });

  it('a review that happened AFTER the demotion still wins', async () => {
    // The protection is local intent, not a veto on the server. Another device
    // that reviewed the new content is newer evidence and must come through.
    const demoted = await demoteByRevisionBump();
    const afterMs = demoted.revisionDemotedAt! + 60_000;

    const { merged } = mergeRemoteIntoLocalProgress(
      [demoted],
      [
        remoteRow({
          lastReviewedAtMs: afterMs,
          nextReviewAtMs: afterMs + 8 * DAY_MS,
          srsStage: 3,
        }),
      ] as any,
    );

    expect(merged[0].lastReviewedAt).toBe(afterMs);
    expect(merged[0].nextReviewAt).toBe(afterMs + 8 * DAY_MS);
    expect(isDue(merged[0], new Date())).toBe(false);
  });

  it('a real review on this device clears the mark', async () => {
    const demoted = await demoteByRevisionBump();
    const reviewed = scheduleNextReview(demoted, 'good', new Date());

    expect(reviewed.revisionDemotedAt).toBeUndefined();

    // With the mark gone the remote row is judged on timestamps alone again,
    // and the local review is the newer one, so nothing changes.
    const { merged } = mergeRemoteIntoLocalProgress([reviewed], [remoteRow()] as any);
    expect(merged[0].nextReviewAt).toBe(reviewed.nextReviewAt);
  });
});

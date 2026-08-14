// Multi-device sync simulator.
//
// Invariant A says: the same set of review events, whatever order they arrive
// in and however often they are replayed, leaves every device and the server in
// the same final state. Nothing in the repo proved that, because the two halves
// of the merge live in different languages and neither half was ever run
// against the other.
//
// This file is pure memory: no AsyncStorage, no HTTP, no timers. FakeServer is
// a TS transcription of the 6-CTE ingest SQL in
// src_C/Vpc/Runtime/ProgressEvents.cs:245-396 (event_id dedupe, additive
// review_count, greatest() on the monotonic columns, event-time LWW on the
// last_rating/due_at/srs_stage group). The devices call the REAL scheduleNextReview and the
// REAL mergeRemoteIntoLocalProgress, so a client-side order dependency shows up
// here as a failing assertion rather than as a support ticket.
//
// The RNG is a seeded mulberry32, not Math.random: a failing seed has to be
// replayable from its number alone, or "it went red on CI once" is all anyone
// ever learns.
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// progressSync pulls in the app's native/runtime deps at import time. The
// simulator only ever calls one pure function out of it, so these stubs exist
// to make the module importable, not to model anything.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    getAllKeys: vi.fn(async () => []),
    multiRemove: vi.fn(async () => undefined),
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'uuid') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => undefined),
  setActiveUserSubForStorage: vi.fn(),
}));

import { scheduleNextReview, type CardProgress, type ReviewRating } from '../../src/review/model';
import { mergeRemoteIntoLocalProgress } from '../../src/sync/progressSync';

const DECK = 'aws-basics';
const UIDS = ['uid-a', 'uid-b', 'uid-c'];
const T0 = 1_700_000_000_000;
const RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
const RATING_VALUE: Record<ReviewRating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

/** Seeded PRNG. Same seed, same run, on any machine and any day. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SyncEvent = {
  eventId: string;
  stableUid: string;
  rating: ReviewRating;
  eventTimeMs: number;
  nextReviewAtMs: number;
  // The server reads this out of progressAfter.stage. null models a client
  // (or a stored row) from before migration 013.
  srsStage: number | null;
};

type ServerRow = {
  stableUid: string;
  status: number;
  reviewCount: number;
  lastRating: number;
  lastReviewedAtMs: number;
  dueAtMs: number;
  srsStage: number | null;
  updatedAtMs: number;
};

/**
 * TS replica of the ingest transaction. One method per CTE stage so a reader
 * can diff it against the SQL line by line.
 */
class FakeServer {
  readonly seenEventIds = new Set<string>();
  readonly rows = new Map<string, ServerRow>();

  ingest(batch: SyncEvent[], nowMs: number): void {
    // `ins`: on conflict (event_id) do nothing. Everything downstream reads
    // from `ins`, so a duplicate contributes nothing at all -- not to the
    // counter, not to the outbox, not to the aggregate.
    const inserted: SyncEvent[] = [];
    for (const e of batch) {
      if (this.seenEventIds.has(e.eventId)) continue;
      this.seenEventIds.add(e.eventId);

      // Mirrors the C# parameter layer: nextReviewAt is floored at eventTime
      // (ProgressEvents.cs:108) and eventTime is capped at now + 5 min.
      const eventTimeMs = Math.min(e.eventTimeMs, nowMs + 5 * 60 * 1000);
      inserted.push({
        ...e,
        eventTimeMs,
        nextReviewAtMs: Math.max(e.nextReviewAtMs, eventTimeMs),
      });
    }
    if (inserted.length === 0) return;

    const byUid = new Map<string, SyncEvent[]>();
    for (const e of inserted) {
      const arr = byUid.get(e.stableUid) ?? [];
      arr.push(e);
      byUid.set(e.stableUid, arr);
    }

    for (const [uid, group] of byUid.entries()) {
      // `agg`: count(*) per card -- the same-batch fold that keeps ON CONFLICT
      // from having to touch one row twice.
      const inc = group.length;

      // `last_row`: distinct on (...) order by event_time desc. Postgres leaves
      // the winner unspecified when two events share event_time; the eventId
      // tiebreak here makes the replica deterministic, and the gap that hides
      // is asserted in the "documented boundary" test below.
      const last = group.reduce((a, b) =>
        b.eventTimeMs > a.eventTimeMs ||
        (b.eventTimeMs === a.eventTimeMs && b.eventId > a.eventId)
          ? b
          : a,
      );

      const excluded: ServerRow = {
        stableUid: uid,
        status: 1,
        reviewCount: inc,
        lastRating: RATING_VALUE[last.rating],
        lastReviewedAtMs: last.eventTimeMs,
        dueAtMs: last.nextReviewAtMs,
        srsStage: last.srsStage,
        updatedAtMs: nowMs,
      };

      const current = this.rows.get(uid);
      if (!current) {
        this.rows.set(uid, excluded);
        continue;
      }

      // `upsert ... do update`: one operator per column, chosen by what the
      // column means. Counters add, monotonic facts take greatest(), and the
      // three "state as of the last review" columns follow event time -- one
      // predicate for all three, so the rung can never come from a different
      // review than the due date next to it.
      const excludedWins = excluded.lastReviewedAtMs >= current.lastReviewedAtMs;
      this.rows.set(uid, {
        stableUid: uid,
        status: Math.max(current.status, excluded.status),
        reviewCount: current.reviewCount + excluded.reviewCount,
        lastReviewedAtMs: Math.max(current.lastReviewedAtMs, excluded.lastReviewedAtMs),
        lastRating: excludedWins ? excluded.lastRating : current.lastRating,
        dueAtMs: excludedWins ? excluded.dueAtMs : current.dueAtMs,
        srsStage: excludedWins ? excluded.srsStage : current.srsStage,
        updatedAtMs: nowMs,
      });
    }
  }

  /** The /sync/progress payload shape. */
  items(): any[] {
    return [...this.rows.values()].map((r) => ({
      deckSlug: DECK,
      stableUid: r.stableUid,
      status: r.status,
      reviewCount: r.reviewCount,
      lastRating: r.lastRating,
      lastReviewedAtMs: r.lastReviewedAtMs,
      nextReviewAtMs: r.dueAtMs,
      srsStage: r.srsStage,
      updatedAtMs: r.updatedAtMs,
    }));
  }

  /** Semantic state, minus updatedAt: that column IS arrival-ordered by design. */
  semanticState(): string {
    return JSON.stringify(
      [...this.rows.values()]
        .map((r) => ({ ...r, updatedAtMs: undefined }))
        .sort((a, b) => (a.stableUid < b.stableUid ? -1 : 1)),
    );
  }
}

class FakeDevice {
  local: CardProgress[];
  outbox: SyncEvent[] = [];
  private seq = 0;

  constructor(readonly id: string) {
    this.local = UIDS.map((uid) => ({ stableUid: uid, stage: 0, nextReviewAt: 0 }));
  }

  review(uid: string, rating: ReviewRating, nowMs: number): void {
    const idx = this.local.findIndex((p) => p.stableUid === uid);
    const next = scheduleNextReview(this.local[idx], rating, new Date(nowMs));
    this.local[idx] = next;
    this.outbox.push({
      eventId: `${this.id}-${++this.seq}`,
      stableUid: uid,
      rating,
      eventTimeMs: nowMs,
      nextReviewAtMs: next.nextReviewAt,
      // What progressAfter has always contained and the ingest used to drop.
      srsStage: next.stage,
    });
  }

  /** `keep` models a push whose response was lost: the batch is sent again later. */
  push(server: FakeServer, nowMs: number, keep = false): void {
    if (this.outbox.length === 0) return;
    server.ingest(this.outbox.slice(), nowMs);
    if (!keep) this.outbox = [];
  }

  pull(server: FakeServer, extraRows: any[] = []): void {
    const { merged } = mergeRemoteIntoLocalProgress(this.local, [...server.items(), ...extraRows]);
    this.local = merged;
  }

  /**
   * The part of local state sync owns. `stage` is in here, and that inclusion
   * is the point: it used to be excluded with a note saying two devices that
   * reviewed one card a different number of times keep different stages
   * forever. Migration 013 put the rung on the wire and in user_progress, so
   * the disclaimer became an assertion -- if stage ever stops converging, this
   * is the test that says so.
   */
  syncedState(): string {
    return JSON.stringify(
      [...this.local]
        .sort((a, b) => (a.stableUid < b.stableUid ? -1 : 1))
        .map((p) => ({
          stableUid: p.stableUid,
          stage: p.stage,
          lastReviewedAt: p.lastReviewedAt ?? null,
          nextReviewAt: p.nextReviewAt ?? 0,
        })),
    );
  }
}

type RunResult = {
  server: FakeServer;
  devices: FakeDevice[];
  batches: SyncEvent[][];
};

/**
 * One randomized run: N devices interleave review/push/pull, then everyone
 * pushes and everyone pulls once (quiesce). The clock only moves forward and
 * every op consumes a distinct millisecond, so no two events on one card share
 * an event_time; that collision is a separate, documented case.
 */
function runSimulation(seed: number, deviceCount = 3, ops = 40): RunResult {
  const rnd = mulberry32(seed);
  const server = new FakeServer();
  const devices = Array.from({ length: deviceCount }, (_, i) => new FakeDevice(`d${i}`));
  const batches: SyncEvent[][] = [];
  let clock = T0;

  const ingest = (batch: SyncEvent[], atMs: number) => {
    batches.push(batch.slice());
    server.ingest(batch, atMs);
  };

  for (let i = 0; i < ops; i++) {
    clock += 1 + Math.floor(rnd() * 5000);
    const dev = devices[Math.floor(rnd() * devices.length)];
    const roll = rnd();

    if (roll < 0.55) {
      dev.review(UIDS[Math.floor(rnd() * UIDS.length)], RATINGS[Math.floor(rnd() * RATINGS.length)], clock);
    } else if (roll < 0.8) {
      // 1-in-4 pushes never gets its ack, so the same batch is delivered twice.
      const keep = rnd() < 0.25;
      if (dev.outbox.length > 0) ingest(dev.outbox.slice(), clock);
      if (!keep) dev.outbox = [];
    } else {
      dev.pull(server);
    }
  }

  clock += 10_000;
  for (const dev of devices) {
    if (dev.outbox.length > 0) ingest(dev.outbox.slice(), clock);
    dev.outbox = [];
  }
  for (const dev of devices) dev.pull(server);

  return { server, devices, batches };
}

describe('multi-device sync simulation', () => {
  it('convergence: after quiesce every device holds the same synced state (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { devices } = runSimulation(seed);
      const first = devices[0].syncedState();
      for (const dev of devices.slice(1)) {
        expect(dev.syncedState(), `seed ${seed}: ${dev.id} diverged from d0`).toBe(first);
      }
    }
  });

  it('convergence: every device agrees with the server it converged on (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { server, devices } = runSimulation(seed);
      const serverView = JSON.stringify(
        [...server.rows.values()]
          .sort((a, b) => (a.stableUid < b.stableUid ? -1 : 1))
          .map((r) => ({
            stableUid: r.stableUid,
            // Key order matches syncedState(): these two strings are compared
            // as JSON text, so the shape has to line up as well as the values.
            stage: r.srsStage,
            lastReviewedAt: r.lastReviewedAtMs,
            nextReviewAt: r.dueAtMs,
          })),
      );
      const deviceView = JSON.stringify(
        JSON.parse(devices[0].syncedState()).filter((p: any) => p.lastReviewedAt != null),
      );
      expect(deviceView, `seed ${seed}`).toBe(serverView);
    }
  });

  it('order independence: server final state does not depend on batch arrival order', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { batches } = runSimulation(seed);
      const rnd = mulberry32(seed * 7919);

      const replay = (order: number[]) => {
        const s = new FakeServer();
        let clock = T0;
        for (const i of order) {
          clock += 1000;
          s.ingest(batches[i], clock);
        }
        return s.semanticState();
      };

      const identity = batches.map((_, i) => i);
      const expected = replay(identity);

      // K permutations of the same bag of batches, including replays of the
      // same batch: a merge that is commutative + associative + duplicate-proof
      // cannot tell them apart.
      for (let k = 0; k < 5; k++) {
        const shuffled = identity.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        expect(replay(shuffled), `seed ${seed} perm ${k}`).toBe(expected);
        expect(replay([...shuffled, ...shuffled]), `seed ${seed} perm ${k} doubled`).toBe(expected);
      }
    }
  });

  it('monotonicity: no device ever moves a card backwards in time', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = mulberry32(seed);
      const server = new FakeServer();
      const devices = Array.from({ length: 3 }, (_, i) => new FakeDevice(`d${i}`));
      const highWater = new Map<string, number>();
      let clock = T0;

      const check = (dev: FakeDevice) => {
        for (const p of dev.local) {
          const key = `${dev.id}:${p.stableUid}`;
          const seen = p.lastReviewedAt ?? 0;
          const prev = highWater.get(key) ?? 0;
          expect(seen, `seed ${seed}: ${key} went backwards`).toBeGreaterThanOrEqual(prev);
          highWater.set(key, seen);
        }
      };

      for (let i = 0; i < 40; i++) {
        clock += 1 + Math.floor(rnd() * 5000);
        const dev = devices[Math.floor(rnd() * devices.length)];
        const roll = rnd();
        if (roll < 0.55) {
          dev.review(UIDS[Math.floor(rnd() * UIDS.length)], RATINGS[Math.floor(rnd() * RATINGS.length)], clock);
        } else if (roll < 0.8) {
          dev.push(server, clock);
        } else {
          dev.pull(server);
        }
        check(dev);
      }
    }
  });

  it('client merge: a bag of rows for one card elects the same winner in any order', () => {
    // The counterexample this test was written from: two snapshots of one row
    // carrying the SAME updatedAt (server stamps updated_at from a single now()
    // per transaction, and toMs() floors it to milliseconds, so two merges of
    // one card inside one millisecond are indistinguishable on that column) but
    // different content. Under a strict `updatedAt > prev.updatedAt` the first
    // row in the array wins, so the merge answered differently depending on
    // page order.
    const local: CardProgress[] = [{ stableUid: 'uid-a', stage: 0, nextReviewAt: 0 }];
    const rowAt = (lastReviewedAt: number, nextReviewAt: number, srsStage: number) => ({
      deckSlug: DECK,
      stableUid: 'uid-a',
      status: 1,
      reviewCount: 1,
      lastRating: 3,
      lastReviewedAtMs: lastReviewedAt,
      nextReviewAtMs: nextReviewAt,
      srsStage,
      updatedAtMs: T0 + 500,
    });

    const older = rowAt(T0 + 100, T0 + 100 + 86_400_000, 1);
    const newer = rowAt(T0 + 400, T0 + 400 + 86_400_000, 2);

    const forward = mergeRemoteIntoLocalProgress(local, [older, newer] as any);
    const reverse = mergeRemoteIntoLocalProgress(local, [newer, older] as any);

    expect(JSON.stringify(forward.merged)).toBe(JSON.stringify(reverse.merged));
    // And the winner is the newer row, not "whichever was listed first".
    expect(forward.merged[0].lastReviewedAt).toBe(T0 + 400);
    // The rung travels with the due date it was produced with, in both orders.
    expect(forward.merged[0].stage).toBe(2);
    expect(reverse.merged[0].stage).toBe(2);
  });

  it('stage converges: two devices with different review counts agree after pull', () => {
    // The hole the old syncedState() comment described, now driven end to end.
    // d0 reviews the card three times and reaches rung 3; d1 reviews it once,
    // earlier, and sits on rung 1. Before stage was on the wire, d1 could only
    // guess the rung back out of the interval -- and `good` at rung 3 schedules
    // 8 days, whose floor is the 8-day bucket only by luck; a `hard` or `again`
    // review makes the guess plainly wrong.
    const server = new FakeServer();
    const d0 = new FakeDevice('d0');
    const d1 = new FakeDevice('d1');

    d1.review('uid-a', 'good', T0 + 500);
    d0.review('uid-a', 'good', T0 + 1_000);
    d0.review('uid-a', 'good', T0 + 2_000);
    d0.review('uid-a', 'good', T0 + 3_000);

    d1.push(server, T0 + 4_000);
    d0.push(server, T0 + 4_000);
    d1.pull(server);
    d0.pull(server);

    const stageOf = (dev: FakeDevice) => dev.local.find((p) => p.stableUid === 'uid-a')!.stage;

    expect(server.rows.get('uid-a')!.srsStage).toBe(3);
    expect(stageOf(d0)).toBe(3);
    expect(stageOf(d1)).toBe(3);
    // Not just equal to each other: equal to the rung the winning review left.
    expect(stageOf(d1)).toBe(server.rows.get('uid-a')!.srsStage);
  });

  it('legacy rows: a remote row without srsStage leaves the local stage alone', () => {
    // Rows merged before migration 013 come back with srsStage null. Writing a
    // 0 for them would silently drop every affected card to the bottom of the
    // ladder, so null must mean "keep what you have and infer", not "rung 0".
    const local: CardProgress[] = [
      { stableUid: 'uid-a', stage: 4, lastReviewedAt: T0, nextReviewAt: T0 + 86_400_000 },
    ];

    const legacyRow = {
      deckSlug: DECK,
      stableUid: 'uid-a',
      status: 1,
      reviewCount: 1,
      lastRating: 3,
      lastReviewedAtMs: T0 + 10_000,
      nextReviewAtMs: T0 + 10_000 + 8 * 86_400_000,
      srsStage: null,
      updatedAtMs: T0 + 10_000,
    };

    const { merged } = mergeRemoteIntoLocalProgress(local, [legacyRow] as any);

    expect(merged[0].lastReviewedAt).toBe(T0 + 10_000);
    expect(merged[0].stage).toBe(4);
  });

  it('documented boundary: an exact event_time tie on one card IS arrival ordered', () => {
    // Not a bug report, a contract. `last_rating`/`due_at` use event-time LWW
    // with `excluded.last_reviewed_at >= current`, and `distinct on ... order by
    // event_time desc` picks an unspecified row among ties. So two devices
    // rating the same card in the same millisecond is the one input where the
    // server's answer depends on which push landed first.
    //
    // Nothing upstream prevents it (event_id dedupe only removes identical
    // events, not simultaneous ones), which is exactly why it is pinned here:
    // if someone later adds a tiebreaker, this test fails and the reviewer has
    // to decide deliberately instead of accidentally.
    const at = T0 + 1_000;
    const mk = (id: string, rating: ReviewRating): SyncEvent => ({
      eventId: id,
      stableUid: 'uid-a',
      rating,
      eventTimeMs: at,
      nextReviewAtMs: at + RATING_VALUE[rating] * 86_400_000,
      srsStage: RATING_VALUE[rating],
    });

    const a = new FakeServer();
    a.ingest([mk('e1', 'again')], at + 1);
    a.ingest([mk('e2', 'easy')], at + 2);

    const b = new FakeServer();
    b.ingest([mk('e2', 'easy')], at + 1);
    b.ingest([mk('e1', 'again')], at + 2);

    expect(a.rows.get('uid-a')!.lastRating).toBe(RATING_VALUE.easy);
    expect(b.rows.get('uid-a')!.lastRating).toBe(RATING_VALUE.again);
    // srs_stage joined the same group, so it swings with its rating rather
    // than drifting onto its own answer: the group moves as one.
    expect(a.rows.get('uid-a')!.srsStage).toBe(RATING_VALUE.easy);
    expect(b.rows.get('uid-a')!.srsStage).toBe(RATING_VALUE.again);
    // The order-insensitive columns still agree, which is the point: the
    // asymmetry is confined to the LWW group.
    expect(a.rows.get('uid-a')!.reviewCount).toBe(b.rows.get('uid-a')!.reviewCount);
    expect(a.rows.get('uid-a')!.lastReviewedAtMs).toBe(b.rows.get('uid-a')!.lastReviewedAtMs);
  });
});

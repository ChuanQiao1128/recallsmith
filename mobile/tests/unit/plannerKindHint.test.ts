import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { CardProgress } from '../../src/review/model';
import type { McqKindHint } from '../../src/features/gacha/mcq/mcqRotation';

// The spy: pass-through mock (draw-result.screen.test.tsx:69-72) so the imported pickNextCard
// runs the real implementation while recording every call (its own and the helper's forward).
vi.mock('../../src/features/gacha/planner/sessionPlanner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/gacha/planner/sessionPlanner')>();
  return { ...actual, pickNextCard: vi.fn(actual.pickNextCard) };
});

import { pickNextCard } from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';

const NOW = new Date('2026-04-23T12:00:00.000Z');
const TODAY_MS = NOW.getTime();
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000;
const YESTERDAY_MS = TODAY_MS - 24 * 60 * 60 * 1000;

// The only MCQ content any fixture may carry: plan §4.3 card 1, in the server's PG key order.
const MCQ_BLOB = {
  v: 1,
  options: [
    { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
    { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
    { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
    { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};

const qa = (order: number): any => ({ StableUid: `q${order}`, OrderInDeck: order, Difficulty: 1, Question: `Q${order}`, Revision: 1 });
const mcq = (order: number): any => ({ StableUid: `m${order}`, OrderInDeck: order, Difficulty: 2, Question: `MCQ ${order}`, Revision: 1, Mcq: MCQ_BLOB });
const deckOf = (cards: any[]): any => ({ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: cards.length, Cards: cards });

const fresh = (uid: string): CardProgress => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const due = (uid: string): CardProgress => ({ stableUid: uid, stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: YESTERDAY_MS, lastSeenRevision: 1 });
const later = (uid: string): CardProgress => ({ stableUid: uid, stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 });
const updated = (uid: string): CardProgress => later(uid);

// Every Q/A new card (OrderInDeck 10..50) sorts before every MCQ new card (1540..1560) — the
// ordering problem this issue exists for.
const baseCards = [qa(10), qa(20), qa(30), qa(40), qa(50), mcq(1540), mcq(1550), mcq(1560)];
const baseFresh: CardProgress[] = baseCards.map((c) => fresh(c.StableUid));
const baseDeck = deckOf(baseCards);
const baseUids = baseCards.map((c) => c.StableUid);

const ALLOW_PREFER: McqKindHint = { mcqAllowed: true, preferMcq: true };
const ALLOW_QA: McqKindHint = { mcqAllowed: true, preferMcq: false };
const BLOCK: McqKindHint = { mcqAllowed: false, preferMcq: false };
const MALFORMED: McqKindHint = { mcqAllowed: false, preferMcq: true };

const uidOf = (result: { card: { StableUid: string } } | null) => result?.card.StableUid ?? null;

// mockClear() on a vi.fn(impl) spy drops the implementation in vitest 4, so clear only the
// recorded calls and keep the pass-through implementation intact.
beforeEach(() => {
  vi.mocked(pickNextCard).mock.calls.length = 0;
});

describe('planner kindHint', () => {
  it('is a no-op without a hint', () => {
    const specArb = fc.record({
      order: fc.integer({ min: 1, max: 2000 }),
      mcqChoice: fc.constantFrom('absent', 'blob', 'garbage'),
      revision: fc.constantFrom(1, 2),
      progressKind: fc.constantFrom('fresh', 'due', 'later', 'updated'),
      owned: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.record({
          specs: fc.array(specArb, { minLength: 0, maxLength: 12 }),
          mode: fc.constantFrom('review-due', 'learn-new', 'mixed', 'sweep'),
          avoidIdx: fc.option(fc.nat({ max: 11 }), { nil: null }),
          useOwned: fc.boolean(),
        }),
        ({ specs, mode, avoidIdx, useOwned }) => {
          // Unique OrderInDeck: keep the first spec per order.
          const seen = new Set<number>();
          const deduped = specs.filter((s) => (seen.has(s.order) ? false : (seen.add(s.order), true)));
          const cards = deduped.map((s) => {
            const c: any = { StableUid: `c${s.order}`, OrderInDeck: s.order, Difficulty: 1, Question: `Q${s.order}`, Revision: s.revision };
            if (s.mcqChoice === 'blob') c.Mcq = MCQ_BLOB;
            else if (s.mcqChoice === 'garbage') c.Mcq = { v: 2 };
            return c;
          });
          const progress: CardProgress[] = deduped.map((s) => {
            const uid = `c${s.order}`;
            if (s.progressKind === 'fresh') return fresh(uid);
            if (s.progressKind === 'due') return due(uid);
            return later(uid);
          });
          const uids = cards.map((c) => c.StableUid);
          const avoidUid = avoidIdx === null || uids.length === 0 ? null : uids[avoidIdx % uids.length];
          const ownedSet = !useOwned
            ? null
            : new Set(deduped.filter((s) => s.owned).map((s) => `c${s.order}`));
          const base = { deck: deckOf(cards), progress, now: NOW, mode, avoidUid, index: null, ownedSet };

          const noKey = pickNextCard(base as any);
          const nullHint = pickNextCard({ ...base, kindHint: null } as any);
          const undefHint = pickNextCard({ ...base, kindHint: undefined } as any);
          expect(nullHint).toEqual(noKey);
          expect(undefHint).toEqual(noKey);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keeps the due → updated → new bucket order under a hint', () => {
    const q5 = qa(5);
    const q6 = { ...qa(6), Revision: 2 };
    const cards = [...baseCards, q5, q6];
    const deck = deckOf(cards);
    const call = (rows: CardProgress[], kindHint: McqKindHint) =>
      uidOf(pickNextCard({ deck, progress: rows, now: NOW, mode: 'mixed', index: null, ownedSet: null, kindHint }));

    const dueUpdated = [...baseFresh, due('q5'), updated('q6')];
    const laterUpdated = [...baseFresh, later('q5'), updated('q6')];
    // q6 caught up to its revision (lastSeenRevision 2) so the updated bucket is empty too.
    const bothLater = [...baseFresh, later('q5'), { ...later('q6'), lastSeenRevision: 2 }];

    expect(call(dueUpdated, ALLOW_PREFER)).toBe('q5');
    expect(call(laterUpdated, ALLOW_PREFER)).toBe('q6');
    expect(call(bothLater, ALLOW_PREFER)).toBe('m1540');

    expect(call(dueUpdated, BLOCK)).toBe('q5');
    expect(call(laterUpdated, BLOCK)).toBe('q6');
    expect(call(bothLater, BLOCK)).toBe('q10');
  });

  it('keeps the owns guard under a hint', () => {
    const learn = (ownedSet: Set<string> | null) =>
      uidOf(pickNextCard({ deck: baseDeck, progress: baseFresh, now: NOW, mode: 'learn-new', index: null, ownedSet, kindHint: ALLOW_PREFER }));

    expect(learn(new Set(['q10', 'm1550']))).toBe('m1550');
    expect(learn(new Set(['q20']))).toBe('q20');
    expect(learn(new Set())).toBeNull();

    fc.assert(
      fc.property(
        fc.record({
          ownedSubset: fc.subarray(baseUids),
          useOwned: fc.boolean(),
          hint: fc.record({ mcqAllowed: fc.boolean(), preferMcq: fc.boolean() }),
          mode: fc.constantFrom('learn-new', 'mixed'),
        }),
        ({ ownedSubset, useOwned, hint, mode }) => {
          const ownedSet = useOwned ? new Set(ownedSubset) : null;
          const result = pickNextCard({ deck: baseDeck, progress: baseFresh, now: NOW, mode, index: null, ownedSet, kindHint: hint });
          if (result === null || ownedSet === null) return true;
          return ownedSet.has(result.card.StableUid);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never deals an MCQ new card when mcqAllowed is false', () => {
    const call = (rows: CardProgress[], mode: any, kindHint?: McqKindHint) =>
      uidOf(pickNextCard({ deck: baseDeck, progress: rows, now: NOW, mode, index: null, ownedSet: null, kindHint }));

    expect(call(baseFresh, 'learn-new', BLOCK)).toBe('q10');
    expect(call(baseFresh, 'mixed', BLOCK)).toBe('q10');

    // Only MCQ new cards remain (every Q/A card learned + not due).
    const qaLater = baseCards.map((c) => (c.StableUid.startsWith('q') ? later(c.StableUid) : fresh(c.StableUid)));
    expect(call(qaLater, 'learn-new', BLOCK)).toBeNull();
    expect(call(qaLater, 'mixed', BLOCK)).toBeNull();

    // A malformed hint (never produced by buildKindHint) still filters — mcqAllowed is checked first.
    expect(call(baseFresh, 'learn-new', MALFORMED)).toBe('q10');
    expect(call(baseFresh, 'mixed', MALFORMED)).toBe('q10');
    expect(call(qaLater, 'learn-new', MALFORMED)).toBeNull();
    expect(call(qaLater, 'mixed', MALFORMED)).toBeNull();

    // Without a hint the same rows deal the MCQ new card — the filter is visibly the hint's doing.
    expect(call(qaLater, 'learn-new')).toBe('m1540');
    expect(call(qaLater, 'mixed')).toBe('m1540');
  });

  it('prefers an MCQ new card that sorts after every Q/A card', () => {
    const call = (rows: CardProgress[], mode: any, avoidUid: string | null = null) =>
      uidOf(pickNextCard({ deck: baseDeck, progress: rows, now: NOW, mode, avoidUid, index: null, ownedSet: null, kindHint: ALLOW_PREFER }));

    expect(call(baseFresh, 'learn-new')).toBe('m1540');
    expect(call(baseFresh, 'mixed')).toBe('m1540');
    expect(call(baseFresh, 'learn-new', 'm1540')).toBe('m1550');

    // Every MCQ card learned + not due: preference finds nothing, the plain scan falls back to Q/A.
    const mcqLater = baseCards.map((c) => (c.StableUid.startsWith('m') ? later(c.StableUid) : fresh(c.StableUid)));
    expect(call(mcqLater, 'learn-new')).toBe('q10');
  });

  it('alternates back to Q/A and falls back to MCQ', () => {
    const call = (rows: CardProgress[], mode: any) =>
      uidOf(pickNextCard({ deck: baseDeck, progress: rows, now: NOW, mode, index: null, ownedSet: null, kindHint: ALLOW_QA }));

    expect(call(baseFresh, 'learn-new')).toBe('q10');
    expect(call(baseFresh, 'mixed')).toBe('q10');

    // No non-MCQ new card left: allowed, merely not preferred, so the fallback deals the MCQ card.
    const qaLater = baseCards.map((c) => (c.StableUid.startsWith('q') ? later(c.StableUid) : fresh(c.StableUid)));
    expect(call(qaLater, 'learn-new')).toBe('m1540');
    expect(call(qaLater, 'mixed')).toBe('m1540');
  });

  it('ignores the hint in review-due and sweep', () => {
    // A due MCQ card is dealt when due, never deferred (mode review-due ignores the hint).
    const dueMcqCards = [...baseCards, mcq(1)];
    const dueMcqRows = [...baseFresh, due('m1')];
    expect(uidOf(pickNextCard({ deck: deckOf(dueMcqCards), progress: dueMcqRows, now: NOW, mode: 'review-due', index: null, ownedSet: null, kindHint: BLOCK }))).toBe('m1');

    // A due Q/A card sorts ahead of a due MCQ card: deck order wins, ALLOW_PREFER does not reorder the due bucket.
    const bothDueCards = [...baseCards, mcq(1600), qa(2)];
    const bothDueRows = [...baseFresh, due('m1600'), due('q2')];
    expect(uidOf(pickNextCard({ deck: deckOf(bothDueCards), progress: bothDueRows, now: NOW, mode: 'review-due', index: null, ownedSet: null, kindHint: ALLOW_PREFER }))).toBe('q2');

    // Sweep ranks by longest-unseen, kind ignored.
    const sweepCards = [mcq(1), qa(2)];
    const sweepRows: CardProgress[] = [
      { stableUid: 'm1', stage: 2, lastReviewedAt: TODAY_MS - 5000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
      { stableUid: 'q2', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
    ];
    expect(uidOf(pickNextCard({ deck: deckOf(sweepCards), progress: sweepRows, now: NOW, mode: 'sweep', index: null, ownedSet: null, kindHint: BLOCK }))).toBe('m1');
  });

  it('buildRatedSessionState forwards the hint', () => {
    const cardIndex = { cards: baseCards, cardMap: new Map(baseCards.map((c) => [c.StableUid, c])) };
    const current = { card: qa(10), progress: fresh('q10') } as any;
    const common = {
      current,
      rating: 'good' as const,
      mode: 'mixed' as const,
      sessionDone: 0,
      sessionLimit: 5,
      now: NOW,
      cardIndex: cardIndex as any,
      ownedSet: null,
    };

    const prefer = buildRatedSessionState({ ...common, progress: baseFresh, kindHint: ALLOW_PREFER });
    expect(vi.mocked(pickNextCard).mock.calls.at(-1)?.[0]).toMatchObject({ kindHint: ALLOW_PREFER, avoidUid: 'q10', mode: 'mixed' });
    expect(prefer.nextCurrent?.card.StableUid).toBe('m1540');
    expect(prefer.nextDone).toBe(1);

    const noHint = buildRatedSessionState({ ...common, progress: baseFresh });
    expect(vi.mocked(pickNextCard).mock.calls.at(-1)?.[0]).toMatchObject({ kindHint: null });
    expect(noHint.nextCurrent?.card.StableUid).toBe('q20');

    const qaLater: CardProgress[] = [
      fresh('q10'),
      later('q20'),
      later('q30'),
      later('q40'),
      later('q50'),
      fresh('m1540'),
      fresh('m1550'),
      fresh('m1560'),
    ];
    const blocked = buildRatedSessionState({ ...common, progress: qaLater, kindHint: BLOCK });
    expect(blocked.nextCurrent).toBeNull();
    expect(blocked.updatedOne.stableUid).toBe('q10');
    expect(blocked.nextDone).toBe(1);
    expect(blocked.remainingDueCount).toBe(0);
  });
});

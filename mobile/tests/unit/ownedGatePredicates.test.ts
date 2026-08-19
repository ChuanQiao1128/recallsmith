import { describe, expect, it } from 'vitest';
import {
  countDueToday,
  countNewAvailable,
  pickNextCard,
  planChallengeRoute,
} from '../../src/features/gacha/planner/sessionPlanner';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { buildUpcoming } from '../../src/features/gacha/selectors/progressSelectors';
import {
  buildLibraryCardRows,
  buildLibraryVM,
  countUpdatedCards,
} from '../../src/features/gacha/library/libraryMapper';

/**
 * The gate fixture. Every predicate the gate touches gets an owned card and an
 * unowned twin, and the unowned twin always sorts FIRST: order-in-deck is the
 * tie-breaker every picker uses, so "unowned first" is the only arrangement in
 * which a missing owned-check is visible in the answer rather than hidden
 * behind a card that happened to be picked anyway.
 *
 * `u-due` is deliberately impossible under the app's own effective-owned rule
 * (resolveEffectiveOwned unions owned with everything already studied, so a
 * studied card is always owned). It exists because these are pure functions:
 * their contract is "ownedSet is authoritative", and a caller that hands them a
 * raw owned set -- a future one, or a buggy one -- must not leak study entry
 * points. Keeping the impossible case in the fixture is what makes the due and
 * updated gates testable at all.
 */
const NOW = new Date('2026-04-23T12:00:00.000Z');
const TODAY_MS = NOW.getTime();
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000;
const YESTERDAY_MS = TODAY_MS - 24 * 60 * 60 * 1000;

const gateDeck = {
  Slug: 'gate-deck',
  Title: 'Gate Deck',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 7,
  Cards: [
    { StableUid: 'u-due', OrderInDeck: 1, Difficulty: 1, Question: 'Unowned due', Revision: 1 },
    { StableUid: 'u-upd', OrderInDeck: 2, Difficulty: 2, Question: 'Unowned updated', Revision: 2 },
    { StableUid: 'u-new', OrderInDeck: 3, Difficulty: 3, Question: 'Unowned new', Revision: 1 },
    { StableUid: 'o-due', OrderInDeck: 4, Difficulty: 1, Question: 'Owned due', Revision: 1 },
    { StableUid: 'o-upd', OrderInDeck: 5, Difficulty: 2, Question: 'Owned updated', Revision: 2 },
    { StableUid: 'o-new', OrderInDeck: 6, Difficulty: 1, Question: 'Owned new', Revision: 1 },
    { StableUid: 'o-mas', OrderInDeck: 7, Difficulty: 2, Question: 'Owned mastered', Revision: 1 },
  ],
} as any;

const learned = (stableUid: string, stage: number, nextReviewAt: number) => ({
  stableUid,
  stage,
  lastReviewedAt: TODAY_MS - 1000,
  nextReviewAt,
  lastSeenRevision: 1,
});

const gateProgress = [
  learned('u-due', 2, YESTERDAY_MS),
  learned('u-upd', 2, TOMORROW_MS),
  { stableUid: 'u-new', stage: 0, nextReviewAt: 0 },
  learned('o-due', 2, YESTERDAY_MS),
  learned('o-upd', 2, TOMORROW_MS),
  { stableUid: 'o-new', stage: 0, nextReviewAt: 0 },
  learned('o-mas', 4, TOMORROW_MS),
] as any;

// buildRatedSessionState reaches pickNextCard only through `cardIndex` -- it
// never takes a deck -- so the index has to be prebuilt the way the session
// screen prebuilds it.
const gateCardIndex = {
  cards: [...gateDeck.Cards].sort((a: any, b: any) => a.OrderInDeck - b.OrderInDeck),
  cardMap: new Map<string, any>(gateDeck.Cards.map((card: any) => [card.StableUid, card])),
};

// Same deck, nothing due: the only way to reach pickUpdated, which mixed mode
// runs strictly after pickDue comes back empty.
const noDueProgress = [
  learned('u-due', 2, TOMORROW_MS),
  learned('u-upd', 2, TOMORROW_MS),
  { stableUid: 'u-new', stage: 0, nextReviewAt: 0 },
  learned('o-due', 2, TOMORROW_MS),
  learned('o-upd', 2, TOMORROW_MS),
  { stableUid: 'o-new', stage: 0, nextReviewAt: 0 },
  learned('o-mas', 4, TOMORROW_MS),
] as any;

const OWNED = new Set(['o-due', 'o-upd', 'o-new', 'o-mas']);

describe('owned gate — characterization (no ownedSet passed = ungated)', () => {
  it('counts every due and every new card in the deck', () => {
    expect(countDueToday(gateProgress, NOW)).toBe(2);
    expect(countNewAvailable(gateProgress)).toBe(2);
  });

  it('plans a route off whole-deck counts', () => {
    const planned = planChallengeRoute({ deck: gateDeck, progress: gateProgress, now: NOW });

    expect(planned.dueCount).toBe(2);
    expect(planned.newCount).toBe(2);
    expect(planned.limit).toBe(3);
  });

  it('fills the calendar from every scheduled card in the deck', () => {
    // Home reads today's number off this array rather than off countDueToday,
    // so the calendar is a study-pressure surface in its own right.
    expect(buildUpcoming(gateProgress, NOW, 30)[0].count).toBe(2);
  });

  it('picks the first card in deck order that matches the mode, owned or not', () => {
    expect(
      pickNextCard({ deck: gateDeck, progress: gateProgress, now: NOW, mode: 'review-due' })?.card.StableUid,
    ).toBe('u-due');
    expect(
      pickNextCard({ deck: gateDeck, progress: gateProgress, now: NOW, mode: 'learn-new' })?.card.StableUid,
    ).toBe('u-new');
    expect(
      pickNextCard({ deck: gateDeck, progress: noDueProgress, now: NOW, mode: 'mixed' })?.card.StableUid,
    ).toBe('u-upd');
  });

  it('hands the next card and the remaining-due count back from a rating', () => {
    const state = buildRatedSessionState({
      current: { card: gateDeck.Cards[3], progress: gateProgress[3] },
      progress: gateProgress,
      rating: 'good',
      mode: 'mixed',
      sessionDone: 0,
      sessionLimit: 5,
      now: NOW,
      cardIndex: gateCardIndex,
    });

    expect(state.nextCurrent?.card.StableUid).toBe('u-due');
    expect(state.remainingDueCount).toBe(1);
  });

  it('labels every unstudied card Missing and counts the whole deck', () => {
    const rows = buildLibraryCardRows({ deck: gateDeck, progress: gateProgress, now: NOW });

    expect(rows.map((row) => row.status)).toEqual([
      'learning',
      'learning',
      'new',
      'learning',
      'learning',
      'new',
      'mastered',
    ]);
    expect(rows.map((row) => row.statusLabel)).toEqual([
      'Learning',
      'Learning',
      'Missing',
      'Learning',
      'Learning',
      'Missing',
      'Mastered',
    ]);
    // The silhouette proxy: with no gate to consult, "unstudied" is the only
    // answer the app has ever had to "is this card in your collection".
    expect(rows.map((row) => row.isMissing)).toEqual([false, false, true, false, false, true, false]);
    expect(rows.find((row) => row.stableUid === 'u-due')?.isDueToday).toBe(true);
    expect(rows.find((row) => row.stableUid === 'u-upd')?.isUpdated).toBe(true);

    const vm = buildLibraryVM({ deck: gateDeck, progress: gateProgress, now: NOW });

    expect(vm.counts).toMatchObject({
      newCount: 2,
      learningCount: 4,
      masteredCount: 1,
      dueTodayCount: 2,
      updatedCount: 2,
    });
    // Pins the bridge LibraryScreen still walks: ungated, the new ownedCount
    // field equals the learning + mastered sum the screen computes by hand, so
    // moving the screen onto the field cannot change what today's users see.
    expect(vm.counts.ownedCount).toBe(vm.counts.learningCount + vm.counts.masteredCount);
    expect(vm.counts.ownedCount).toBe(5);
    expect(vm.filters.find((chip) => chip.key === 'new')?.count).toBe(2);
  });

  it('filters the New chip down to every unstudied card in the deck', () => {
    const vm = buildLibraryVM({ deck: gateDeck, progress: gateProgress, now: NOW, filter: 'new' });

    expect(vm.cards.map((row) => row.stableUid)).toEqual(['u-new', 'o-new']);
  });
});

/**
 * The flip. Same fixture, same clock, an ownedSet passed in -- and every
 * assertion above that named a `u-` card now names its `o-` twin. Each test
 * below records the ungated number it replaces and why the new one is right.
 */
describe('owned gate — flipped (ownedSet passed)', () => {
  it('counts only owned due and owned new cards', () => {
    // Was 2 due / 2 new (whole deck). Now 1 / 1: u-due and u-new were never
    // drawn, and a count is a promise that there is something to study.
    expect(countDueToday(gateProgress, NOW, OWNED)).toBe(1);
    expect(countNewAvailable(gateProgress, OWNED)).toBe(1);
  });

  it('drops an unowned scheduled card out of the calendar', () => {
    // Was 2. Only reachable with a raw owned set like this fixture's: under
    // resolveEffectiveOwned a scheduled card is always grandfathered, so the
    // shipping callers cannot produce this input today. The test is here
    // because the parameter is here -- a gate nothing exercises is a gate
    // nobody can trust the day the union rule narrows.
    expect(buildUpcoming(gateProgress, NOW, 30, OWNED)[0].count).toBe(1);
  });

  it('plans a shorter route because the deck is no longer the pool', () => {
    const planned = planChallengeRoute({ deck: gateDeck, progress: gateProgress, now: NOW, ownedSet: OWNED });

    // Was dueCount 2 / newCount 2 / limit 3. The route is built from the two
    // counts above, so it shortens with them: a route node the gate will not
    // let you fill is a session that ends with an unexplained empty screen.
    expect(planned.dueCount).toBe(1);
    expect(planned.newCount).toBe(1);
    expect(planned.limit).toBe(2);
  });

  // --- one test per pickWith predicate; each dies alone if its owns() goes ---

  it('skips the unowned due card in review-due mode', () => {
    // Was 'u-due' (first in deck order). Now 'o-due'.
    expect(
      pickNextCard({ deck: gateDeck, progress: gateProgress, now: NOW, mode: 'review-due', ownedSet: OWNED })?.card
        .StableUid,
    ).toBe('o-due');
  });

  it('skips the unowned new card in learn-new mode', () => {
    // Was 'u-new'. Now 'o-new'.
    expect(
      pickNextCard({ deck: gateDeck, progress: gateProgress, now: NOW, mode: 'learn-new', ownedSet: OWNED })?.card
        .StableUid,
    ).toBe('o-new');
  });

  it('skips the unowned updated card in mixed mode once nothing is due', () => {
    // Was 'u-upd'. Now 'o-upd'. noDueProgress is what makes pickUpdated
    // reachable at all -- mixed mode only falls through to it when pickDue
    // comes back empty.
    expect(
      pickNextCard({ deck: gateDeck, progress: noDueProgress, now: NOW, mode: 'mixed', ownedSet: OWNED })?.card
        .StableUid,
    ).toBe('o-upd');
  });

  it('carries the gate through both of the rating pass-throughs', () => {
    const state = buildRatedSessionState({
      current: { card: gateDeck.Cards[3], progress: gateProgress[3] },
      progress: gateProgress,
      rating: 'good',
      mode: 'mixed',
      sessionDone: 0,
      sessionLimit: 5,
      now: NOW,
      cardIndex: gateCardIndex,
      ownedSet: OWNED,
    });

    // Was nextCurrent 'u-due' / remainingDueCount 1. Rating o-due reschedules
    // it out of today, and the only other due card is unowned -- so the run
    // moves on to the owned updated card and reports a cleared day. Two
    // separate pass-throughs (pickNextCard, countDueToday) are being pinned
    // here; dropping either one alone still turns this red.
    expect(state.nextCurrent?.card.StableUid).toBe('o-upd');
    expect(state.remainingDueCount).toBe(0);
    // The saved array stays whole. The gate is a read-time predicate, never a
    // filter on what gets persisted -- filtering here is how learned progress
    // gets silently reset by the next write.
    expect(state.updatedProgress).toHaveLength(gateProgress.length);
    expect(state.updatedProgress.map((row) => row.stableUid)).toEqual(gateProgress.map((row: any) => row.stableUid));
  });

  it('calls unowned cards Missing and owned-but-unstudied cards New', () => {
    const rows = buildLibraryCardRows({ deck: gateDeck, progress: gateProgress, now: NOW, ownedSet: OWNED });

    // Was ['learning','learning','new','learning','learning','new','mastered'].
    // 'missing' now outranks SRS state for the three unowned cards, including
    // the two the old mapper called Learning.
    expect(rows.map((row) => row.status)).toEqual([
      'missing',
      'missing',
      'missing',
      'learning',
      'learning',
      'new',
      'mastered',
    ]);
    // Was [...,'Missing',...,'Missing',...] for the two unstudied cards. The
    // mislabel the gate fixes is o-new: drawn, not studied, and until now
    // presented as a card the user did not have.
    expect(rows.map((row) => row.statusLabel)).toEqual([
      'Missing',
      'Missing',
      'Missing',
      'Learning',
      'Learning',
      'New',
      'Mastered',
    ]);
    // Was [false,false,true,false,false,true,false] — the proxy exactly
    // inverted for the drawn card and the two studied-but-unowned ones.
    expect(rows.map((row) => row.isMissing)).toEqual([true, true, true, false, false, false, false]);
    // Both were true. A card outside the collection cannot be due or updated:
    // both badges are invitations to open something the gate keeps shut.
    expect(rows.find((row) => row.stableUid === 'u-due')?.isDueToday).toBe(false);
    expect(rows.find((row) => row.stableUid === 'u-upd')?.isUpdated).toBe(false);
  });

  it('counts the collection, not the catalogue', () => {
    const vm = buildLibraryVM({ deck: gateDeck, progress: gateProgress, now: NOW, ownedSet: OWNED });

    // Was 2 / 4 / 1 / 2 / 2 and ownedCount 5.
    expect(vm.counts).toMatchObject({
      newCount: 1,
      learningCount: 2,
      masteredCount: 1,
      dueTodayCount: 1,
      updatedCount: 1,
      ownedCount: 4,
    });
    // The chip must agree with the list it filters, or the Library shows "New 2"
    // above one row.
    expect(vm.filters.find((chip) => chip.key === 'new')?.count).toBe(1);
  });

  it('keeps unowned cards in the grid so the Pokedex still has silhouettes', () => {
    const all = buildLibraryVM({ deck: gateDeck, progress: gateProgress, now: NOW, ownedSet: OWNED, filter: 'all' });
    const newOnly = buildLibraryVM({ deck: gateDeck, progress: gateProgress, now: NOW, ownedSet: OWNED, filter: 'new' });

    // 'all' is unchanged at 7 rows: the gate decides what you may study, not
    // what you may see. Collecting is the point of the screen.
    expect(all.cards).toHaveLength(7);
    expect(all.filters.find((chip) => chip.key === 'all')?.count).toBe(7);
    // Was ['u-new','o-new'].
    expect(newOnly.cards.map((row) => row.stableUid)).toEqual(['o-new']);
  });

  it('drops unowned cards from the updated-content count', () => {
    // Was 2 (u-upd and o-upd both carry Revision 2 against lastSeenRevision 1).
    expect(countUpdatedCards(gateDeck.Cards, gateProgress, OWNED)).toBe(1);
    expect(countUpdatedCards(gateDeck.Cards, gateProgress)).toBe(2);
  });

  it('treats the set as authoritative even for a card the user has studied', () => {
    // The contract worth stating out loud: these functions do not second-guess
    // the set. u-due has weeks of history and is due right now, and passing a
    // set without it hides it everywhere at once. That is why callers pass
    // resolveEffectiveOwned (owned ∪ studied) and never a raw owned set -- the
    // grandfather rule lives in the caller, deliberately, so there is exactly
    // one place to read it.
    const rawOwned = new Set(['o-due']);

    expect(countDueToday(gateProgress, NOW, rawOwned)).toBe(1);
    expect(
      pickNextCard({ deck: gateDeck, progress: gateProgress, now: NOW, mode: 'review-due', ownedSet: rawOwned })?.card
        .StableUid,
    ).toBe('o-due');
  });
});

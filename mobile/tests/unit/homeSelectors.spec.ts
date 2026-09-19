import { describe, expect, it } from 'vitest';
import {
  buildHomeScreenVM,
  buildHomeVM,
  type HomeCtaKind,
} from '../../src/features/gacha/selectors/homeSelectors';
import type { DeckSummary } from '../../src/features/gacha/contracts';

function makeDeck(overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    slug: 'csharp',
    title: 'C# Interview',
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 50,
    localCards: 50,
    studyCards: 50,
    canStudy: true,
    dueToday: 3,
    plannedToday: 3,
    newToday: 2,
    masteredApprox: 8,
    percent: 0.16,
    ...overrides,
  };
}

describe('buildHomeVM CTA kinds', () => {
  const allKinds: HomeCtaKind[] = [
    'first_run',
    'today_pending',
    'today_partial',
    'today_done',
    'today_full_clear',
    'due_only',
    'nothing_to_learn',
    'wallet_full',
    'error',
  ];

  it.each(allKinds)('supports status kind %s', (kind) => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck()],
      statusHint: kind,
      errorMessage: kind === 'error' ? 'boom' : null,
      wallet:
        kind === 'wallet_full'
          ? { availablePulls: 30, reservePulls: 5 }
          : { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.cta.kind).toBe(kind);
    expect(vm.cta.testID).toBe('home-primary-cta');
    expect(vm.hero.headline.length).toBeGreaterThan(0);
    expect(vm.hero.subline.length).toBeGreaterThan(0);
  });

  it('keeps challenge CTA for pending work by default', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 3, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.cta.kind).toBe('today_pending');
    expect(vm.cta.label).toBe('Start today’s challenge');
    expect(vm.hero.ctaAction).toBe('challenge');
  });

  it('derives today_partial from runtime session progress without statusHint', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 4, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
      runtimeStatus: {
        qualifiedToday: false,
        completedToday: 1,
        completedRouteToday: false,
      },
    });

    expect(vm.cta.kind).toBe('today_partial');
    expect(vm.cta.label).toBe('Continue today’s challenge');
    expect(vm.cta.nav).toBe('challenge');
  });

  // Rewritten, not adjusted. The old case asserted that a wallet with pulls
  // in it takes the primary button away from study on a day that still has
  // cards waiting. That was the behaviour under test agreeing with itself:
  // the reward exists because study happened, so it cannot be the app's
  // answer to why the user opened it today.
  it('keeps the challenge CTA for today_done even when pulls are available', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 2, newToday: 1 })],
      wallet: { availablePulls: 1, reservePulls: 0 },
      runtimeStatus: {
        qualifiedToday: true,
        completedToday: 1,
        completedRouteToday: false,
      },
    });

    expect(vm.cta.kind).toBe('today_done');
    expect(vm.cta.label).toBe('Continue today’s challenge');
    expect(vm.cta.nav).toBe('challenge');
  });

  it('keeps the primary CTA on study when cards are due and the wallet has pulls', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 4, newToday: 0 })],
      wallet: { availablePulls: 3, reservePulls: 0 },
    });

    expect(vm.cta.kind).toBe('due_only');
    expect(vm.cta.nav).toBe('challenge');
    expect(vm.cta.label).toBe('Clear due reviews');
    // The pulls are still announced, just not from the primary button.
    expect(vm.draw.state).toBe('available');
  });

  it('keeps the primary CTA on study when the wallet is full and work remains', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 2, newToday: 1 })],
      wallet: { availablePulls: 30, reservePulls: 5 },
    });

    expect(vm.cta.kind).toBe('wallet_full');
    expect(vm.cta.nav).toBe('challenge');
    expect(vm.draw.state).toBe('wallet-full');
  });

  it('never names a deck in a CTA that opens the draw chamber', () => {
    const drawVms = [
      buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
        wallet: { availablePulls: 2, reservePulls: 0 },
        runtimeStatus: { qualifiedToday: true, completedToday: 2, completedRouteToday: true },
      }),
      buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
        wallet: { availablePulls: 2, reservePulls: 0 },
      }),
    ];

    for (const vm of drawVms) {
      expect(vm.cta.nav).toBe('draw');
      expect(vm.cta.label).toBe('Open reward draw');
      expect(vm.cta.label).not.toContain('C# Interview');
    }
  });

  it('keeps challenge CTA for today_done when pulls are locked', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 2, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
      runtimeStatus: {
        qualifiedToday: true,
        completedToday: 1,
        completedRouteToday: false,
      },
    });

    expect(vm.cta.kind).toBe('today_done');
    expect(vm.cta.label).toBe('Continue today’s challenge');
    expect(vm.cta.nav).toBe('challenge');
  });

  it('derives today_full_clear with draw CTA when pulls are available', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 2, reservePulls: 0 },
      runtimeStatus: {
        qualifiedToday: true,
        completedToday: 2,
        completedRouteToday: true,
      },
    });

    expect(vm.cta.kind).toBe('today_full_clear');
    expect(vm.cta.label).toBe('Open reward draw');
    expect(vm.cta.nav).toBe('draw');
  });

  it('falls back to library CTA for today_full_clear when pulls are locked', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
      runtimeStatus: {
        qualifiedToday: true,
        completedToday: 2,
        completedRouteToday: true,
      },
    });

    expect(vm.cta.kind).toBe('today_full_clear');
    expect(vm.cta.label).toBe('Open library');
    expect(vm.cta.nav).toBe('library');
  });

  it('keeps library CTA when there is no work', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.cta.kind).toBe('nothing_to_learn');
    expect(vm.hero.ctaLabel).toBe('Open library');
    expect(vm.hero.ctaAction).toBe('deck');
  });

  it('maps wallet-full draw badge state', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 30, reservePulls: 5 },
    });

    expect(vm.draw.state).toBe('wallet-full');
    expect(vm.draw.label).toMatch(/Wallet full/i);
  });

  it('keeps a usable primary CTA when no deck is available', () => {
    const vm = buildHomeVM({
      selectedSlug: null,
      hasSignedInUser: false,
      deckSummaries: [],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.cta.kind).toBe('first_run');
    expect(vm.cta.label).toBe('Open library');
    expect(vm.cta.nav).toBe('library');
    expect(vm.cta.disabled).toBe(false);
  });

  it('preserves retry CTA when Home refresh fails before deck data is available', () => {
    const vm = buildHomeScreenVM({
      state: 'error',
      hasSignedInUser: false,
      wallet: { availablePulls: 0, reservePulls: 0 },
      message: 'boom',
    });

    expect(vm.cta.kind).toBe('error');
    expect(vm.cta.label).toBe('Try again');
    expect(vm.cta.nav).toBe('retry');
    expect(vm.hero.headline).toBe('Could not refresh Home right now');
  });

  it('builds the empty Home VM through the screen VM helper', () => {
    const vm = buildHomeScreenVM({ state: 'empty' });

    expect(vm.cta.kind).toBe('first_run');
    expect(vm.cta.label).toBe('Open library');
    expect(vm.selectedDeckSlug).toBeNull();
  });
});

describe('Home copy glossary', () => {
  it('hero subline no longer names route roles', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 3, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.hero.subline).toBe(
      'Review today’s cards to earn pulls · at most 5 cards.',
    );
    expect(vm.hero.subline).not.toMatch(/normal|elite|boss|pressure|route|node/i);
  });

  it('hero subline for a clear day drops the pressure wording', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
      statusHint: 'today_pending',
    });

    expect(vm.hero.subline).toBe('Nothing due today; review later or browse your decks.');
  });

  it('draw badge speaks in pulls, not reserve', () => {
    const onePull = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck()],
      wallet: { availablePulls: 1, reservePulls: 2 },
    });
    const twoPulls = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck()],
      wallet: { availablePulls: 2, reservePulls: 3 },
    });
    const locked = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck()],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(onePull.draw.label).toBe('1 pull ready · 2 more waiting');
    expect(twoPulls.draw.label).toBe('2 pulls ready · 3 more waiting');
    expect(locked.draw.label).toBe('Review today’s cards to earn a pull');
  });

  it('deck rows say new, not fresh', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 3, newToday: 2 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows[0].progressLabel).toBe('3 due · 2 new');
  });
});

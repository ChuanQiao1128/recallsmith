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

  it('derives today_done from runtime streak-qualified signal without statusHint', () => {
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
    expect(vm.cta.label).toBe('Minimum goal reached');
    expect(vm.cta.nav).toBe('draw');
  });

  it('derives today_full_clear from runtime completion signal without statusHint', () => {
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
    expect(vm.cta.label).toBe('Full clear completed');
    expect(vm.cta.nav).toBe('draw');
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

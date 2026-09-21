import { describe, expect, it } from 'vitest';
import {
  buildHomeScreenVM,
  buildHomeVM,
  EMPTY_DECK_CTA_LABEL,
  ownedCountOf,
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
    'empty_deck',
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
          ? { availablePulls: 60, reservePulls: 5 }
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
      wallet: { availablePulls: 60, reservePulls: 5 },
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
      wallet: { availablePulls: 60, reservePulls: 5 },
    });

    expect(vm.draw.state).toBe('wallet-full');
    expect(vm.draw.label).toMatch(/Wallet full/i);
  });

  describe('empty deck (installed, nothing owned)', () => {
    // Owner's device, 2026-09-21: a fresh CCDV-F install with 0 owned / 0 due
    // / 0 new previewed "Warm-up node 0/1" and the primary button offered the
    // library. There is exactly one next step for that deck: open a pack.
    const emptyDeck = () => makeDeck({ dueToday: 0, newToday: 0, masteredApprox: 0, masteredCount: 0, ownedCount: 0, percent: 0 });

    it('reads the owned count from the field, falling back to learned + fresh', () => {
      expect(ownedCountOf(makeDeck({ ownedCount: 3 }))).toBe(3);
      expect(ownedCountOf(makeDeck({ masteredApprox: 8, newToday: 2 }))).toBe(10);
      expect(ownedCountOf(makeDeck({ masteredApprox: 0, newToday: 0 }))).toBe(0);
      expect(ownedCountOf(makeDeck({ ownedCount: Number.NaN, masteredApprox: 1, newToday: 1 }))).toBe(2);
    });

    it('sends the primary CTA to the draw with the first-cards label, even with a locked wallet', () => {
      for (const wallet of [
        { availablePulls: 0, reservePulls: 0 },
        { availablePulls: 1, reservePulls: 0 },
        { availablePulls: 60, reservePulls: 5 },
      ]) {
        const vm = buildHomeVM({ selectedSlug: 'csharp', hasSignedInUser: true, deckSummaries: [emptyDeck()], wallet });
        expect(vm.statusKind).toBe('empty_deck');
        expect(vm.cta.kind).toBe('empty_deck');
        expect(vm.cta.nav).toBe('draw');
        expect(vm.cta.label).toBe(EMPTY_DECK_CTA_LABEL);
        expect(vm.cta.label).toBe('Open a pack to get your first cards');
        expect(vm.cta.disabled).toBe(false);
      }
    });

    it('never builds a route preview and reports zero nodes', () => {
      const vm = buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [emptyDeck()],
        wallet: { availablePulls: 0, reservePulls: 0 },
      });
      expect(vm.routePreview).toEqual([]);
      expect(vm.counts.normalCount + vm.counts.eliteCount + vm.counts.bossCount).toBe(0);
      expect(vm.goal).toEqual({ minimum: 'No cards yet', fullClear: 'Open a pack to start' });
      expect(vm.hero.headline).toBe('No cards in C# Interview yet');
      expect(vm.hero.subline).toMatch(/open a pack/i);
      // Locked wallet: the badge says what the floor will do, without claiming cards are "due".
      expect(vm.draw.state).toBe('locked');
      expect(vm.draw.label).toBe('No cards yet · a free pull returns tomorrow');
      expect(vm.drawStatusLabel).toBe('No cards yet · a free pull returns tomorrow');
    });

    it('outranks runtime status: nothing can have been completed in a deck with no cards', () => {
      const vm = buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [emptyDeck()],
        wallet: { availablePulls: 2, reservePulls: 0 },
        runtimeStatus: { qualifiedToday: true, completedToday: 2, completedRouteToday: true },
      });
      expect(vm.cta.kind).toBe('empty_deck');
      expect(vm.cta.nav).toBe('draw');
    });

    it('does not fire for a caught-up deck that owns cards (nothing_to_learn keeps its CTA)', () => {
      const vm = buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [makeDeck({ dueToday: 0, newToday: 0, masteredApprox: 8 })],
        wallet: { availablePulls: 0, reservePulls: 0 },
      });
      expect(vm.cta.kind).toBe('nothing_to_learn');
      expect(vm.cta.label).toBe('Open library');
      expect(vm.routePreview).toHaveLength(1);
    });

    it('does not fire for a deck that is not studiable (first_run keeps the library)', () => {
      const vm = buildHomeVM({
        selectedSlug: 'csharp',
        hasSignedInUser: true,
        deckSummaries: [makeDeck({ canStudy: false, dueToday: 0, newToday: 0, masteredApprox: 0, ownedCount: 0 })],
        wallet: { availablePulls: 0, reservePulls: 0 },
      });
      expect(vm.cta.kind).toBe('first_run');
      expect(vm.cta.nav).toBe('library');
    });
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
      'Each new card you learn earns a pull · up to 5 cards a run.',
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
    expect(locked.draw.label).toBe('Learn a new card to earn a pull');
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

describe('Today counts: Owned tile', () => {
  it('reports the selected deck’s owned cards, never the cross-deck due sum', () => {
    const vm = buildHomeVM({
      selectedSlug: 'claude',
      hasSignedInUser: true,
      deckSummaries: [
        makeDeck({ slug: 'csharp', dueToday: 5, newToday: 0, masteredApprox: 70, ownedCount: 78 }),
        makeDeck({
          slug: 'claude',
          title: 'Claude Developer Foundations (CCDV-F)',
          totalCards: 441,
          localCards: 441,
          dueToday: 0,
          newToday: 11,
          masteredApprox: 0,
          ownedCount: 11,
        }),
      ],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    // The owner saw "0 Due 11 New 0 Learned 5 Total" here: 5 was the other deck.
    expect(vm.counts.selectedOwned).toBe(11);
    expect(vm.counts.totalDueAllDecks).toBe(5);
  });

  it('derives owned from learned + new when a summary predates ownedCount', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 3, newToday: 2, masteredApprox: 8 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.counts.selectedOwned).toBe(10);
  });

  it('reports 0 owned for a deck that is not studiable and for no deck', () => {
    const notInstalled = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ canStudy: false, localCards: 0, ownedCount: 12 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const empty = buildHomeScreenVM({ state: 'empty' });

    expect(notInstalled.counts.selectedOwned).toBe(0);
    expect(empty.counts.selectedOwned).toBe(0);
  });
});

describe('goal line', () => {
  it('names the route length the session will build, capped at the run limit', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 4, newToday: 3 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    // due 4 + new 3 = 7, but sessionBuilder caps a run at 5 and the summary
    // will say "5 / 5 · full clear"; Home used to say "Full clear: 7 cards".
    expect(vm.goal).toEqual({ minimum: 'Keep streak: 1 card', fullClear: 'Full clear: 5 cards' });
  });

  it('uses the singular for a one-card route', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.goal?.fullClear).toBe('Full clear: 1 card');
  });

  it('is absent when the selected deck has nothing due and nothing new', () => {
    const clear = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const notInstalled = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ canStudy: false, dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(clear.goal).toBeNull();
    expect(notInstalled.goal).toBeNull();
    expect(buildHomeScreenVM({ state: 'empty' }).goal).toBeNull();
  });
});

describe('deck update chip and notice', () => {
  const staleCsharp = () =>
    makeDeck({
      slug: 'csharp-basics',
      title: 'C# / .NET',
      totalCards: 115,
      localCards: 81,
      studyCards: 81,
    });
  const update = {
    'csharp-basics': {
      slug: 'csharp-basics',
      installedVersion: '20260816',
      remoteVersion: '20260921',
      hasUpdate: true,
      remoteUrl: 'https://example.test/csharp-basics.json',
      remoteSha256: null,
    },
  };

  it('labels the tile with the update and the card delta', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp-basics',
      hasSignedInUser: false,
      deckSummaries: [staleCsharp()],
      updates: update,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const row = vm.decks.rows[0];

    expect(row.actionHint).toBe('update');
    expect(row.statusLabel).toBe('Update available');
    expect(row.update).toEqual({ state: 'available', addedCards: 34, chipLabel: 'Update · +34 cards' });
    expect(vm.updateNotice).toEqual({
      slug: 'csharp-basics',
      state: 'available',
      text: 'C# / .NET update ready · +34 cards — tap the pack to install.',
    });
  });

  it('says only Update when the server build adds no cards', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp-basics',
      hasSignedInUser: false,
      deckSummaries: [makeDeck({ slug: 'csharp-basics', title: 'C# / .NET', totalCards: 81, localCards: 81 })],
      updates: update,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows[0].update?.chipLabel).toBe('Update');
    expect(vm.updateNotice?.text).toBe('C# / .NET update ready — tap the pack to install.');
  });

  it('turns into the in-flight state for a slug the auto-installer is applying', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp-basics',
      hasSignedInUser: false,
      deckSummaries: [staleCsharp()],
      updates: update,
      updatingSlugs: ['csharp-basics'],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows[0].update).toEqual({ state: 'updating', addedCards: 34, chipLabel: 'Updating…' });
    expect(vm.updateNotice).toEqual({
      slug: 'csharp-basics',
      state: 'updating',
      text: 'Updating C# / .NET · +34 cards…',
    });
  });

  it('keeps the notice on the selected deck only and the chip off current decks', () => {
    const vm = buildHomeVM({
      selectedSlug: 'aws',
      hasSignedInUser: false,
      deckSummaries: [staleCsharp(), makeDeck({ slug: 'aws', title: 'AWS Core' })],
      updates: update,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows[0].update?.state).toBe('available');
    expect(vm.decks.rows[1].update).toBeNull();
    expect(vm.updateNotice).toBeNull();
  });

  it('shows no chip for a deck that still needs installing (that is the Install state)', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp-basics',
      hasSignedInUser: false,
      deckSummaries: [makeDeck({ slug: 'csharp-basics', canStudy: false, localCards: 0 })],
      updates: {
        'csharp-basics': { ...update['csharp-basics'], installedVersion: null },
      },
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows[0].actionHint).toBe('install');
    expect(vm.decks.rows[0].update).toBeNull();
    expect(vm.updateNotice).toBeNull();
  });

  it('carries the short title on every row', () => {
    const vm = buildHomeVM({
      selectedSlug: 'aws-saa-c03',
      hasSignedInUser: false,
      deckSummaries: [
        makeDeck({ slug: 'aws-saa-c03', title: 'AWS Associate Architect' }),
        makeDeck({ slug: 'claude-ccdv-f', title: 'Claude Developer Foundations (CCDV-F)' }),
        makeDeck({ slug: 'csharp-basics', title: 'C# / .NET' }),
        makeDeck({ slug: 'js-core-basics', title: 'JavaScript Core Basics' }),
      ],
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(vm.decks.rows.map((row) => row.shortTitle)).toEqual([
      'AWS SAA-C03',
      'Claude CCDV-F',
      'C# / .NET',
      'JavaScript Core Basics',
    ]);
    expect(vm.decks.rows.map((row) => row.deck.title)[1]).toBe('Claude Developer Foundations (CCDV-F)');
  });
});

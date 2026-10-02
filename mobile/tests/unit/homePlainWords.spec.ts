// R24B W02: plain words on Home, Library and Card detail (R24B-00 §1, facts-copy §5, §8, §10, §14).
//
// Every string the Home view model can hand a learner -- hero fields (rendered or not), the primary
// button, the draw badge, the draw status line and the session preview -- uses the plain vocabulary:
// draw / saved draws / session / all due cards done, never pull / wallet / reserve / run / route /
// challenge / boss / elite / full clear. Library and Card detail hard-code their strings in the
// screen, so those are read as source text.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../../src/features/gacha/constants';
import { buildHomeVM, type HomeCtaKind } from '../../src/features/gacha/selectors/homeSelectors';
import type { DeckSummary } from '../../src/features/gacha/contracts';

const JARGON =
  /\b(pulls?|pulled|pity|wallet|reserve|run|runs|boss|elite|node|full clear|challenge|route|momentum|reward draw)\b/i;

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

const KINDS: Array<HomeCtaKind | undefined> = [
  undefined,
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
const DECKS: Array<DeckSummary | null> = [
  null,
  makeDeck(),
  makeDeck({ dueToday: 0, newToday: 4 }),
  makeDeck({ dueToday: 0, newToday: 0 }),
  makeDeck({ dueToday: 5, newToday: 0 }),
  makeDeck({ canStudy: false }),
  makeDeck({ localCards: 0, studyCards: 0, dueToday: 0, newToday: 0 }),
];
const WALLETS = [
  { availablePulls: 0, reservePulls: 0 },
  { availablePulls: 1, reservePulls: 0 },
  { availablePulls: 2, reservePulls: 3 },
  { availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP },
];

function vmFor(deck: DeckSummary | null, wallet: (typeof WALLETS)[number], statusHint?: HomeCtaKind) {
  return buildHomeVM({
    selectedSlug: deck?.slug ?? null,
    hasSignedInUser: true,
    deckSummaries: deck ? [deck] : [],
    wallet,
    statusHint,
  });
}

describe('Home view model speaks plain words (R24B W02)', () => {
  it('never hands a learner a jargon word, in any state', () => {
    for (const kind of KINDS) {
      for (const deck of DECKS) {
        for (const wallet of WALLETS) {
          const vm = vmFor(deck, wallet, kind);
          const words = [
            vm.hero.eyebrow,
            vm.hero.title,
            vm.hero.subtitle,
            vm.hero.helper,
            vm.hero.headline,
            vm.hero.subline,
            vm.hero.ctaLabel,
            vm.cta.label,
            vm.draw.label,
            vm.drawStatusLabel,
            ...vm.routePreview.flatMap((node) => [node.title, node.subtitle]),
          ];
          for (const word of words) {
            expect(String(word ?? '')).not.toMatch(JARGON);
          }
        }
      }
    }
  });

  it('names the fallback hero titles in plain words', () => {
    const empty = { availablePulls: 0, reservePulls: 0 };
    const full = { availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP };
    expect(vmFor(makeDeck({ canStudy: false }), empty).hero.title).toBe(
      'Finish setup, then start today’s session',
    );
    expect(vmFor(makeDeck({ dueToday: 0, newToday: 0 }), empty, 'today_full_clear').hero.title).toBe(
      'All due cards done',
    );
    expect(vmFor(makeDeck(), full).hero.title).toBe('Saved draws are full');
    expect(vmFor(makeDeck(), full).hero.helper).toBe(
      `${FREE_PULL_CAP} saved and ${FREE_PULL_OVERFLOW_CAP} extra draws waiting.`,
    );
  });

  it('says draw, not pull, in the draw status line and the empty-deck hero', () => {
    const empty = { availablePulls: 0, reservePulls: 0 };
    expect(vmFor(makeDeck(), empty).drawStatusLabel).toBe('New draws unlock after you clear today’s work.');
    expect(vmFor(makeDeck({ localCards: 0, studyCards: 0, dueToday: 0, newToday: 0 }), empty, 'empty_deck').hero.helper).toBe(
      'Every card you draw joins today’s session; learning it earns the next draw.',
    );
  });

  it('labels the session preview with final check and harder recall', () => {
    const vm = vmFor(makeDeck({ dueToday: 5, newToday: 0 }), { availablePulls: 0, reservePulls: 0 });
    const titles = vm.routePreview.map((node) => node.title);
    expect(titles).toContain('Final check');
    expect(titles).toContain('Harder recall');
    const noDeck = vmFor(null, { availablePulls: 0, reservePulls: 0 });
    expect(noDeck.routePreview[0]?.title).toBe('No session yet');
  });
});

describe('Home, Library and Card detail screens speak plain words (R24B W02)', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../../src', path), 'utf8');

  it('Home says reward pack, not reward draw', () => {
    const source = read('screens/HomeScreen.tsx');
    expect(source).toContain('A reward pack is ready');
    expect(source).toContain('Open reward pack');
    expect(source).not.toMatch(/reward draw/i);
  });

  it('Library banner says draws, not pulls', () => {
    const source = read('features/gacha/library/LibraryHeader.tsx');
    expect(source).toContain('Earn draws in a session, then open your first pack');
    expect(source).toContain('Earn draws in a session to open your first pack');
    expect(source).not.toMatch(/Earn pulls/);
  });

  it('Card detail locked-card button says Open reward pack', () => {
    const source = read('screens/CardDetailScreen.tsx');
    expect(source).toContain('accessibilityLabel="Open reward pack"');
    expect(source).toContain('>Open reward pack</Text>');
    expect(source).not.toMatch(/Open reward draw/);
  });
});

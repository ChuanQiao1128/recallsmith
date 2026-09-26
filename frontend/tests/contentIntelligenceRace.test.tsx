// @vitest-environment jsdom
//
// Race tests for ContentIntelligencePage's content fetch effect (CFE-12, F30).
//
// The page fetches in a useEffect keyed on [days, deckSlug, refreshNonce]. If
// the user switches the deck or the window while a request is still out, the
// older response can land last and overwrite the newer selection's data. The
// effect's cleanup flips a `cancelled` flag so a stale run bails before it can
// setState. These three cases fail on the pre-fix page (the stale response wins)
// and pass once the flag is in place.
//
// Fixtures, the `api` mock and `mount` are copied from
// contentIntelligencePage.test.tsx so the two files stay in step. renderAt does
// NOT wrap in a QueryClientProvider: this page calls the api module directly
// with useEffect/useState.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ContentIntelligenceCard, ContentIntelligenceData } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { deferred, ok, refused } from './support/apiResult';
import { renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchContentIntelligence: vi.fn(),
  fetchDecks: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { ContentIntelligencePage } = await import('../src/pages/ContentIntelligencePage');

const DECK_SLUG = 'csharp-fundamentals';
const REFUSAL_MESSAGE = 'Analytics warehouse is rebuilding; try again in ten minutes.';

const deck: Deck = {
  id: 7,
  slug: DECK_SLUG,
  title: 'C# Fundamentals',
  author: 'console-tests',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/** Distinct question text per card, so row order is readable off the DOM. */
function card(n: number): ContentIntelligenceCard {
  return {
    deckSlug: DECK_SLUG,
    deckTitle: 'C# Fundamentals',
    cardStableUid: `card-${n}`,
    cardQuestion: `Question number ${n}`,
    revision: 1,
    statedDifficulty: 2,
    reviewCount: 10,
    uniqueUserCount: 5,
    firstReviewCount: 5,
    observedDifficultyRaw: 2.5,
    expectedDifficulty: 2,
    difficultyGap: 0.5,
    difficultyGapZ: 0.2,
    easyRate: 0.1,
    goodRate: 0.5,
    hardRate: 0.2,
    againRate: 0.2,
    struggleRate: 0.4,
    failureRate: 0.2,
    firstReviewEasyRate: 0.1,
    repeatFailureRate: 0.1,
    medianDwellTimeMs: 8000,
    expectedDwellTimeMs: 7000,
    dwellTimeGapZ: 0.1,
    highLevelUserFailureRate: 0.05,
    reviewCountToMastery: 3,
    postCardDropoutRate: 0.02,
    difficultyCalibrationStatus: 'Correctly Calibrated',
    contentQualityStatus: 'Healthy',
    confidenceLevel: 'High',
    fixPriorityScore: 50,
  };
}

const SUMMARY = {
  cardCount: 312,
  needsMoreData: 1,
  possiblyUnclear: 2,
  tooShallow: 3,
  productiveChallenge: 4,
  difficultyUnderstated: 5,
  difficultyOverstated: 6,
};

function payload(cards: ContentIntelligenceCard[]): ContentIntelligenceData {
  return { generatedAtMs: 1767225600000, windowDays: 90, deckSlug: null, cards, summary: SUMMARY };
}

// ---------------------------------------------------------------------------
// DOM readers (copied from contentIntelligencePage.test.tsx)
// ---------------------------------------------------------------------------

/** The error banner has no role or test id, so it is found by its unique class. */
function errorBanners(): Element[] {
  return Array.from(document.querySelectorAll('div.bg-red-50'));
}

/** Question text of every rendered table row, in DOM order. */
function rowQuestions(): string[] {
  return Array.from(document.querySelectorAll('tbody tr[role="button"]')).map(tr =>
    (tr.getAttribute('aria-label') ?? '').replace('Open detail for ', ''),
  );
}

function mount() {
  return renderAt(<ContentIntelligencePage />, ['/content-intelligence']);
}

/** Let pending microtasks (a resolved fetch, its setState) run to completion. */
async function flush(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDecks.mockResolvedValue(ok([deck]));
  api.fetchContentIntelligence.mockResolvedValue(ok(payload([card(1)])));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('a stale content response never overwrites the current selection', () => {
  it('a slow response for the previous window does not replace the newer window', async () => {
    // Mount fetches the 90-day window; switching to 30 fetches the 30-day one.
    // The 30-day (newer) response resolves first and paints; the 90-day (older,
    // now stale) response resolves last and must be ignored.
    const d30 = deferred<ApiResult<ContentIntelligenceData>>();
    const d90 = deferred<ApiResult<ContentIntelligenceData>>();
    api.fetchContentIntelligence.mockImplementation(p => (p.days === 30 ? d30.promise : d90.promise));

    mount();
    await userEvent.selectOptions(screen.getByLabelText('Window'), '30');

    d30.resolve(ok(payload([card(30)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 30']));

    d90.resolve(ok(payload([card(90)])));
    await flush();
    expect(rowQuestions()).toEqual(['Question number 30']);
  });

  it('a slow response for the previous deck does not replace the newly selected deck', async () => {
    // Mount fetches all readable decks (deckSlug null); selecting a deck fetches
    // that deck. The selected-deck (newer) response resolves first and paints;
    // the all-decks (older, now stale) response resolves last and must be dropped.
    const dAll = deferred<ApiResult<ContentIntelligenceData>>();
    const dDeck = deferred<ApiResult<ContentIntelligenceData>>();
    api.fetchContentIntelligence.mockImplementation(p => (p.deckSlug === DECK_SLUG ? dDeck.promise : dAll.promise));

    mount();
    // The deck option appears once fetchDecks resolves.
    await screen.findByRole('option', { name: deck.title });
    await userEvent.selectOptions(screen.getByLabelText('Deck'), DECK_SLUG);

    dDeck.resolve(ok(payload([card(30)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 30']));

    dAll.resolve(ok(payload([card(90)])));
    await flush();
    expect(rowQuestions()).toEqual(['Question number 30']);
  });

  it('a stale failure does not replace the newer rows with an error', async () => {
    // The older request comes back a refusal after the newer request already
    // rendered rows. The stale failure must not surface an error banner or blank
    // the table.
    const dOld = deferred<ApiResult<ContentIntelligenceData>>();
    const dNew = deferred<ApiResult<ContentIntelligenceData>>();
    api.fetchContentIntelligence.mockImplementation(p => (p.days === 30 ? dNew.promise : dOld.promise));

    mount();
    await userEvent.selectOptions(screen.getByLabelText('Window'), '30');

    dNew.resolve(ok(payload([card(30)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 30']));

    dOld.resolve(refused<ContentIntelligenceData>('ANALYTICS_UNAVAILABLE', REFUSAL_MESSAGE));
    await flush();
    expect(errorBanners()).toHaveLength(0);
    expect(rowQuestions()).toEqual(['Question number 30']);
  });
});

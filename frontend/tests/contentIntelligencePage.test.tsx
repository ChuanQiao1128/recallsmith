// @vitest-environment jsdom
//
// Characterization tests for ContentIntelligencePage. Written and run green
// against a COMPLETELY UNMODIFIED ContentIntelligencePage.tsx.
//
// PROVENANCE. This page was refactored in 9bbbaf9 ("lint 归零") while it had
// zero tests: `load` was folded from a useCallback into the effect, Refresh
// stopped calling load() and started bumping a refreshNonce, and the three
// toolbar controls gained a beginLoading() call. Nothing verified that at the
// time. Before this file was finalised, every case in it was run against the
// PRE-refactor page (git show 8edaecd:...ContentIntelligencePage.tsx) as well
// as today's, and all of them were green on both. So what is pinned here is
// behaviour with two independent versions backing it, not the shape of the
// current implementation.
//
// ONE BRANCH, NOT TWO. src/api/authoring.ts wraps every request in try/catch
// and returns `fail(...)`, so fetchContentIntelligence NEVER rejects. A
// business refusal (HTTP 200 + success:false) and a thrown request arrive at
// this page as the same ApiResult shape, take the same `!res.success` branch,
// and render the same red div. The two cases below are therefore NOT two paths;
// the network one is recorded to document that the page cannot tell them apart.
// Making a mock reject would be worse than useless here: the effect runs
// `void run()` with no catch, so one rejected mock becomes an unhandled
// rejection that fails the whole file.
//
// The mutations these tests are built to fail against:
//
//   1. `summary?.cardCount ?? 0` -> `cards.length` in the tile row. The fixture
//      states cardCount = 312 with 25 cards, so the two can never agree.
//   2. `cards.slice(0, 20)` -> slice(0, 10) or slice(0, 25).
//   3. dropping `|| !res.data` from the failure test, which lets a
//      success:true/data:null response render as an empty page with no error.
//   4. deleting beginLoading() from any ONE of the three toolbar handlers —
//      each is covered by its own case, so exactly one must go red.
//   5. deleting setRefreshNonce, which is what the 9bbbaf9 refactor would look
//      like if it had gone wrong: Refresh shows the spinner forever.
//   6. `deckSlug || null` -> `deckSlug`, sending '' where the api layer's
//      `if (params?.deckSlug)` treats '' and null the same but the contract
//      does not.
//   7. dropping `e.key === ' '` from the row keydown handler.
//   8. `?? topCards[0]` -> `?? null` in the selectedCard memo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ContentIntelligenceCard, ContentIntelligenceData } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Deck } from '../src/types/deck';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { deferred, networkFailure, ok, refused } from './support/apiResult';
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
const THROWN_MESSAGE = 'socket hang up';
/** The string the page substitutes when the server refuses without a message. */
const FALLBACK_MESSAGE = 'Failed to load content intelligence';

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

/**
 * The tile numbers are DELIBERATELY unequal to anything derivable from `cards`.
 * cardCount is 312 against 25 cards, and the other five are 2..6 against zero
 * cards carrying those statuses. An expectation that can be recomputed from the
 * card array cannot detect a tile that reads the card array.
 */
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

const TWENTY_FIVE = Array.from({ length: 25 }, (_, i) => card(i + 1));

// ---------------------------------------------------------------------------
// DOM readers
//
// The error banner has no role and no test id, so it is found by the one class
// combination unique to it on this page. That is a smell in the page, not in
// the test: an error a screen reader never announces is recorded in the report
// as a defect rather than worked around silently.
// ---------------------------------------------------------------------------

function errorBanners(): Element[] {
  return Array.from(document.querySelectorAll('div.bg-red-50'));
}

function errorText(): string {
  const banners = errorBanners();
  expect(banners).toHaveLength(1);
  return banners[0].textContent ?? '';
}

/** Question text of every rendered table row, in DOM order. */
function rowQuestions(): string[] {
  return Array.from(document.querySelectorAll('tbody tr[role="button"]')).map(tr =>
    (tr.getAttribute('aria-label') ?? '').replace('Open detail for ', ''),
  );
}

function tableBodyText(): string {
  return document.querySelector('tbody')?.textContent ?? '';
}

/** Label + value of the six summary tiles, in DOM order, e.g. "Cards312". */
function tileTexts(): string[] {
  return Array.from(document.querySelectorAll('section.grid > div')).map(d => d.textContent ?? '');
}

/** The header pill. ConsoleShell renders exactly one <span> in <header>. */
function userLabel(): string {
  return document.querySelector('header span')?.textContent ?? '';
}

/** Question of the card whose detail panel is open, read off the only <h3>. */
function openDetailQuestion(): string {
  return screen.getByRole('heading', { level: 3 }).textContent ?? '';
}

function mount() {
  return renderAt(<ContentIntelligencePage />, ['/content-intelligence']);
}

/** Mount and wait until the first response has painted. */
async function mountLoaded(): Promise<void> {
  mount();
  await waitFor(() => expect(tableBodyText()).not.toContain('Loading…'));
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDecks.mockResolvedValue(ok([deck]));
  api.fetchContentIntelligence.mockResolvedValue(ok(payload(TWENTY_FIVE)));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('what the table shows while the first response is outstanding', () => {
  it('paints Loading… before anything has resolved', async () => {
    const d = deferred<ApiResult<ContentIntelligenceData>>();
    api.fetchContentIntelligence.mockReturnValue(d.promise);

    mount();

    // loading:true is useState's initial value, not something an effect wrote.
    expect(tableBodyText()).toContain('Loading…');
    expect(rowQuestions()).toHaveLength(0);

    d.resolve(ok(payload([card(1)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 1']));
  });
});

describe('the table is capped at twenty rows and keeps the server order', () => {
  it('renders the first twenty of twenty-five and drops the rest', async () => {
    await mountLoaded();

    const questions = rowQuestions();
    expect(questions).toHaveLength(20);
    expect(questions[0]).toBe('Question number 1');
    expect(questions[19]).toBe('Question number 20');
    expect(questions).not.toContain('Question number 21');
    expect(questions).not.toContain('Question number 25');
  });

  it('does not re-sort what the server sent', async () => {
    // The server decides priority order; the page must not impose its own.
    // Reversing the fixture makes a client-side sort visible, because a sorted
    // render would put "Question number 1" back on top.
    api.fetchContentIntelligence.mockResolvedValue(ok(payload([card(9), card(4), card(7)])));
    await mountLoaded();

    expect(rowQuestions()).toEqual(['Question number 9', 'Question number 4', 'Question number 7']);
  });
});

describe('the summary tiles come from the server summary, not from the rows', () => {
  it('shows cardCount even though it disagrees with the number of cards', async () => {
    await mountLoaded();

    // 312 is unreachable from the 25-card array by any means, so this fails the
    // moment the tile starts counting rows.
    expect(tileTexts()[0]).toBe('Cards312');
    expect(rowQuestions()).toHaveLength(20);
  });

  it('maps each of the other five tiles to its own summary field', async () => {
    await mountLoaded();

    // Six distinct values in a fixed order: any two tiles wired to the same
    // field, or wired in the wrong order, changes this array.
    expect(tileTexts()).toEqual([
      'Cards312',
      'Possibly Unclear2',
      'Too Shallow3',
      'Productive Challenge4',
      'Difficulty Understated5',
      'Difficulty Overstated6',
    ]);
  });
});

describe('a response the page cannot render', () => {
  it('shows the refusal in the wording the server chose', async () => {
    api.fetchContentIntelligence.mockResolvedValue(
      refused<ContentIntelligenceData>('ANALYTICS_UNAVAILABLE', REFUSAL_MESSAGE),
    );
    await mountLoaded();

    expect(errorText()).toBe(REFUSAL_MESSAGE);
  });

  it('falls back to its own wording when the server sent no message', async () => {
    api.fetchContentIntelligence.mockResolvedValue({
      success: false,
      data: null,
      error: null,
      traceId: 'trace-no-error',
    } as ApiResult<ContentIntelligenceData>);
    await mountLoaded();

    expect(errorText()).toBe(FALLBACK_MESSAGE);
  });

  it('treats success:true with a null body as a failure too', async () => {
    // This is the case `|| !res.data` exists for. Without that clause the page
    // takes the success branch, stores data:null, and renders a blank table
    // with no indication that anything went wrong.
    api.fetchContentIntelligence.mockResolvedValue({
      success: true,
      data: null,
      error: null,
      traceId: 'trace-null-body',
    } as ApiResult<ContentIntelligenceData>);
    await mountLoaded();

    expect(errorText()).toBe(FALLBACK_MESSAGE);
  });

  it('renders a thrown request through the same banner (recorded, not a second path)', async () => {
    api.fetchContentIntelligence.mockResolvedValue(networkFailure<ContentIntelligenceData>(THROWN_MESSAGE));
    await mountLoaded();

    // Same element, same styling, no hint that the write status is unknown.
    // Compare CardListPage, which distinguishes the two.
    expect(errorText()).toBe(THROWN_MESSAGE);
  });

  it('still says "no review events" underneath the error banner', async () => {
    api.fetchContentIntelligence.mockResolvedValue(
      refused<ContentIntelligenceData>('ANALYTICS_UNAVAILABLE', REFUSAL_MESSAGE),
    );
    await mountLoaded();

    // Pinned as today's behaviour, and reported as a defect: a failed fetch is
    // described to the user as an empty window.
    expect(tableBodyText()).toContain('No review events in this window.');
  });
});

describe('an empty window', () => {
  it('says so, and shows zero rows', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload([])));
    await mountLoaded();

    expect(rowQuestions()).toHaveLength(0);
    expect(tableBodyText()).toContain('No review events in this window.');
    expect(errorBanners()).toHaveLength(0);
  });
});

describe('the deck list is optional scenery', () => {
  it('leaves the page fully usable and silent when fetchDecks fails', async () => {
    api.fetchDecks.mockResolvedValue(refused<Deck[]>('FORBIDDEN', 'You cannot list decks.'));
    await mountLoaded();

    // Everything that matters still works...
    expect(rowQuestions()).toHaveLength(20);
    expect(tileTexts()[0]).toBe('Cards312');

    // ...and the failure is swallowed whole: not the server's message, not a
    // fallback, nothing. Recorded as a defect; the dropdown silently offers
    // only "All readable decks" and the user cannot tell why.
    expect(errorBanners()).toHaveLength(0);
    expect(screen.queryByText('You cannot list decks.')).toBeNull();
    const deckSelect = screen.getByLabelText('Deck') as HTMLSelectElement;
    expect(Array.from(deckSelect.options).map(o => o.textContent)).toEqual(['All readable decks']);
  });
});

describe('each toolbar control sends the parameters it owns', () => {
  it('mounts with the whole-account defaults', async () => {
    await mountLoaded();

    expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(1);
    expect(api.fetchContentIntelligence).toHaveBeenNthCalledWith(1, { deckSlug: null, days: 90, limit: 100 });
  });

  it('changes only deckSlug when the deck changes', async () => {
    await mountLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Deck'), DECK_SLUG);

    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2));
    expect(api.fetchContentIntelligence).toHaveBeenNthCalledWith(2, { deckSlug: DECK_SLUG, days: 90, limit: 100 });
  });

  it('sends null, not the empty string, when the deck goes back to all', async () => {
    await mountLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Deck'), DECK_SLUG);
    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2));

    await userEvent.selectOptions(screen.getByLabelText('Deck'), '');
    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(3));

    // The select's own value is '' — the page is responsible for translating it.
    expect(api.fetchContentIntelligence).toHaveBeenNthCalledWith(3, { deckSlug: null, days: 90, limit: 100 });
  });

  it('changes only days when the window changes', async () => {
    await mountLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Window'), '30');

    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2));
    expect(api.fetchContentIntelligence).toHaveBeenNthCalledWith(2, { deckSlug: null, days: 30, limit: 100 });
  });

  it('repeats the previous parameters exactly when Refresh is pressed', async () => {
    await mountLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Window'), '180');
    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    // Refresh means "ask again for what is on screen". If it dropped the
    // window the user picked, this would come back as days: 90.
    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(3));
    expect(api.fetchContentIntelligence.mock.calls[2]).toEqual(api.fetchContentIntelligence.mock.calls[1]);
  });

  it('issues exactly one extra request per control action', async () => {
    await mountLoaded();
    await userEvent.selectOptions(screen.getByLabelText('Deck'), DECK_SLUG);

    await waitFor(() => expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2));
    // A second effect keyed on the same state, or a handler that both sets
    // state and fetches, shows up here as 3.
    expect(api.fetchContentIntelligence).toHaveBeenCalledTimes(2);
    expect(api.fetchDecks).toHaveBeenCalledTimes(1);
  });
});

describe('every control that refetches also shows that it is refetching', () => {
  // One case per handler, because beginLoading() is called from three separate
  // places and a deletion in one of them must not be masked by the other two.
  async function mountThenHoldNextResponse(): Promise<{ resolve: (v: ApiResult<ContentIntelligenceData>) => void }> {
    await mountLoaded();
    expect(rowQuestions()).toHaveLength(20);

    const d = deferred<ApiResult<ContentIntelligenceData>>();
    api.fetchContentIntelligence.mockReturnValue(d.promise);
    return d;
  }

  function expectBusy(): void {
    expect(tableBodyText()).toContain('Loading…');
    expect(rowQuestions()).toHaveLength(0);
  }

  it('goes busy when the deck changes', async () => {
    const d = await mountThenHoldNextResponse();
    await userEvent.selectOptions(screen.getByLabelText('Deck'), DECK_SLUG);

    expectBusy();
    d.resolve(ok(payload([card(1)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 1']));
  });

  it('goes busy when the window changes', async () => {
    const d = await mountThenHoldNextResponse();
    await userEvent.selectOptions(screen.getByLabelText('Window'), '365');

    expectBusy();
    d.resolve(ok(payload([card(2)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 2']));
  });

  it('goes busy when Refresh is pressed', async () => {
    const d = await mountThenHoldNextResponse();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    // This is also the case that dies if setRefreshNonce is deleted — without
    // the nonce, beginLoading still fires but no effect ever runs, so the page
    // sits on Loading… forever and the resolve below never repaints it.
    expectBusy();
    d.resolve(ok(payload([card(3)])));
    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 3']));
  });
});

describe('choosing which card the detail panel describes', () => {
  const THREE = [card(1), card(2), card(3)];

  beforeEach(() => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload(THREE)));
  });

  it('opens the first row before anything is clicked', async () => {
    await mountLoaded();

    expect(openDetailQuestion()).toBe('Question number 1');
    expect(screen.getAllByText('Detail open')).toHaveLength(1);
  });

  it('follows a click to another row', async () => {
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Open detail for Question number 3' }));

    expect(openDetailQuestion()).toBe('Question number 3');
    expect(screen.getAllByText('Detail open')).toHaveLength(1);
  });

  it('opens a row on Enter', async () => {
    await mountLoaded();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open detail for Question number 2' }), { key: 'Enter' });

    await waitFor(() => expect(openDetailQuestion()).toBe('Question number 2'));
  });

  it('opens a row on Space', async () => {
    await mountLoaded();
    // Separate from Enter on purpose: the handler tests two keys with ||, and
    // one shared case would stay green after either half was deleted.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open detail for Question number 2' }), { key: ' ' });

    await waitFor(() => expect(openDetailQuestion()).toBe('Question number 2'));
  });

  it('ignores a key that is neither Enter nor Space', async () => {
    await mountLoaded();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open detail for Question number 3' }), { key: 'a' });

    expect(openDetailQuestion()).toBe('Question number 1');
  });

  it('falls back to the new first row when the chosen card leaves the data', async () => {
    await mountLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Open detail for Question number 3' }));
    expect(openDetailQuestion()).toBe('Question number 3');

    // selectedCardKey still points at card-3, which the next response does not
    // contain. Without the `?? topCards[0]` fallback the detail panel would
    // vanish entirely while rows were on screen.
    api.fetchContentIntelligence.mockResolvedValue(ok(payload([card(10), card(11)])));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(rowQuestions()).toEqual(['Question number 10', 'Question number 11']));
    expect(openDetailQuestion()).toBe('Question number 10');
  });

  it('hides the detail panel entirely when there are no rows at all', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload([])));
    await mountLoaded();

    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });
});

describe('what the header offers each role', () => {
  it('gives a super admin the Admin Management button and says so in the pill', async () => {
    await mountLoaded();

    expect(screen.queryByRole('button', { name: 'Admin Management' })).not.toBeNull();
    expect(userLabel().endsWith(' · super_admin')).toBe(true);
  });

  it('gives an editor neither', async () => {
    signOut();
    signInAsEditor();
    await mountLoaded();

    expect(screen.queryByRole('button', { name: 'Admin Management' })).toBeNull();
    expect(userLabel().endsWith(' · editor')).toBe(true);
  });

  it('shows an em dash when there is no session at all', async () => {
    signOut();
    await mountLoaded();

    expect(userLabel()).toBe('—');
    expect(screen.queryByRole('button', { name: 'Admin Management' })).toBeNull();
  });
});

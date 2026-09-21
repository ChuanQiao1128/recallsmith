// @vitest-environment jsdom
//
// The MCQ "not assessed" banner on ContentIntelligencePage (C13). The banner is
// derived at render time from state.data.summary.mcqCardCount — there is no new
// effect and no setState — so these cases only vary the server payload and read
// what paints. The six-tile pin from contentIntelligencePage.test.tsx stays in
// that file untouched; here we only assert the banner is never a child of the
// tile grid.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';

import type { ContentIntelligenceData } from '../src/api/authoring';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ok } from './support/apiResult';
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

/**
 * cards is empty; the seven base summary keys carry arbitrary numbers. When
 * mcqCardCount is passed it is spread in; when it is omitted the key is ABSENT
 * (not undefined) — the "older server that never sends it" case.
 */
function payload(mcqCardCount?: number): ContentIntelligenceData {
  return {
    generatedAtMs: 1767225600000,
    windowDays: 90,
    deckSlug: null,
    cards: [],
    summary: {
      cardCount: 12,
      needsMoreData: 1,
      possiblyUnclear: 2,
      tooShallow: 3,
      productiveChallenge: 4,
      difficultyUnderstated: 5,
      difficultyOverstated: 6,
      ...(mcqCardCount === undefined ? {} : { mcqCardCount }),
    },
  };
}

function banner(): Element | null {
  return document.querySelector('[data-testid="content-intelligence-mcq-banner"]');
}

async function mountLoaded(): Promise<void> {
  renderAt(<ContentIntelligencePage />, ['/content-intelligence']);
  await waitFor(() =>
    expect(document.querySelector('tbody')?.textContent ?? '').not.toContain('Loading…'),
  );
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  api.fetchDecks.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
});

describe('ContentIntelligencePage MCQ banner', () => {
  it('shows the MCQ banner with the count from the server summary', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload(2)));
    await mountLoaded();

    const el = banner();
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('2 MCQ cards in scope are not assessed by the Q/A model.');
  });

  it('uses the singular form for exactly one MCQ card', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload(1)));
    await mountLoaded();

    expect(banner()?.textContent).toBe('1 MCQ card in scope are not assessed by the Q/A model.');
  });

  it('renders no banner when mcqCardCount is zero', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload(0)));
    await mountLoaded();

    expect(banner()).toBeNull();
  });

  it('renders no banner when the summary has no mcqCardCount', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload()));
    await mountLoaded();

    expect(banner()).toBeNull();
  });

  it('keeps the six summary tiles outside the banner', async () => {
    api.fetchContentIntelligence.mockResolvedValue(ok(payload(2)));
    await mountLoaded();

    expect(document.querySelectorAll('section.grid > div')).toHaveLength(6);
    expect(document.querySelector('section.grid [data-testid="content-intelligence-mcq-banner"]')).toBeNull();
  });
});

// @vitest-environment jsdom
//
// The /usage console page (R20 contract §7, §8; V10): the DAU/WAU/MAU headline
// for the latest complete day, the 30-day table with "—" for what the server has
// not computed, the per-deck table, excluded accounts and last computed time, a
// plain SVG sparkline, the Freshness section, and neutral callouts for a server
// without the migration. The "Funnel (anonymous installs)" section (R24
// contract §3.5) sits between By deck and Freshness. src/api/usage is mocked, so nothing here can leave the
// process; the session is a real token through tests/support/consoleSession.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsEditor, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { consoleSectionFor } from '../src/components/console/consoleNav';
import { documentTitleFor } from '../src/lib/brand';
import type { ApiResult } from '../src/types/api';
import type { FreshnessReport, FunnelCounts, FunnelReport, UsageDay, UsageReport } from '../src/api/usage';

const api = vi.hoisted(() => ({
  fetchUsage: vi.fn(),
  fetchFreshness: vi.fn(),
  fetchFunnel: vi.fn(),
}));

vi.mock('../src/api/usage', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/usage')>();
  return { ...actual, ...api };
});

const { UsagePage } = await import('../src/pages/UsagePage');

function day(overrides: Partial<UsageDay> & { day: string }): UsageDay {
  return {
    dau: 10,
    wau: 25,
    mau: 40,
    reviews: 300,
    newUsers: 2,
    cardsLearned: 30,
    d1Retention: 0.5,
    d7Retention: 0.25,
    ...overrides,
  };
}

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    // Oldest first on purpose: the page must pick the latest day itself.
    days: [
      day({ day: '2026-09-28', dau: 8 }),
      day({ day: '2026-09-30', dau: 12, wau: 31, mau: 57, reviews: 1480, d1Retention: null, d7Retention: null }),
      day({ day: '2026-09-29', dau: 9, newUsers: null, cardsLearned: null, d7Retention: null }),
    ],
    decks: [
      { deckSlug: 'aws-saa-c03', activeUsers30d: 20, reviews30d: 900, newLearners30d: 4 },
      { deckSlug: 'csharp-fundamentals', activeUsers30d: 5, reviews30d: 120, newLearners30d: null },
    ],
    excludedSubsCount: 2,
    lastComputedAt: '2026-10-01T00:05:00Z',
    ...overrides,
  };
}

function freshness(overrides: Partial<FreshnessReport> = {}): FreshnessReport {
  return {
    items: [
      {
        kind: 'feed',
        refId: '88',
        title: 'Lambda adds a runtime',
        detectedAt: '2026-09-20T10:00:00Z',
        queuedAt: '2026-09-20T10:01:00Z',
        draftedAt: '2026-09-20T11:00:00Z',
        decidedAt: '2026-09-20T12:00:00Z',
        publishedAt: '2026-09-20T13:00:00Z',
      },
    ],
    medians: { minutesToDraft: 59, minutesToDecision: 119, minutesToPublish: 180 },
    n: 1,
    ...overrides,
  };
}

function funnelCounts(overrides: Partial<FunnelCounts> = {}): FunnelCounts {
  return {
    first_open: null,
    goal_chosen: null,
    starter_started: null,
    starter_completed: null,
    first_pack_opened: null,
    returned_day_1: null,
    returned_day_7: null,
    signup_started: null,
    signup_completed: null,
    ...overrides,
  };
}

function funnel(overrides: Partial<FunnelReport> = {}): FunnelReport {
  const weeks = [];
  // 14 cohort weeks, oldest first: the page keeps the newest 12.
  for (let i = 0; i < 14; i++) {
    const weekStart = new Date(Date.UTC(2026, 5, 29 + i * 7)).toISOString().slice(0, 10);
    weeks.push({ weekStart, counts: funnelCounts({ first_open: 10 + i, goal_chosen: 5 }) });
  }
  return {
    days: 90,
    overall: funnelCounts({
      first_open: 200,
      goal_chosen: 150,
      starter_started: 100,
      starter_completed: 50,
      first_pack_opened: 40,
      returned_day_1: 30,
      returned_day_7: 10,
      signup_started: 4,
      signup_completed: 2,
    }),
    weeks,
    decks: [
      { deckSlug: 'aws-saa-c03', counts: { goal_chosen: 100, starter_started: 80, starter_completed: 40, first_pack_opened: null } },
    ],
    ...overrides,
  };
}

async function mountLoaded(path = '/usage') {
  renderAt(<UsagePage />, [path]);
  await screen.findByRole('table', { name: 'Usage by day' });
  await screen.findByRole('table', { name: 'Freshness list' });
  await screen.findByRole('table', { name: 'Funnel steps' });
  await act(async () => {});
}

function rows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(r => within(r).getAllByRole('cell').map(c => c.textContent ?? ''));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchUsage.mockResolvedValue(ok(report()));
  api.fetchFreshness.mockResolvedValue(ok(freshness()));
  api.fetchFunnel.mockResolvedValue(ok(funnel()));
  signInAsEditor();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe('UsagePage', () => {
  it('is the Usage section with its own tab title', () => {
    expect(consoleSectionFor('/usage')).toBe('usage');
    expect(documentTitleFor('/usage')).toBe('Usage · DeveloperCards Console');
  });

  it('shows DAU, WAU and MAU for the latest complete day with the sparkline', async () => {
    await mountLoaded();
    expect(api.fetchUsage).toHaveBeenCalledWith(30);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Usage');
    const headline = screen.getByRole('region', { name: 'Headline' });
    expect(within(headline).getByRole('heading', { level: 2 }).textContent).toBe('Latest complete day: 2026-09-30');
    expect(screen.getByTestId('usage-dau').textContent).toBe('12');
    expect(screen.getByTestId('usage-wau').textContent).toBe('31');
    expect(screen.getByTestId('usage-mau').textContent).toBe('57');

    const spark = within(headline).getByRole('img', { name: 'Daily active learners over the last 3 days' });
    // Oldest to newest, left to right: 8, 9, 12 — the newest point is the top of the box.
    expect(spark.querySelector('polyline')?.getAttribute('points')).toBe('0,40 120,30 240,0');
  });

  it('lists the days newest first with "—" for every figure the server has not computed', async () => {
    await mountLoaded();
    expect(rows(screen.getByRole('table', { name: 'Usage by day' }))).toEqual([
      ['2026-09-30', '12', '1,480', '2', '30', '—', '—'],
      ['2026-09-29', '9', '300', '—', '—', '50.0%', '—'],
      ['2026-09-28', '8', '300', '2', '30', '50.0%', '25.0%'],
    ]);
    const header = within(screen.getByRole('table', { name: 'Usage by day' }))
      .getAllByRole('columnheader')
      .map(h => h.textContent);
    expect(header).toEqual(['Day', 'DAU', 'Reviews', 'New users', 'Cards learned', 'D1', 'D7']);
  });

  it('lists each deck, the excluded accounts and the last computed time', async () => {
    await mountLoaded();
    expect(rows(screen.getByRole('table', { name: 'Usage by deck' }))).toEqual([
      ['aws-saa-c03', '20', '900', '4'],
      ['csharp-fundamentals', '5', '120', '—'],
    ]);
    expect(screen.getByTestId('usage-meta').textContent).toBe(
      'Excluded accounts: 2 · Last computed: 2026-10-01 00:05 UTC',
    );
  });

  it('shows the Freshness medians and list', async () => {
    await mountLoaded();
    expect(api.fetchFreshness).toHaveBeenCalledWith(30);
    const section = document.getElementById('freshness') as HTMLElement;
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Freshness');
    expect(screen.getByTestId('freshness-median-publish').textContent).toBe('180 min');
    expect(rows(within(section).getByRole('table', { name: 'Freshness list' }))).toEqual([
      [
        'Release notes',
        'Lambda adds a runtime',
        '2026-09-20 10:00 UTC',
        '2026-09-20 10:01 UTC',
        '2026-09-20 11:00 UTC',
        '2026-09-20 12:00 UTC',
        '2026-09-20 13:00 UTC',
      ],
    ]);
  });

  it('scrolls to the Freshness section when linked as /usage#freshness', async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      await mountLoaded('/usage#freshness');
      expect(scrolled).toContain(document.getElementById('freshness'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('draws no sparkline and "—" everywhere before any day is computed', async () => {
    api.fetchUsage.mockResolvedValue(ok(report({ days: [], decks: [], lastComputedAt: null, excludedSubsCount: 0 })));
    renderAt(<UsagePage />, ['/usage']);
    await screen.findByText('No complete day computed yet');
    expect(screen.getByTestId('usage-dau').textContent).toBe('—');
    expect(screen.queryByTestId('usage-sparkline')).toBeNull();
    expect(screen.getByText('No day has been computed yet.')).toBeTruthy();
    expect(screen.getByText('No deck has activity in this window.')).toBeTruthy();
    expect(screen.getByTestId('usage-meta').textContent).toBe('Excluded accounts: 0 · Last computed: —');
  });

  it('shows a neutral callout, not an error, on a server without the migration', async () => {
    api.fetchUsage.mockResolvedValue(refused('NOT_READY', 'Run the database migration'));
    api.fetchFreshness.mockResolvedValue(refused('NOT_READY', 'Run the database migration'));
    api.fetchFunnel.mockResolvedValue(refused('NOT_READY', 'Run the database migration'));
    renderAt(<UsagePage />, ['/usage']);
    const callout = await screen.findByTestId('usage-not-ready');
    expect(callout.textContent).toContain('Usage analytics are not set up yet');
    expect(await screen.findByTestId('freshness-not-ready')).toBeTruthy();
    expect(await screen.findByTestId('funnel-not-ready')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server message when the load fails, and Refresh reloads both', async () => {
    const user = userEvent.setup();
    api.fetchUsage.mockResolvedValueOnce(refused('FORBIDDEN', 'Admins only.'));
    renderAt(<UsagePage />, ['/usage']);
    expect((await screen.findByRole('alert')).textContent).toContain('Admins only.');

    const again = deferred<ApiResult<UsageReport>>();
    api.fetchUsage.mockReturnValueOnce(again.promise);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByText('Loading usage…')).toBeTruthy();
    await act(async () => again.resolve(ok(report())));
    expect(await screen.findByRole('table', { name: 'Usage by day' })).toBeTruthy();
    expect(api.fetchUsage).toHaveBeenCalledTimes(2);
    expect(api.fetchFreshness).toHaveBeenCalledTimes(2);
    expect(api.fetchFunnel).toHaveBeenCalledTimes(2);
  });

  it('links Usage in the header as the current section', async () => {
    await mountLoaded();
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    const link = within(nav).getByRole('link', { name: 'Usage' });
    expect(link.getAttribute('href')).toBe('/usage');
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});

describe('UsagePage funnel section', () => {
  function funnelSection(): HTMLElement {
    return screen.getByRole('region', { name: 'Funnel (anonymous installs)' });
  }

  it('sits between By deck and Freshness and reads the 90-day window', async () => {
    await mountLoaded();
    expect(api.fetchFunnel).toHaveBeenCalledWith(90);
    const section = funnelSection();
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Funnel (anonymous installs)');
    const byDeck = screen.getByRole('region', { name: 'Usage by deck' });
    const fresh = document.getElementById('freshness') as HTMLElement;
    expect(byDeck.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists the overall steps with conversion from first open and a plain SVG bar each', async () => {
    await mountLoaded();
    const table = within(funnelSection()).getByRole('table', { name: 'Funnel steps' });
    expect(rows(table).map(r => r.slice(0, 3))).toEqual([
      ['First open', '200', '100.0%'],
      ['Goal chosen', '150', '75.0%'],
      ['Starter started', '100', '50.0%'],
      ['Starter completed', '50', '25.0%'],
      ['First pack opened', '40', '20.0%'],
      ['Returned day 1', '30', '15.0%'],
      ['Returned day 7', '10', '5.0%'],
      ['Sign-up started', '4', '2.0%'],
      ['Sign-up completed', '2', '1.0%'],
    ]);
    const bars = within(table).getAllByTestId('funnel-bar');
    expect(bars).toHaveLength(9);
    const widths = bars.map(b => b.querySelector('rect[data-bar]')?.getAttribute('width'));
    expect(widths[0]).toBe('200');
    expect(widths[1]).toBe('150');
    expect(widths[8]).toBe('2');
  });

  it('lists the last 12 cohort weeks, newest first', async () => {
    await mountLoaded();
    const table = within(funnelSection()).getByRole('table', { name: 'Funnel by cohort week' });
    const weekRows = rows(table);
    expect(weekRows).toHaveLength(12);
    expect(weekRows[0].slice(0, 3)).toEqual(['2026-09-28', '23', '5 (21.7%)']);
    expect(weekRows[11][0]).toBe('2026-07-13');
  });

  it('lists the deck steps with conversion from goal chosen', async () => {
    await mountLoaded();
    const table = within(funnelSection()).getByRole('table', { name: 'Funnel by deck' });
    expect(rows(table)).toEqual([['aws-saa-c03', '100', '80 (80.0%)', '40 (40.0%)', '—']]);
  });

  it('says so when no anonymous install has been counted yet', async () => {
    api.fetchFunnel.mockResolvedValue(ok(funnel({ overall: funnelCounts(), weeks: [], decks: [] })));
    renderAt(<UsagePage />, ['/usage']);
    expect(await screen.findByText('No anonymous install has been counted yet.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Funnel steps' })).toBeNull();
  });

  it('shows a neutral callout only for 503 NOT_READY', async () => {
    api.fetchFunnel.mockResolvedValueOnce(refused('NOT_READY', 'Run migration 043'));
    renderAt(<UsagePage />, ['/usage']);
    expect((await screen.findByTestId('funnel-not-ready')).textContent).toContain('not set up');
    await screen.findByRole('table', { name: 'Usage by day' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a 404 as an error with the server message, not as a pending setup step', async () => {
    api.fetchFunnel.mockResolvedValueOnce({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Route not found', httpStatus: 404 },
      traceId: 't',
    });
    renderAt(<UsagePage />, ['/usage']);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load the funnel');
    expect(alert.textContent).toContain('Route not found');
    expect(screen.queryByTestId('funnel-not-ready')).toBeNull();
  });

  it('shows a mismatched response as an error, not as "no install counted yet"', async () => {
    api.fetchFunnel.mockResolvedValueOnce({
      success: false,
      data: null,
      error: { code: 'BAD_RESPONSE', message: 'The server returned an unexpected funnel response.' },
      traceId: '',
    });
    renderAt(<UsagePage />, ['/usage']);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('unexpected funnel response');
    expect(screen.queryByText('No anonymous install has been counted yet.')).toBeNull();
  });

  it('shows the server message when the funnel fails to load, without hiding the rest', async () => {
    api.fetchFunnel.mockResolvedValue(refused('FORBIDDEN', 'Admins only.'));
    renderAt(<UsagePage />, ['/usage']);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load the funnel');
    expect(alert.textContent).toContain('Admins only.');
    expect(await screen.findByRole('table', { name: 'Usage by day' })).toBeTruthy();
  });
});

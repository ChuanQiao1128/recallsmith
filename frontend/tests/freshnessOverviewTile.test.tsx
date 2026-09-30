// @vitest-environment jsdom
//
// R20 V10: the Automation overview's "Freshness" tile reads the optional
// `freshness` block of GET …/automation/status (contract §7), and the Watched
// sources tile reads the optional `watch.needsReview` (contract §6). A server
// that predates the fields sends neither, and the overview is unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { ok } from './support/apiResult';
import { statusFixture } from './support/automationFixtures';
import type { AutomationStatus } from '../src/api/automation';

const automation = vi.hoisted(() => ({
  fetchEvalGate: vi.fn(),
}));

vi.mock('../src/api/automation', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/automation')>();
  return { ...actual, ...automation };
});

const { OverviewTab } = await import('../src/features/automation/OverviewTab');
const { fetchAutomationStatus } = await import('../src/api/automation');
const { http } = await import('../src/api/http');

function mount(status: AutomationStatus) {
  render(
    <MemoryRouter initialEntries={['/automation']}>
      <OverviewTab status={status} statusLoading={false} superAdmin announce={() => {}} onReload={() => {}} />
    </MemoryRouter>,
  );
}

const originalAdapter = http.defaults.adapter;

function serve(data: unknown) {
  http.defaults.adapter = async (config: InternalAxiosRequestConfig) =>
    ({ data, status: 200, statusText: 'OK', headers: {}, config }) as AxiosResponse;
}

beforeEach(() => {
  automation.fetchEvalGate.mockResolvedValue(ok({ current: null, history: [] }));
});

afterEach(() => {
  cleanup();
  http.defaults.adapter = originalAdapter;
});

describe('the Freshness overview tile', () => {
  it('shows the median minutes to publish and n, linked to the freshness list', () => {
    mount(statusFixture({ freshness: { medianMinutesToPublish: 95.4, n: 7 } }));
    const tile = screen.getByRole('region', { name: 'Freshness' });
    expect(within(tile).getByRole('heading', { name: 'Freshness' })).toBeTruthy();
    expect(within(tile).getByText('Median time to publish').nextSibling?.textContent).toBe('95 min');
    expect(within(tile).getByText('Changes measured (n)').nextSibling?.textContent).toBe('7');
    expect(within(tile).getByRole('link', { name: 'Open the freshness list' }).getAttribute('href')).toBe(
      '/usage#freshness',
    );
  });

  it('shows "—" when no change reached a publish yet', () => {
    mount(statusFixture({ freshness: { medianMinutesToPublish: null, n: 0 } }));
    const tile = screen.getByRole('region', { name: 'Freshness' });
    expect(within(tile).getByText('Median time to publish').nextSibling?.textContent).toBe('—');
  });

  it('is hidden when the server sends no freshness block', () => {
    mount(statusFixture());
    expect(screen.queryByRole('region', { name: 'Freshness' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open the freshness list' })).toBeNull();
  });

  it('adds Needs review to Watched sources only when the server sends it', () => {
    const base = statusFixture();
    mount(statusFixture({ watch: { ...base.watch, needsReview: 3 } }));
    const watch = screen.getByRole('region', { name: 'Watch summary' });
    expect(within(watch).getByText('Needs review').nextSibling?.textContent).toBe('3');
    cleanup();

    mount(statusFixture());
    expect(within(screen.getByRole('region', { name: 'Watch summary' })).queryByText('Needs review')).toBeNull();
  });

  it('normalises both fields from the status response only when present', async () => {
    const raw = statusFixture();
    serve(ok({ ...raw, freshness: { medianMinutesToPublish: '120.5', n: '4' }, watch: { ...raw.watch, needsReview: '2' } }));
    const res = await fetchAutomationStatus();
    expect(res.data?.freshness).toEqual({ medianMinutesToPublish: 120.5, n: 4 });
    expect(res.data?.watch.needsReview).toBe(2);

    serve(ok({ ...raw, freshness: { medianMinutesToPublish: null, n: 0 } }));
    expect((await fetchAutomationStatus()).data?.freshness).toEqual({ medianMinutesToPublish: null, n: 0 });

    serve(ok(statusFixture()));
    const older = await fetchAutomationStatus();
    expect(older.data && 'freshness' in older.data).toBe(false);
    expect(older.data && 'needsReview' in older.data.watch).toBe(false);

    serve(ok({ ...statusFixture(), freshness: 'soon' }));
    const junk = await fetchAutomationStatus();
    expect(junk.data && 'freshness' in junk.data).toBe(false);
  });
});

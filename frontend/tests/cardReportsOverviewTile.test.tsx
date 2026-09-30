// @vitest-environment jsdom
//
// R20 V09: the Automation overview's "Card reports" tile reads the optional
// `cardReports` block of GET …/automation/status (contract §4 side effects).
// A server that predates the field sends none, and the tile is not rendered.

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

describe('the Card reports overview tile', () => {
  it('shows open and new-in-7-days counts with a link to /reports', () => {
    mount(statusFixture({ cardReports: { open: 3, openedLast7d: 2 } }));
    const tile = screen.getByRole('region', { name: 'Card reports' });
    expect(within(tile).getByRole('heading', { name: 'Card reports' })).toBeTruthy();
    expect(within(tile).getByText('Open').nextSibling?.textContent).toBe('3');
    expect(within(tile).getByText('New in 7 days').nextSibling?.textContent).toBe('2');
    expect(within(tile).getByRole('link', { name: 'Open card reports' }).getAttribute('href')).toBe('/reports');
  });

  it('is hidden when the server sends no cardReports block', () => {
    mount(statusFixture());
    expect(screen.queryByRole('region', { name: 'Card reports' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open card reports' })).toBeNull();
  });

  it('is normalised from the status response only when present', async () => {
    const raw = { ...statusFixture(), cardReports: { open: 4, openedLast7d: 'many', extra: true } };
    serve(ok(raw));
    const res = await fetchAutomationStatus();
    expect(res.data?.cardReports).toEqual({ open: 4, openedLast7d: 0 });

    serve(ok(statusFixture()));
    const older = await fetchAutomationStatus();
    expect(older.success).toBe(true);
    expect(older.data && 'cardReports' in older.data).toBe(false);

    serve(ok({ ...statusFixture(), cardReports: 'nope' }));
    const junk = await fetchAutomationStatus();
    expect(junk.data && 'cardReports' in junk.data).toBe(false);
  });
});

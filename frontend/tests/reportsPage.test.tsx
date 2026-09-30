// @vitest-environment jsdom
//
// The /reports console page (R20 contract §4 console routes, §8): learner card
// reports listed, filtered, resolved with an optimistic update, paged with
// nextCursor, and a neutral callout on a server without the migration.
// src/api/cardReports and the deck list are mocked, so nothing here can leave
// the process; the session is a real token through tests/support/consoleSession.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsEditor, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { consoleSectionFor } from '../src/components/console/consoleNav';
import { documentTitleFor } from '../src/lib/brand';
import type { ApiResult } from '../src/types/api';
import type { CardReport, CardReportResolveResult, CardReportsPage } from '../src/api/cardReports';
import type { Deck } from '../src/types/deck';

const api = vi.hoisted(() => ({
  listCardReports: vi.fn(),
  resolveCardReport: vi.fn(),
}));

const authoring = vi.hoisted(() => ({
  fetchDecks: vi.fn(),
}));

vi.mock('../src/api/cardReports', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/cardReports')>();
  return { ...actual, ...api };
});

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...authoring };
});

const { ReportsPage } = await import('../src/pages/ReportsPage');

const NOW = Date.parse('2026-10-01T12:00:00Z');

function report(overrides: Partial<CardReport> = {}): CardReport {
  return {
    reportId: 41,
    deckId: 7,
    deckSlug: 'aws-saa-c03',
    cardId: 1203,
    stableUid: 'aws-saa-c03-0042',
    question: 'Which S3 storage class suits infrequent access?',
    reason: 'outdated',
    note: 'The answer names a retired tier.',
    status: 'open',
    resolution: null,
    resolutionNote: null,
    clientVersion: '1.10.0',
    createdAt: '2026-09-30T10:00:00Z',
    resolvedAt: null,
    ...overrides,
  };
}

function page(items: CardReport[], nextCursor: string | null = null): ApiResult<CardReportsPage> {
  return ok({ items, nextCursor });
}

const decks = [
  { id: 7, slug: 'aws-saa-c03', title: 'AWS SAA-C03' },
  { id: 9, slug: 'csharp-fundamentals', title: 'C# Fundamentals' },
] as Deck[];

function mountAt(path = '/reports') {
  return renderAt(
    <ConfirmDialogProvider>
      <ReportsPage />
    </ConfirmDialogProvider>,
    [path],
  );
}

async function mountLoaded(path = '/reports') {
  mountAt(path);
  await screen.findByRole('table', { name: 'Card reports' });
  await act(async () => {});
}

function rowFor(question: string): HTMLElement {
  const cell = within(screen.getByRole('table', { name: 'Card reports' })).getByText(question);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${question}`);
  return row as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const fn of [...Object.values(api), ...Object.values(authoring)]) fn.mockReset();
  api.listCardReports.mockResolvedValue(page([report()]));
  authoring.fetchDecks.mockResolvedValue(ok(decks));
  signInAsEditor();
});

afterEach(() => {
  cleanup();
  signOut();
  vi.useRealTimers();
});

describe('ReportsPage', () => {
  it('is a named console section with its own tab title', () => {
    expect(documentTitleFor('/reports')).toBe('Card reports · DeveloperCards Console');
    expect(consoleSectionFor('/reports')).toBe('reports');
  });

  it('lists open reports by default: deck, question, reason badge, note, age, status and an editor link', async () => {
    await mountLoaded();
    expect(api.listCardReports).toHaveBeenCalledWith({ status: 'open', deckId: null, cursor: null });

    expect(screen.getByRole('heading', { level: 1, name: 'Card reports' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    expect(within(nav).getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');

    const table = screen.getByRole('table', { name: 'Card reports' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map(th => th.textContent);
    expect(headers).toEqual(['Deck', 'Card question', 'Reason', 'Note', 'Age', 'Status', 'Actions']);

    const row = rowFor('Which S3 storage class suits infrequent access?');
    expect(within(row).getByText('aws-saa-c03')).toBeTruthy();
    expect(within(row).getByText('Outdated')).toBeTruthy();
    expect(within(row).getByText('The answer names a retired tier.')).toBeTruthy();
    expect(within(row).getByText('26 h ago')).toBeTruthy();
    expect(within(row).getByText('Open')).toBeTruthy();
    const editor = within(row).getByRole('link', { name: /^Open in editor/ });
    expect(editor.getAttribute('href')).toBe('/decks/cards/edit?deckId=7&cardId=1203');
  });

  it('renders a learner note as plain text, never as markup', async () => {
    api.listCardReports.mockResolvedValue(page([report({ note: '<b>bold</b><img src=x onerror=alert(1)>' })]));
    await mountLoaded();
    const row = rowFor('Which S3 storage class suits infrequent access?');
    expect(within(row).getByText('<b>bold</b><img src=x onerror=alert(1)>')).toBeTruthy();
    expect(row.querySelector('b')).toBeNull();
    expect(row.querySelector('img')).toBeNull();
  });

  it('shows no editor link for a report whose card is gone', async () => {
    api.listCardReports.mockResolvedValue(page([report({ cardId: null })]));
    await mountLoaded();
    const row = rowFor('Which S3 storage class suits infrequent access?');
    expect(within(row).queryByRole('link', { name: /^Open in editor/ })).toBeNull();
    expect(within(row).getByText('Card deleted')).toBeTruthy();
  });

  it('filters by status and deck, and reads both from the URL', async () => {
    const user = userEvent.setup();
    await mountLoaded();

    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await waitFor(() =>
      expect(api.listCardReports).toHaveBeenLastCalledWith({ status: 'all', deckId: null, cursor: null }),
    );
    expect(screen.getByTestId('loc').textContent).toContain('status=all');

    const deckSelect = screen.getByLabelText('Deck');
    expect(within(deckSelect).getAllByRole('option').map(o => o.textContent)).toEqual([
      'All decks',
      'AWS SAA-C03 (aws-saa-c03)',
      'C# Fundamentals (csharp-fundamentals)',
    ]);
    await user.selectOptions(deckSelect, '9');
    await waitFor(() =>
      expect(api.listCardReports).toHaveBeenLastCalledWith({ status: 'all', deckId: 9, cursor: null }),
    );

    cleanup();
    api.listCardReports.mockClear();
    await mountLoaded('/reports?status=resolved&deckId=7');
    expect(api.listCardReports).toHaveBeenCalledWith({ status: 'resolved', deckId: 7, cursor: null });
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('resolved');
    expect((screen.getByLabelText('Deck') as HTMLSelectElement).value).toBe('7');
  });

  it('ignores an unknown status or a malformed deck id in the URL', async () => {
    await mountLoaded('/reports?status=bogus&deckId=abc');
    expect(api.listCardReports).toHaveBeenCalledWith({ status: 'open', deckId: null, cursor: null });
  });

  it('resolves a report through a labelled inline form, optimistically', async () => {
    const user = userEvent.setup();
    const pending = deferred<ApiResult<CardReportResolveResult>>();
    api.resolveCardReport.mockReturnValue(pending.promise);
    await mountLoaded();

    const row = rowFor('Which S3 storage class suits infrequent access?');
    await user.click(within(row).getByRole('button', { name: /^Resolve/ }));

    const form = screen.getByRole('form', { name: /^Resolve report/ });
    const resolution = within(form).getByLabelText('Resolution') as HTMLSelectElement;
    expect(Array.from(resolution.options).map(o => o.value)).toEqual(['fixed', 'wont_fix', 'duplicate', 'invalid']);
    const note = within(form).getByLabelText('Note (optional)') as HTMLTextAreaElement;
    expect(note.maxLength).toBe(500);
    expect(note.getAttribute('aria-describedby')).toBeTruthy();

    await user.selectOptions(resolution, 'duplicate');
    await user.type(note, 'Same as card 0041.');
    await user.click(within(form).getByRole('button', { name: 'Save resolution' }));

    // Before the server answers, the row already reads resolved and the form is gone.
    expect(api.resolveCardReport).toHaveBeenCalledWith(41, { resolution: 'duplicate', note: 'Same as card 0041.' });
    expect(screen.queryByRole('form', { name: /^Resolve report/ })).toBeNull();
    const optimistic = rowFor('Which S3 storage class suits infrequent access?');
    expect(within(optimistic).getByText('Resolved · Duplicate')).toBeTruthy();
    expect(within(optimistic).queryByRole('button', { name: /^Resolve/ })).toBeNull();

    await act(async () => pending.resolve(ok({ reportId: 41, status: 'resolved', resolution: 'duplicate' })));
    expect(within(rowFor('Which S3 storage class suits infrequent access?')).getByText('Resolved · Duplicate')).toBeTruthy();
    expect(screen.getByTestId('reports-live').textContent).toBe('Report resolved as Duplicate.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rolls the row back and says why when the resolve fails', async () => {
    const user = userEvent.setup();
    api.resolveCardReport.mockResolvedValue(refused('FORBIDDEN', 'You cannot write this deck.'));
    await mountLoaded();

    await user.click(within(rowFor('Which S3 storage class suits infrequent access?')).getByRole('button', { name: /^Resolve/ }));
    await user.click(screen.getByRole('button', { name: 'Save resolution' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('You cannot write this deck.'));
    const row = rowFor('Which S3 storage class suits infrequent access?');
    expect(within(row).getByText('Open')).toBeTruthy();
    expect(within(row).getByRole('button', { name: /^Resolve/ })).toBeTruthy();
    expect(api.resolveCardReport).toHaveBeenCalledWith(41, { resolution: 'fixed' });
  });

  it('closes the form on Cancel without calling the server', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.click(within(rowFor('Which S3 storage class suits infrequent access?')).getByRole('button', { name: /^Resolve/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: /^Resolve report/ })).toBeNull();
    expect(api.resolveCardReport).not.toHaveBeenCalled();
  });

  it('pages with Load more and nextCursor', async () => {
    const user = userEvent.setup();
    api.listCardReports
      .mockResolvedValueOnce(page([report()], 'c2'))
      .mockResolvedValueOnce(page([report({ reportId: 42, question: 'What does IAM stand for?', reason: 'typo' })]));
    await mountLoaded();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('What does IAM stand for?');
    expect(api.listCardReports).toHaveBeenLastCalledWith({ status: 'open', deckId: null, cursor: 'c2' });
    expect(screen.getByText('Which S3 storage class suits infrequent access?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a neutral callout, not an error, when the server has no card reports table yet', async () => {
    api.listCardReports.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NOT_READY', message: 'Run the database migration', httpStatus: 503 },
      traceId: '',
    });
    mountAt();
    expect(
      await screen.findByText('Card reports are not set up on the server yet (run the database migration)'),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Card reports' })).toBeNull();
  });

  it('shows any other load failure as an alert with the server message', async () => {
    api.listCardReports.mockResolvedValue(refused('FORBIDDEN', 'No deck access.'));
    mountAt();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No deck access.'));
  });

  it('says so when no report matches', async () => {
    api.listCardReports.mockResolvedValue(page([]));
    mountAt();
    expect(await screen.findByText('No card reports match these filters.')).toBeTruthy();
  });
});

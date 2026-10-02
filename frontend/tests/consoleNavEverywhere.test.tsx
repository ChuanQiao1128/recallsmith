// @vitest-environment jsdom
//
// frontend-console-7: the console's sections are reachable from every page,
// including the landing page. The review queue is the human gate of the
// authoring agent; before this, the deck list linked to none of Review queue,
// AI QA, Automation ledger or Webhooks, and each page passed its own subset.
//
// Two halves: the deck list really renders the links (mounted, API mocked),
// and every ConsoleShell under src/pages takes its destinations from
// consoleNav(), so a new page cannot quietly fall back to a private subset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import { ok } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { CONSOLE_NAV, consoleNav, consoleSectionFor } from '../src/components/console/consoleNav';
import { ConsoleShell } from '../src/components/console/ConsoleShell';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

// Resolved with node:path: under jsdom the global URL is jsdom's, which node's
// fileURLToPath rejects (the same reason tests/adminConsoleRequests.test.tsx gives).
const PAGES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/pages') + '/';

function navLinks(): Record<string, string | null> {
  const nav = screen.getByRole('navigation', { name: 'Console sections' });
  return Object.fromEntries(
    within(nav)
      .getAllByRole('link')
      .map(a => [(a.textContent ?? '').trim(), a.getAttribute('href')]),
  );
}

async function mountHome(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('navigation', { name: 'Console sections' });
}

beforeEach(() => {
  signOut();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(ok<AdminDecksPage>({ items: [], nextCursor: null, hasMore: false }));
  api.fetchDecks.mockResolvedValue(ok([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  signOut();
  localStorage.clear();
});

describe('the console sections on the landing page', () => {
  // B07 (frontend-console-12): the Automation console is in the shared set, so
  // the landing page links it too; before, only the four automation-area pages did.
  it('links a super_admin to Review queue, AI QA, Automation ledger, Automation and Webhooks', async () => {
    signInAsSuperAdmin();
    await mountHome();
    expect(navLinks()).toEqual({
      Reports: '/reports',
      Usage: '/usage',
      Webhooks: '/admin/webhooks',
      'Automation ledger': '/ledger',
      Automation: '/automation',
      'Review queue': '/review',
      'AI QA': '/decks/qa',
      'Admin Management': '/admin/users',
    });
  });

  it('gives an editor the same sections minus the super_admin ones', async () => {
    signInAsEditor();
    await mountHome();
    expect(navLinks()).toEqual({
      Reports: '/reports',
      Usage: '/usage',
      'Automation ledger': '/ledger',
      Automation: '/automation',
      'Review queue': '/review',
      'AI QA': '/decks/qa',
    });
  });
});

describe('the current section in the header (frontend-console-27)', () => {
  function shellAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ConsoleShell title="t" {...consoleNav()}>
          <p>body</p>
        </ConsoleShell>
      </MemoryRouter>,
    );
  }

  it('marks the link of the page on screen with aria-current and an active look, and no other', () => {
    signInAsSuperAdmin();
    for (const [path, name] of [
      ['/review?deckId=7', 'Review queue'],
      ['/decks/qa', 'AI QA'],
      ['/ledger', 'Automation ledger'],
      ['/automation', 'Automation'],
      ['/admin/webhooks', 'Webhooks'],
      ['/admin/users', 'Admin Management'],
      ['/reports', 'Reports'],
      ['/usage', 'Usage'],
      ['/decks/cards?deckId=7', 'Decks'],
      ['/', 'Decks'],
    ] as const) {
      shellAt(path);
      const nav = screen.getByRole('navigation', { name: 'Console sections' });
      const current = within(nav)
        .getAllByRole('link')
        .filter(a => a.getAttribute('aria-current') === 'page');
      expect(current.map(a => a.textContent), path).toEqual([name]);
      expect(current[0].className).toContain('bg-indigo-50');
      for (const link of within(nav).getAllByRole('link')) {
        expect(link.className, `${path} ${link.textContent}`).toContain('focus-visible:ring-2');
      }
      cleanup();
    }
    expect(consoleSectionFor('/login')).toBeNull();
    // R26 C01: the Content Intelligence page was retired with Snowflake; its path
    // is no longer a console section.
    expect(consoleSectionFor('/content-intelligence')).toBeNull();
  });

  it('orders the links authoring first, then the ledger and Automation, then the super_admin sections', () => {
    signInAsSuperAdmin();
    shellAt('/ledger');
    const nav = screen.getByRole('navigation', { name: 'Console sections' });
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual([
      'Decks',
      'Review queue',
      'AI QA',
      'Reports',
      'Usage',
      'Automation ledger',
      'Automation',
      'Webhooks',
      'Admin Management',
    ]);
  });
});

describe('consoleNav', () => {
  it('lists every section and lets a page override or drop one', () => {
    expect(consoleNav()).toEqual(CONSOLE_NAV);
    expect(Object.keys(CONSOLE_NAV).sort()).toEqual(
      [
        'adminUsersHref',
        'automationHref',
        'decksHref',
        'ledgerHref',
        'qaHref',
        'reportsHref',
        'reviewHref',
        'usageHref',
        'webhooksHref',
      ],
    );
    const scoped = consoleNav({ reviewHref: '/review?deckId=7', decksHref: undefined });
    expect(scoped.reviewHref).toBe('/review?deckId=7');
    expect(scoped.decksHref).toBeUndefined();
    expect(scoped.ledgerHref).toBe('/ledger');
  });

  it('is what every ConsoleShell under src/pages takes its destinations from', () => {
    const files = readdirSync(PAGES_DIR).filter(f => f.endsWith('.tsx'));
    let shells = 0;
    for (const file of files) {
      const source = readFileSync(`${PAGES_DIR}${file}`, 'utf8');
      const tags = source.match(/<ConsoleShell\b[\s\S]*?\n?\s*>/g) ?? [];
      for (const tag of tags) {
        shells += 1;
        expect(tag, `${file}: a ConsoleShell without consoleNav()`).toContain('{...consoleNav(');
        expect(tag, `${file}: a hard-coded destination next to consoleNav()`).not.toMatch(
          /\s(decksHref|reviewHref|qaHref|reportsHref|usageHref|ledgerHref|automationHref|webhooksHref|adminUsersHref)=/,
        );
      }
    }
    // Anti-vacuity: the pages render the shell in more than twenty places.
    expect(shells).toBeGreaterThan(20);
  });
});

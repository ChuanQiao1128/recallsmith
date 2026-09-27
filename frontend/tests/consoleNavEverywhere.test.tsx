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
import { CONSOLE_NAV, consoleNav } from '../src/components/console/consoleNav';

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
  it('links a super_admin to Review queue, AI QA, Automation ledger and Webhooks', async () => {
    signInAsSuperAdmin();
    await mountHome();
    expect(navLinks()).toEqual({
      'Content Intelligence': '/content-intelligence',
      Webhooks: '/admin/webhooks',
      'Automation ledger': '/ledger',
      'Review queue': '/review',
      'AI QA': '/decks/qa',
      'Admin Management': '/admin/users',
    });
  });

  it('gives an editor the same sections minus the super_admin ones', async () => {
    signInAsEditor();
    await mountHome();
    expect(navLinks()).toEqual({
      'Content Intelligence': '/content-intelligence',
      'Automation ledger': '/ledger',
      'Review queue': '/review',
      'AI QA': '/decks/qa',
    });
  });
});

describe('consoleNav', () => {
  it('lists every section and lets a page override or drop one', () => {
    expect(consoleNav()).toEqual(CONSOLE_NAV);
    expect(Object.keys(CONSOLE_NAV).sort()).toEqual(
      ['adminUsersHref', 'contentIntelligenceHref', 'decksHref', 'ledgerHref', 'qaHref', 'reviewHref', 'webhooksHref'],
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
          /\s(decksHref|contentIntelligenceHref|reviewHref|qaHref|ledgerHref|webhooksHref|adminUsersHref)=/,
        );
      }
    }
    // Anti-vacuity: the pages render the shell in more than twenty places.
    expect(shells).toBeGreaterThan(20);
  });
});

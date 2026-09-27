// frontend-console-13: the four HITL pages (Review queue, AI QA, Automation
// ledger, Webhooks) share one set of class strings from
// src/components/console/consoleStyles.ts instead of each redefining them.
// They had drifted: the primary action was outlined on two pages and filled
// on the other two, the H1 differed from the rest of the console, and the AI
// QA past-runs table had an empty header cell. Checked on the source, since
// the drift was in the source.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { H1_CLASS, PRIMARY_BUTTON_CLASS } from '../src/components/console/consoleStyles';

const PAGES = ['ReviewQueuePage', 'DeckQaPage', 'LedgerPage', 'WebhooksPage'];
const SHARED = ['BUTTON_CLASS', 'PRIMARY_BUTTON_CLASS', 'INPUT_CLASS', 'LABEL_CLASS', 'CARD_CLASS', 'H1_CLASS', 'H2_CLASS', 'TH_CLASS', 'TD_CLASS'];

function source(page: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/pages/${page}.tsx`, import.meta.url)), 'utf8');
}

describe('shared console styles on the HITL pages', () => {
  it('no page redefines a shared class constant', () => {
    for (const page of PAGES) {
      const text = source(page);
      expect(text, `${page} does not import consoleStyles`).toContain("from '../components/console/consoleStyles'");
      for (const name of SHARED) {
        expect(text, `${page} redefines ${name}`).not.toMatch(new RegExp(`const ${name}\\s*=`));
      }
    }
  });

  it('every page uses the console H1 and nothing else', () => {
    // The same heading the rest of the console uses (CardListPage).
    expect(H1_CLASS).toBe('text-xl font-semibold text-slate-800');
    expect(source('CardListPage')).toContain(`className="${H1_CLASS}"`);
    for (const page of PAGES) {
      const h1s = source(page).match(/<h1\b[^>]*>/g) ?? [];
      expect(h1s.length, `${page} has no h1`).toBeGreaterThan(0);
      for (const h1 of h1s) expect(h1, page).toBe('<h1 className={H1_CLASS}>');
    }
  });

  it('has one primary action style, filled', () => {
    expect(PRIMARY_BUTTON_CLASS).toContain('bg-indigo-600');
    expect(PRIMARY_BUTTON_CLASS).not.toContain('border-slate-300');
  });

  it('leaves no header cell without a name', () => {
    for (const page of PAGES) {
      expect(source(page), `${page} has an empty <th />`).not.toMatch(/<th\b[^>]*\/>/);
    }
  });
});

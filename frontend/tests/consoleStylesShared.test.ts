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

import * as consoleStyles from '../src/components/console/consoleStyles';

const { H1_CLASS, INPUT_CLASS, INPUT_INVALID_CLASS } = consoleStyles;

const PAGES = ['ReviewQueuePage', 'DeckQaPage', 'LedgerPage', 'WebhooksPage'];
const SHARED = [
  'BUTTON_CLASS',
  'PRIMARY_BUTTON_CLASS',
  'INPUT_CLASS',
  'INPUT_INVALID_CLASS',
  'FIELD_ERROR_CLASS',
  'LABEL_CLASS',
  'CARD_CLASS',
  'H1_CLASS',
  'H2_CLASS',
  'TH_CLASS',
  'TD_CLASS',
];

function uiSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/components/ui/${name}.tsx`, import.meta.url)), 'utf8');
}

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

  it('has one primary action style, filled: ui/Button primary', () => {
    // frontend-console-22: the parallel PRIMARY_BUTTON_CLASS / BUTTON_CLASS
    // constants are gone; the pages render ui/Button, whose primary is filled.
    expect(Object.keys(consoleStyles)).not.toContain('PRIMARY_BUTTON_CLASS');
    expect(Object.keys(consoleStyles)).not.toContain('BUTTON_CLASS');
    const button = uiSource('Button');
    expect(button).toMatch(/variant === 'primary'\s*\?\s*'bg-indigo-600 /);
    for (const page of PAGES) {
      const text = source(page);
      expect(text, `${page} does not use ui/Button`).toContain("import { Button } from '../components/ui/Button';");
      expect(text, `${page} still uses a parallel button class`).not.toMatch(/BUTTON_CLASS/);
      // Every action is a ui/Button; the only raw <button> left is the review
      // queue's selectable draft row, which carries the same ring.
      const raw = text.match(/<button\b/g) ?? [];
      expect(raw.length, `${page} renders a raw <button>`).toBe(page === 'ReviewQueuePage' ? 1 : 0);
    }
    expect(source('ReviewQueuePage')).toContain('focus-visible:ring-2 focus-visible:ring-indigo-500');
  });

  it('gives buttons and inputs the console focus ring (frontend-console-22)', () => {
    // The same ring as ui/Button and the CardForm / CardListPage inputs.
    expect(uiSource('Button')).toContain('focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2');
    expect(INPUT_CLASS).toContain('focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500');
    expect(INPUT_INVALID_CLASS).toContain('focus:outline-none focus:ring-2');
    expect(INPUT_INVALID_CLASS).toContain('border-red-400');
  });

  it('styles page errors one way: a danger Callout (frontend-console-22)', () => {
    for (const page of PAGES) {
      const text = source(page);
      // No bare red div as an alert, and no hand-rolled red-50 box.
      expect(text, `${page} has a plain red alert div`).not.toMatch(/<div role="alert" className="[^"]*text-red/);
      expect(text, `${page} has a hand-rolled red box`).not.toContain('bg-red-50');
      // A field's one-line error uses the shared class.
      for (const p of text.match(/<p\b[^>]*role="alert"[^>]*>/g) ?? []) {
        expect(p, `${page}: ${p}`).toContain('FIELD_ERROR_CLASS');
      }
    }
  });

  it('leaves no header cell without a name', () => {
    for (const page of PAGES) {
      expect(source(page), `${page} has an empty <th />`).not.toMatch(/<th\b[^>]*\/>/);
    }
  });
});

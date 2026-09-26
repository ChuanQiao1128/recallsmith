// tests/support/routerProbe.tsx
//
// Mount a page under a router and be able to read where it navigated to.
//
// The router is a DATA router (createMemoryRouter + RouterProvider), not a plain
// <MemoryRouter>. Pages that call useBlocker — the unsaved-changes guard on the
// card and deck editors — only work under a data router, and a plain
// MemoryRouter throws "useBlocker must be used within a data router". A single
// splat route renders `ui` beside the probe, so navigate() still updates history
// without unmounting either, exactly as before.
//
// The probe component itself is in tests/support/locationProbe.tsx rather than
// here: react-refresh/only-export-components is an error in this repo's eslint
// config, and it fires on any module that defines a component next to ordinary
// helpers. Splitting is the fix the rule actually asks for, and it was reached
// by running the linter rather than by guessing — the first version of this
// file defined LocationProbe inline and failed twice, once for exporting it and
// once for merely defining it.
//
// renderAt deliberately does NOT wrap anything in QueryClientProvider.
// DeckEditPage, NewDeckPage and ContentIntelligencePage call the api module
// directly with useEffect/useState; adding a provider they do not use would
// suggest a caching layer that is not there.
//
// NOT collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { LocationProbe } from './locationProbe';

/** Mount `ui` under a data router starting at `entries`, with the probe beside it. */
export function renderAt(ui: ReactElement, entries: string[]) {
  const router = createMemoryRouter(
    [{ path: '*', element: <>{ui}<LocationProbe /></> }],
    { initialEntries: entries },
  );
  return render(<RouterProvider router={router} />);
}

/** The probe's current text, e.g. "/decks/cards?deckId=7". */
export function locationText(doc: Document = document): string {
  const el = doc.querySelector('[data-testid="loc"]');
  return el?.textContent ?? '';
}

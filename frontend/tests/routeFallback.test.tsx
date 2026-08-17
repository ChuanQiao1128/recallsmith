// @vitest-environment jsdom
//
// The Suspense fallback must not be blank.
//
// A `<Suspense fallback={null}>` compiles, type-checks, ships, and shows the
// user nothing at all while a route chunk downloads — on a slow connection that
// is a white screen of unknown duration. There is no build output and no lint
// rule that can tell the two apart, so it is asserted here.
//
// The lazy component below never resolves on purpose. That freezes the tree in
// its pending state, which is the only state worth looking at.

import { afterEach, describe, expect, it } from 'vitest';
import { Suspense, lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';

import { RouteFallback } from '../src/components/RouteFallback';

afterEach(() => {
  cleanup();
});

/** A route whose chunk is permanently in flight. */
const NeverArrives = lazy(() => new Promise<never>(() => {}));

describe('the route fallback', () => {
  it('shows the console loading screen while a route chunk is in flight', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<NeverArrives />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Loading console…')).not.toBeNull();
  });

  it('uses the same wording and palette as the page-level loading screen', () => {
    // Pinned as text + classes rather than a snapshot so the assertion says what
    // it is protecting: this is the string DeckListPage shows for its own first
    // load, ellipsis character included (U+2026, not three periods).
    const { container } = render(<RouteFallback />);

    const shell = container.querySelector('.min-h-screen');
    expect(shell).not.toBeNull();
    expect(shell?.className).toBe(
      'min-h-screen flex items-center justify-center bg-slate-100',
    );

    const label = container.querySelector('.text-slate-600');
    expect(label?.textContent).toBe('Loading console…');
  });
});

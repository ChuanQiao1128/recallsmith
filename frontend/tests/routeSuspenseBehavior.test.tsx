// @vitest-environment jsdom
//
// What route splitting actually feels like, pinned as observed behaviour.
//
// ---------------------------------------------------------------------------
// THE FINDING
// ---------------------------------------------------------------------------
// A single top-level <Suspense> does NOT make every route change flash a
// loading screen. Measured here:
//
//   initial mount on a lazy route  -> fallback IS shown
//   client-side navigation to one  -> fallback is NOT shown; the PREVIOUS page
//                                     stays on screen until the chunk lands
//
// So the real cost of this split is not a flicker. It is that clicking a nav
// link to a page whose chunk is not cached yet produces no visible response at
// all — the old screen just sits there for however long the download takes, and
// an impatient user clicks again. That is harder to notice than a flicker and
// worse to experience, and it appears in no build output, no lint rule and no
// bundle report. It is only observable by driving the router.
//
// The cause is React's transition semantics: react-router wraps navigation
// state updates in startTransition, and React will not replace already-visible
// content with a fallback for a transition update. Note that this reproduces
// under MemoryRouter as well as BrowserRouter, so it is not an artifact of one
// router's history implementation.
//
// ---------------------------------------------------------------------------
// THIS FILE ASSERTS WHAT IS, NOT WHAT WOULD BE NICE
// ---------------------------------------------------------------------------
// These are characterization tests. They were written by probing the real
// behaviour and recording it, deliberately NOT by deciding what should happen
// and changing the design until it did. Fixing this is a UX decision with real
// trade-offs (see the step report): per-route Suspense boundaries make every
// navigation respond instantly but make small fast chunks flash, and a
// delayed-fade fallback needs new CSS and a tuned threshold. Whoever picks one
// will flip the assertions here on purpose, and the diff will say what they
// chose.

import { afterEach, describe, expect, it } from 'vitest';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, render, screen } from '@testing-library/react';

import { RouteFallback } from '../src/components/RouteFallback';

afterEach(() => {
  cleanup();
});

/** A route chunk that is permanently still downloading. */
const Never = lazy(() => new Promise<never>(() => {}));

function Home() {
  return (
    <div>
      <span>home page</span>
      <Link to="/slow">go slow</Link>
    </div>
  );
}

function tree(Router: typeof MemoryRouter | typeof BrowserRouter, entries?: string[]) {
  const routes = (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/slow" element={<Never />} />
      </Routes>
    </Suspense>
  );
  return Router === MemoryRouter ? (
    <MemoryRouter initialEntries={entries ?? ['/']}>{routes}</MemoryRouter>
  ) : (
    <BrowserRouter>{routes}</BrowserRouter>
  );
}

describe('landing directly on a route whose chunk is still loading', () => {
  it('shows the fallback, because there is nothing else to show', () => {
    render(tree(MemoryRouter, ['/slow']));

    expect(screen.queryByText('Loading console…')).not.toBeNull();
  });
});

describe('navigating to a route whose chunk is still loading', () => {
  it('keeps the previous page on screen and shows NO fallback (BrowserRouter)', async () => {
    window.history.pushState({}, '', '/');
    render(tree(BrowserRouter));
    expect(screen.queryByText('home page')).not.toBeNull();

    await act(async () => {
      screen.getByText('go slow').click();
      await Promise.resolve();
    });

    // The observed behaviour: no loading indicator, old page still rendered.
    // A user on a slow connection gets zero feedback that their click landed.
    expect(screen.queryByText('Loading console…')).toBeNull();
    expect(screen.queryByText('home page')).not.toBeNull();
  });

  it('behaves identically under MemoryRouter, so it is not a history quirk', async () => {
    render(tree(MemoryRouter, ['/']));

    await act(async () => {
      screen.getByText('go slow').click();
      await Promise.resolve();
    });

    expect(screen.queryByText('Loading console…')).toBeNull();
    expect(screen.queryByText('home page')).not.toBeNull();
  });
});

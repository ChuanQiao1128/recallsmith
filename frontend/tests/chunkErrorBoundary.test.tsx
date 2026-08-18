// @vitest-environment jsdom
//
// The failure path route splitting adds, and the reason its button reloads.
//
// Test 3 is the one worth reading. It pins React's caching of a lazy rejection:
// once the import factory rejects, the payload is marked failed and re-rendering
// re-throws the same error rather than retrying the download. That is why the
// boundary offers a reload and not a "try again" that resets state — a state
// reset would render a button that can never succeed. If a future React changes
// that semantic, test 3 goes red and the button can be reconsidered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, render, screen } from '@testing-library/react';

import { ChunkErrorBoundary } from '../src/components/ChunkErrorBoundary';
import { RouteFallback } from '../src/components/RouteFallback';

/** Exactly what a 404'd or network-cut chunk request produces. */
const CHUNK_ERROR = 'Failed to fetch dynamically imported module: /assets/DeckListPage-abc123.js';

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs caught render errors itself; silence keeps the run readable
  // without hiding a real assertion.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
  vi.restoreAllMocks();
});

function renderFailingRoute() {
  const Failing = lazy(() => Promise.reject(new Error(CHUNK_ERROR)));
  return render(
    <ChunkErrorBoundary>
      <MemoryRouter initialEntries={['/']}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Failing />} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </ChunkErrorBoundary>,
  );
}

describe('a route chunk that fails to load', () => {
  it('shows a recoverable message instead of unmounting the app', async () => {
    const { container } = renderFailingRoute();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('This page did not finish loading')).not.toBeNull();
    // The whole point: the tree is still there. An unhandled lazy rejection
    // empties the container completely.
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it('reloads the page exactly once when the button is clicked', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    renderFailingRoute();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      screen.getByText('Reload').click();
    });

    // Asserting the count, not just "was called": a button wired to the wrong
    // handler and a button wired to none look identical from the outside.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the error after a re-render, which is why the button reloads', async () => {
    const { rerender } = renderFailingRoute();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('This page did not finish loading')).not.toBeNull();

    // React caches the rejection on the lazy payload, so re-rendering cannot
    // retry the import. A state-resetting "Retry" button would land right back
    // here, every time, with no feedback.
    await act(async () => {
      rerender(
        <ChunkErrorBoundary>
          <MemoryRouter initialEntries={['/']}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<div>recovered</div>} />
              </Routes>
            </Suspense>
          </MemoryRouter>
        </ChunkErrorBoundary>,
      );
    });

    expect(screen.queryByText('This page did not finish loading')).not.toBeNull();
    expect(screen.queryByText('recovered')).toBeNull();
  });
});

// A boundary catches everything under it, not only the failure it was named
// after. These cases pin the two consequences of that, both of which the first
// version of this component got wrong.
describe('an ordinary crash is not reported as a failed download', () => {
  function Crashes(): never {
    throw new Error('Cannot read properties of undefined (reading map)');
  }

  it('does not blame the network for a bug in the page', () => {
    render(
      <ChunkErrorBoundary>
        <Crashes />
      </ChunkErrorBoundary>,
    );

    // The wording matters more than it looks. Telling someone their connection
    // dropped sends them to fix a thing that is not broken, and buries a real
    // defect under an infrastructure story.
    expect(screen.queryByText('This page did not finish loading')).toBeNull();
    expect(screen.queryByText('This page hit an error')).not.toBeNull();
  });

  it('offers a way out of the route, because reloading would replay the crash', () => {
    render(
      <ChunkErrorBoundary>
        <Crashes />
      </ChunkErrorBoundary>,
    );

    // A missing chunk is usually gone for one request; a component that
    // dereferences undefined will do it again on every reload. The escape has
    // to leave the route, not repeat it.
    expect(screen.queryByRole('button', { name: 'Back to decks' })).not.toBeNull();
  });

  it('still calls a genuine chunk failure what it is', async () => {
    renderFailingRoute();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('This page did not finish loading')).not.toBeNull();
    // No escape hatch here: reloading is the action that can actually succeed,
    // and a second button would dilute it.
    expect(screen.queryByRole('button', { name: 'Back to decks' })).toBeNull();
  });
});

describe('the error screen does not outlive the route that caused it', () => {
  function Crashes(): never {
    throw new Error('boom');
  }

  it('clears when the user navigates somewhere else', () => {
    const { rerender } = render(
      <ChunkErrorBoundary resetKey="/decks/cards">
        <Crashes />
      </ChunkErrorBoundary>,
    );
    expect(screen.queryByText('This page hit an error')).not.toBeNull();

    // Without this, one flaky chunk request pins the error screen for the rest
    // of the session — including routes whose chunks were cached long ago.
    // Navigation is the safe reset because it is the event that replaces the
    // subtree that threw.
    rerender(
      <ChunkErrorBoundary resetKey="/">
        <div>deck list</div>
      </ChunkErrorBoundary>,
    );

    expect(screen.queryByText('This page hit an error')).toBeNull();
    expect(screen.queryByText('deck list')).not.toBeNull();
  });

  it('stays put while the user is still on the route that failed', () => {
    const { rerender } = render(
      <ChunkErrorBoundary resetKey="/decks/cards">
        <Crashes />
      </ChunkErrorBoundary>,
    );

    // A re-render for any other reason must not clear it, or the crashing
    // subtree gets mounted again and throws again.
    rerender(
      <ChunkErrorBoundary resetKey="/decks/cards">
        <Crashes />
      </ChunkErrorBoundary>,
    );

    expect(screen.queryByText('This page hit an error')).not.toBeNull();
  });
});

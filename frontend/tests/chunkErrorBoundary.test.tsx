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

    expect(screen.queryByText('页面资源加载失败')).not.toBeNull();
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
      screen.getByText('重新加载').click();
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

    expect(screen.queryByText('页面资源加载失败')).not.toBeNull();

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

    expect(screen.queryByText('页面资源加载失败')).not.toBeNull();
    expect(screen.queryByText('recovered')).toBeNull();
  });
});

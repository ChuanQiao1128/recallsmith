// tests/support/queryTestClient.tsx
//
// Render helper for pages that read through react-query.
//
// Why a fresh QueryClient per render instead of importing the app's singleton
// from src/api/queryClient: that singleton is configured for a browser session
// (staleTime 5min, gcTime 10min, retry 1, refetchOnWindowFocus true). Sharing
// it across test cases lets the second test read the first test's cache, so a
// page can render data while its mocked fetcher is never called — a green test
// that proves nothing. That is the test-suite shape of the exact bug class this
// console keeps hitting: the feature looks present but is not wired.
//
// retry is off on purpose too. With the default retry: 1 plus a 1000ms backoff,
// every error-path assertion would have to outwait a retry that the page under
// test does not want, and waitFor's 1000ms default would expire first.
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { queryClient as appQueryClient } from '../../src/api/queryClient';

/** A QueryClient with every ambient behaviour a test cannot control turned off. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * A fresh client carrying the *application's* defaults.
 *
 * Needed because makeTestQueryClient above is a poor witness for one specific
 * class of claim. A hook that turns off retrying, refetch-on-focus or caching
 * is overriding what the real app would otherwise do — and under a test client
 * that already has all of those off, deleting the override changes nothing and
 * the test stays green. Anything asserting "this page still fetches the way it
 * did before react-query" has to run against the settings it is overriding.
 *
 * The defaults are read off the app's own singleton rather than copied, so the
 * two cannot drift apart; only the options are borrowed, never the cache.
 */
export function makeAppDefaultsQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() });
}

export type RenderWithQueryResult = RenderResult & { client: QueryClient };

/** Mount `ui` under a caller-supplied client, so one client can serve two mounts. */
export function renderWithClient(
  client: QueryClient,
  ui: ReactElement,
  initialEntries: string[],
): RenderWithQueryResult {
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

  return { client, ...rendered };
}

/**
 * Mount `ui` under a private QueryClient and a MemoryRouter.
 *
 * The client is returned so a test can assert against the cache directly:
 * only a component that actually calls a hook keyed by QueryKeys can put
 * anything there, which is the difference between "the page shows a row" and
 * "the page reads that row through the data layer".
 */
export function renderWithQuery(
  ui: ReactElement,
  initialEntries: string[],
): RenderWithQueryResult {
  return renderWithClient(makeTestQueryClient(), ui, initialEntries);
}

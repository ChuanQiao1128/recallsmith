// @vitest-environment jsdom
//
// The shared QueryClient's defaults, and the rule they now follow.
//
// They used to be staleTime 5min / gcTime 10min / retry 1 /
// refetchOnWindowFocus true — a sensible profile for an application whose
// writes invalidate their caches, applied to one that had none. Both hooks that
// existed overrode all four, line by line, so the settings governed zero lines
// of behaviour. That is not harmless: a default nothing exercises is a default
// nobody has tested, and the next hook written would have inherited a
// five-minute window in a console where creating a card told the deck list
// nothing.
//
// The rule the new set follows is: a global default describes behaviour that is
// SAFE for the system as it stands; a page that can prove an optimisation is
// safe there opts into it.
//
// WHERE THE WITNESSES ARE. The behaviour of the four query settings is asserted
// in tests/cardListPageQueryWiring.test.tsx, whose "fetching still behaves the
// way it did before react-query" block mounts a real page against a client
// carrying these defaults. Those three cases used to prove the HOOKS overrode a
// dangerous default; now they prove the default is not dangerous. That swap only
// holds while the hooks stay out of it, which is the last block in this file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';

import { queryClient } from '../src/api/queryClient';
import { ok } from './support/apiResult';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  deleteCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const hooks = await import('../src/hooks');

// Resolved with node:path rather than `new URL(..., import.meta.url)`, for the
// reason tests/adminConsoleRequests.test.tsx records: Vite rewrites that idiom
// as an asset reference, and under jsdom the rewritten form resolves against
// the document's http://localhost base, which fileURLToPath then rejects.
const HOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/hooks');

function hookSource(name: string): string {
  return readFileSync(resolve(HOOKS_DIR, name), 'utf8');
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Same reason the other files reset it: the manager is module state, and a
  // pinned offline flag would follow this file into the next one and pause
  // every mutation there.
  onlineManager.setOnline(true);
  signOut();
});

describe('the conservative defaults', () => {
  it('are the ones the application ships', () => {
    // A configuration ratchet, and stated as one. It cannot show that any of
    // these values does anything — the behavioural cases live in
    // cardListPageQueryWiring — but it is the only thing that fails when the
    // aggressive profile is put back, which is a specific and likely edit:
    // every one of these five is a plausible "optimisation" on its own.
    const queries = queryClient.getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(0);
    expect(queries?.gcTime).toBe(0);
    expect(queries?.retry).toBe(false);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.refetchOnReconnect).toBe(false);
    expect(queries?.networkMode).toBe('always');
  });

  it('do not carry a retryDelay, which could only ever have been decoration', () => {
    // It spelled out react-query's own exponential backoff, and under
    // retry: false it could not run. A line that is both a copy of the
    // library's behaviour and unreachable reads like a setting and is not one.
    expect(queryClient.getDefaultOptions().queries?.retryDelay).toBeUndefined();
  });

  it('never retry a mutation on their own', () => {
    // The one default that was already right. A write that may have landed must
    // not be replayed by the client without a person asking.
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('a write attempted while the browser says it is offline', () => {
  it('goes out and fails, instead of being parked with no way to notice', async () => {
    // react-query's default mutation networkMode is 'online', which does not
    // call mutationFn at all while offline: mutate() resolves nothing, the
    // observer sits at 'paused', and a Save button simply goes quiet. There is
    // no offline queue in this console and no UI that says a write is waiting,
    // so quiet is indistinguishable from broken. The api layer already turns a
    // dropped request into a failure result the page knows how to show.
    api.deleteCard.mockResolvedValue(ok(null));
    onlineManager.setOnline(false);

    const { result } = renderHook(() => hooks.useDeleteCard());
    void result.current.mutateAsync({ cardId: 1, deckId: 7 });

    await waitFor(() => expect(api.deleteCard).toHaveBeenCalledTimes(1));
  });
});

describe('the hooks do not restate what the defaults already say', () => {
  // This is what keeps the three cases in cardListPageQueryWiring sharp.
  //
  // Those cases mount a page against the application's defaults to show that a
  // window regaining focus does not refetch, that a second visit reloads, and
  // that a refusal is not retried. Every one of them passes whether the setting
  // comes from the client or from the hook — so the moment a hook writes
  // `staleTime: 0` again, the default could be five minutes and all three would
  // stay green while the console shipped stale lists.
  const RESTATED = ['staleTime', 'gcTime', 'retry', 'refetchOnWindowFocus', 'refetchOnReconnect'];

  it('leaves all five to the shared client', () => {
    const offenders: string[] = [];

    for (const file of ['useCards.ts', 'useDecks.ts']) {
      const source = hookSource(file);
      for (const option of RESTATED) {
        // `retry` is a prefix of nothing else here, and the colon is what keeps
        // this from matching the word in a comment.
        if (new RegExp(`^\\s*${option}\\s*:`, 'm').test(source)) {
          offenders.push(`${file}: ${option}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('still states networkMode, which the plan for this step kept explicit', () => {
    // The exception, and it is deliberate rather than an oversight: it is the
    // one option whose absence produces a spinner that never ends rather than a
    // number that is out of date, so it is written in both places on purpose.
    for (const file of ['useCards.ts', 'useDecks.ts']) {
      expect(hookSource(file)).toMatch(/^\s*networkMode: 'always',/m);
    }
  });

  it('read real files, so the scan cannot pass by finding nothing', () => {
    for (const file of ['useCards.ts', 'useDecks.ts']) {
      expect(hookSource(file).length).toBeGreaterThan(1000);
    }
  });
});

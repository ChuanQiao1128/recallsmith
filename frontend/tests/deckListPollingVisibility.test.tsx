// @vitest-environment jsdom
//
// F24 / CFE-22. The publish-jobs poll must pause while the browser tab is hidden
// and resume the instant it is shown again — one idle tab left open otherwise
// costs ~2,880 Lambda + Postgres calls a day.
//
// These are wiring tests, not decision tests: whether the timer is armed lives
// only inside the mounted component, so the component is mounted with fake timers
// exactly as deckListPagePolling.test.tsx does. The pause is driven the way the
// browser drives it — by flipping document.visibilityState and dispatching a
// visibilitychange event — and the property is restored in afterEach so no other
// file inherits a frozen visibility state.
//
// The trap this guards against: a deliberate pause must NOT look like the
// "auto-refresh stopped" state. Both clear the timer, but only a real stop owes
// the user a banner and a retry button. A pause is invisible and self-healing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import { POLL_IDLE_MS } from '../src/lib/publishJobsPolling';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

const POLL_LOG_PREFIX = 'Failed to load publish jobs:';
let consoleError: ReturnType<typeof vi.spyOn>;

// The visibility state the mocked getter reports. afterEach restores the real
// property descriptor so this override cannot leak into another test file.
let visibility: DocumentVisibilityState = 'visible';
const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function emptyDecksPage(): ApiResult<AdminDecksPage> {
  return { success: true, data: { items: [], nextCursor: null, hasMore: false }, error: null, traceId: 'trace-decks' };
}

function noJobs(): ApiResult<PublishJob[]> {
  return { success: true, data: [], error: null, traceId: 'trace-jobs' };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <DeckListPage />
    </MemoryRouter>,
  );
  await settle();
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  api.fetchAdminDecksPage.mockResolvedValue(emptyDecksPage());
  api.fetchPublishJobs.mockResolvedValue(noJobs());
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalVisibility) {
    Object.defineProperty(document, 'visibilityState', originalVisibility);
  }

  const unexpected = (consoleError.mock.calls as unknown[][]).filter(
    call => String(call[0]) !== POLL_LOG_PREFIX,
  );
  consoleError.mockRestore();
  expect(unexpected).toEqual([]);

  vi.clearAllMocks();
  signOut();
});

describe('the publish-jobs poll pauses while the tab is hidden', () => {
  it('stops polling while the tab is hidden and does not claim auto-refresh stopped', async () => {
    await mountConsole();

    // The mount poll fired once and armed the idle timer.
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);

    // Hide the tab: the armed timer is disarmed, so time passing no longer polls.
    await act(async () => {
      setVisibility('hidden');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 3);
    });
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);

    // A pause is not a stop: the "auto-refresh stopped" banner and its retry must
    // stay away, or the user reads a self-healing pause as a broken poll.
    expect(screen.queryByText(/auto-refresh stopped/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /auto-refresh stopped/i })).toBeNull();
  });

  it('polls at once when the tab becomes visible again', async () => {
    await mountConsole();
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility('hidden');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 3);
    });
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);

    // Coming back fires a poll immediately, without waiting for the next tick of
    // any cadence.
    await act(async () => {
      setVisibility('visible');
    });
    await settle();
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(2);
  });
});

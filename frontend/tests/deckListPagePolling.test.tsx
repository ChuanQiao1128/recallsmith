// @vitest-environment jsdom
//
// Wiring tests for the publish-jobs poll on DeckListPage.
//
// Why these are not more cases in publishJobsPolling.test.ts: the pure decision
// function is already covered exhaustively, and it stayed green through a
// mutation that killed the poll outright. It has to: nextPollDelay never
// returns stopped: true, so no assertion over its output can notice that the
// page dropped the reschedule on the floor. The reschedule only exists as a
// timer inside a mounted component, which is why the test mounts one.
//
// The mutation these tests are built to fail against is
//
//   if (false && !decision.stopped) { pollTimerRef.current = setTimeout(...) }
//
// which is the original bug: a resolved-but-unsuccessful response leaves the
// page permanently not polling. Note what does NOT change under it: the error
// banner is still rendered, because pollFailure is set independently. So
// "a banner appeared" is not a test of this invariant. What changes is that no
// second request is ever made, and that the page starts telling the user
// auto-refresh has stopped. Both are asserted below.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import { KIND_LABEL, POLL_STALE_SUFFIX } from '../src/lib/errorFeed';
import { POLL_IDLE_MS } from '../src/lib/publishJobsPolling';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';

// vi.mock is hoisted above the imports, so the spies have to be created in a
// hoisted block or they would be in the temporal dead zone when the factory
// runs.
const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
}));

// Spread the real module rather than replacing it: DeckListPage also imports
// ADMIN_DECKS_ENDPOINT_MISSING and builds its 403/404 fallback set from it, and
// a hand-written stub of that constant would let the fallback branch drift away
// from the code under test without any test noticing.
vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

const SOFT_FAILURE_MESSAGE = 'Publish job history is temporarily unavailable.';
const THROWN_FAILURE_MESSAGE = 'socket hang up';

// The page logs its own poll failures. Recording the calls lets the suite stay
// quiet without going blind: React reports "not wrapped in act(...)" and every
// other rendering complaint through the same channel, so anything that is not
// this one prefix is surfaced as a failure in afterEach.
const POLL_LOG_PREFIX = 'Failed to load publish jobs:';
let consoleError: ReturnType<typeof vi.spyOn>;

function emptyDecksPage(): ApiResult<AdminDecksPage> {
  return {
    success: true,
    data: { items: [], nextCursor: null, hasMore: false },
    error: null,
    traceId: 'trace-decks',
  };
}

/** HTTP 200 carrying success: false. The exact shape that used to be dropped. */
function softFailure(): ApiResult<PublishJob[]> {
  return {
    success: false,
    data: null,
    error: { code: 'PUBLISH_JOBS_UNAVAILABLE', message: SOFT_FAILURE_MESSAGE },
    traceId: 'trace-jobs',
  };
}

/**
 * Let every promise the mount kicked off settle, without moving a timer.
 *
 * Advancing by zero drains the microtask queue between turns, and the mount
 * does two awaited fetches whose resolutions each schedule more React work, so
 * one turn is not enough. Keeping the advance at zero is what makes the cadence
 * assertions below exact: the elapsed fake time after this helper is still 0.
 */
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

/** The one live-state banner this page renders, as the user would find it. */
function pollBannerText(): string {
  const alerts = screen.getAllByRole('alert');
  expect(alerts).toHaveLength(1);
  return alerts[0].textContent ?? '';
}

beforeEach(() => {
  signOut();
  signInAsSuperAdmin();
  vi.useFakeTimers();
  api.fetchAdminDecksPage.mockResolvedValue(emptyDecksPage());
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();

  const unexpected = (consoleError.mock.calls as unknown[][]).filter(
    call => String(call[0]) !== POLL_LOG_PREFIX,
  );
  consoleError.mockRestore();
  expect(unexpected).toEqual([]);

  vi.clearAllMocks();
  signOut();
});

describe('a publish-jobs poll that fails still keeps polling', () => {
  it('reports the refusal on screen and asks again on the idle cadence', async () => {
    api.fetchPublishJobs.mockResolvedValue(softFailure());

    await mountConsole();

    // Half one: the user is told. A silent failure would leave the job rows
    // looking authoritative while they went stale.
    const text = pollBannerText();
    expect(text).toContain(SOFT_FAILURE_MESSAGE);
    expect(text).toContain(POLL_STALE_SUFFIX);

    // Half two, and the half the mutation breaks: the page asks again. One call
    // so far is the mount; the second can only come from a scheduled timer.
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(2);

    // And it keeps going, so this is a cadence rather than one retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(3);
  });

  it('does not claim auto-refresh stopped while it is still scheduled', async () => {
    api.fetchPublishJobs.mockResolvedValue(softFailure());

    await mountConsole();

    // The stopped state has its own wording and its own retry affordance. Both
    // appearing here would mean the backstop fired, which is the page telling
    // the truth about a reschedule that did not happen.
    expect(pollBannerText()).not.toMatch(/auto-refresh stopped/i);
    expect(screen.queryByRole('button', { name: /auto-refresh stopped/i })).toBeNull();
  });

  it('labels a refusal and a thrown request as different kinds of failure', async () => {
    api.fetchPublishJobs.mockResolvedValue(softFailure());
    await mountConsole();

    // The server answered and said no: the outcome is known, nothing changed.
    const refused = pollBannerText();
    expect(refused).toContain(KIND_LABEL.business);
    expect(refused).not.toContain(KIND_LABEL.network);

    cleanup();
    api.fetchPublishJobs.mockReset();
    api.fetchPublishJobs.mockRejectedValue(new Error(THROWN_FAILURE_MESSAGE));
    await mountConsole();

    // Nothing came back: the page cannot know whether the request landed, and
    // the wording has to say so. Only the page knows which of the two happened,
    // because nextPollDelay reports both as a message string.
    const threw = pollBannerText();
    expect(threw).toContain(THROWN_FAILURE_MESSAGE);
    expect(threw).toContain(KIND_LABEL.network);
    expect(threw).not.toContain(KIND_LABEL.business);
  });

  it('keeps polling after a thrown request too', async () => {
    api.fetchPublishJobs.mockRejectedValue(new Error(THROWN_FAILURE_MESSAGE));

    await mountConsole();

    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(2);
  });

  it('clears the banner once a poll succeeds again', async () => {
    api.fetchPublishJobs.mockResolvedValueOnce(softFailure());
    api.fetchPublishJobs.mockResolvedValue({
      success: true,
      data: [],
      error: null,
      traceId: 'trace-jobs-ok',
    } satisfies ApiResult<PublishJob[]>);

    await mountConsole();
    expect(pollBannerText()).toContain(SOFT_FAILURE_MESSAGE);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS);
    });

    // A recovered poll has to take the banner down on its own. It is derived
    // from live state and has no dismiss button, so if it did not clear itself
    // the user would be stuck with a permanent false alarm.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stops asking once the page is gone', async () => {
    api.fetchPublishJobs.mockResolvedValue(softFailure());

    await mountConsole();
    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);

    cleanup();

    // The failure path above left a timer armed, so leaving the page is the
    // only thing that can disarm it. Without the unmount cleanup the callback
    // still fires: it refetches for a page nobody is looking at, and writes
    // state into a component that no longer exists. Every earlier test here
    // asserts the timer keeps firing, so none of them can see this — an
    // uncleaned timer looks exactly like a healthy one until you navigate away.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_IDLE_MS * 3);
    });

    expect(api.fetchPublishJobs).toHaveBeenCalledTimes(1);
  });
});

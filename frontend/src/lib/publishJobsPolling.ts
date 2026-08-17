// src/lib/publishJobsPolling.ts
//
// The scheduling decision for the publish-jobs poll, as a pure function.
//
// Why this is not inside DeckListPage: the bug this module exists to prevent
// was a missing branch, and a missing branch in a component method is only
// observable by mounting the component, faking timers and faking the network.
// That cost is why the branch went unnoticed. As a total function over an
// outcome union, every path is one cheap assertion, and adding a new outcome
// is a type error until it is handled. This mirrors src/lib/deckImport.ts:
// decisions are pure and tested, the page only wires them up.
//
// The invariant the caller must preserve:
//
//   Every path leaving the poll either schedules the next poll or tells the
//   user that auto refresh has stopped. The third state, quietly not polling,
//   is invisible to both the user and the developer, which makes it the worst
//   of the three: the page keeps rendering stale rows and a publish that
//   finished long ago still looks stuck.
//
// nextPollDelay upholds its half by never returning stopped: true. It is a
// field rather than an absence so that a future decision to stop has to be
// stated, and so the caller has something to render.

import type { PublishJob } from '../api/authoring';
import type { ApiResult } from '../types/api';

/** Idle, soft failure and thrown failure all fall back to this slow cadence. */
export const POLL_IDLE_MS = 30_000;

/**
 * Active-job backoff ladder. Two quick looks catch the common fast publish,
 * then the cadence relaxes so a slow build does not hammer the API.
 */
export const POLL_ACTIVE_LADDER_MS = [2_000, 2_000, 5_000, 5_000, 5_000] as const;
export const POLL_ACTIVE_MAX_MS = 10_000;

export const POLL_SOFT_FAILURE_MESSAGE = 'Failed to refresh publish jobs.';
export const POLL_NETWORK_FAILURE_MESSAGE = 'Network error while refreshing publish jobs.';

/**
 * What one poll attempt produced. `response` covers anything the transport
 * resolved with, including an HTTP 200 carrying success: false; `exception`
 * covers anything it threw.
 */
export type PollOutcome =
  | { kind: 'response'; result: ApiResult<PublishJob[]> }
  | { kind: 'exception'; error: unknown };

export interface PollDecision {
  /** Delay before the next poll. Always positive, even on failure. */
  delayMs: number;
  /** Jobs to render, or null when this attempt produced nothing usable. */
  jobs: PublishJob[] | null;
  /** Message the user must see, or null when the attempt was clean. */
  showError: string | null;
  /** Backoff counter to carry into the next call. */
  nextActivePolls: number;
  /**
   * Whether polling is deliberately ending. Always false here; a caller that
   * ever sees true owes the user a visible "auto refresh stopped" state.
   */
  stopped: boolean;
}

/** A job the server has not finished yet, so the fast cadence applies. */
function isActive(job: PublishJob): boolean {
  return job.status === 'PENDING' || job.status === 'PROCESSING';
}

function activeDelayMs(attempts: number): number {
  // attempts is 1-based: the first poll that saw active work is attempt 1.
  const index = attempts - 1;
  return POLL_ACTIVE_LADDER_MS[index] ?? POLL_ACTIVE_MAX_MS;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return POLL_NETWORK_FAILURE_MESSAGE;
}

/**
 * Decide what happens after one poll attempt.
 *
 * @param outcome     what the attempt resolved or threw with
 * @param activePolls consecutive polls that have seen active jobs so far
 */
export function nextPollDelay(outcome: PollOutcome, activePolls: number): PollDecision {
  if (outcome.kind === 'exception') {
    return {
      delayMs: POLL_IDLE_MS,
      jobs: null,
      showError: messageOf(outcome.error),
      // The counter is carried, not reset: a transport blip should not make a
      // publish that was mid-flight restart its backoff from the top.
      nextActivePolls: activePolls,
      stopped: false,
    };
  }

  const { result } = outcome;

  // Soft failure: the request resolved, so nothing was thrown, but the payload
  // is unusable. This is the case the page used to drop on the floor.
  if (!result.success || !result.data) {
    return {
      delayMs: POLL_IDLE_MS,
      jobs: null,
      showError: result.error?.message ?? POLL_SOFT_FAILURE_MESSAGE,
      nextActivePolls: activePolls,
      stopped: false,
    };
  }

  const jobs = result.data;
  if (!jobs.some(isActive)) {
    return {
      delayMs: POLL_IDLE_MS,
      jobs,
      showError: null,
      nextActivePolls: 0,
      stopped: false,
    };
  }

  const attempts = activePolls + 1;
  return {
    delayMs: activeDelayMs(attempts),
    jobs,
    showError: null,
    nextActivePolls: attempts,
    stopped: false,
  };
}

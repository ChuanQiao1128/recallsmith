import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  POLL_ACTIVE_MAX_MS,
  POLL_IDLE_MS,
  POLL_NETWORK_FAILURE_MESSAGE,
  POLL_SOFT_FAILURE_MESSAGE,
  nextPollDelay,
  type PollOutcome,
} from '../src/lib/publishJobsPolling';
import type { PublishJob } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';

const STATUSES = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'] as const;

function job(status: PublishJob['status'], jobId = 'j1'): PublishJob {
  return { jobId, deckSlug: 'csharp-backend-fundamentals', status, createdAt: 1_700_000_000_000 };
}

function ok(jobs: PublishJob[]): PollOutcome {
  const result: ApiResult<PublishJob[]> = { success: true, data: jobs, error: null, traceId: 't' };
  return { kind: 'response', result };
}

/** HTTP resolved, payload says no. The shape that used to kill the poll. */
function soft(message = 'Publish job store unavailable.'): PollOutcome {
  const result: ApiResult<PublishJob[]> = {
    success: false,
    data: null,
    error: { code: 'PUBLISH_JOBS_UNAVAILABLE', message },
    traceId: 't',
  };
  return { kind: 'response', result };
}

describe('nextPollDelay: success with active jobs', () => {
  it('uses the fast cadence on the first sighting and counts the attempt', () => {
    const d = nextPollDelay(ok([job('PENDING')]), 0);
    expect(d.delayMs).toBe(2_000);
    expect(d.nextActivePolls).toBe(1);
    expect(d.showError).toBeNull();
    expect(d.jobs).toHaveLength(1);
  });

  it('treats PROCESSING as active too', () => {
    expect(nextPollDelay(ok([job('SUCCESS'), job('PROCESSING', 'j2')]), 0).delayMs).toBe(2_000);
  });

  it('walks the backoff ladder and then holds at the ceiling', () => {
    const ladder = [0, 1, 2, 3, 4, 5, 9, 40].map(n => nextPollDelay(ok([job('PENDING')]), n).delayMs);
    expect(ladder).toEqual([2_000, 2_000, 5_000, 5_000, 5_000, 10_000, 10_000, 10_000]);
    expect(POLL_ACTIVE_MAX_MS).toBe(10_000);
  });
});

describe('nextPollDelay: success with no active jobs', () => {
  it('drops to the idle cadence and resets the backoff counter', () => {
    const d = nextPollDelay(ok([job('SUCCESS'), job('FAILED', 'j2')]), 4);
    expect(d.delayMs).toBe(POLL_IDLE_MS);
    expect(d.nextActivePolls).toBe(0);
    expect(d.showError).toBeNull();
  });

  it('treats an empty job list as idle rather than as a failure', () => {
    const d = nextPollDelay(ok([]), 3);
    expect(d.delayMs).toBe(POLL_IDLE_MS);
    expect(d.jobs).toEqual([]);
    expect(d.showError).toBeNull();
  });
});

describe('nextPollDelay: soft failure', () => {
  // The regression this module exists for: HTTP 200 with success: false used
  // to hit no branch at all, so the timer stayed cleared and the page went
  // permanently stale with nothing on screen to say so.
  it('still schedules the next poll', () => {
    const d = nextPollDelay(soft(), 0);
    expect(d.delayMs).toBe(POLL_IDLE_MS);
    expect(d.stopped).toBe(false);
  });

  it('surfaces the server message to the user', () => {
    expect(nextPollDelay(soft('Publish job store unavailable.'), 0).showError).toBe(
      'Publish job store unavailable.',
    );
  });

  it('falls back to a generic message when the payload carries no error', () => {
    const result: ApiResult<PublishJob[]> = { success: false, data: null, error: null, traceId: 't' };
    expect(nextPollDelay({ kind: 'response', result }, 0).showError).toBe(POLL_SOFT_FAILURE_MESSAGE);
  });

  it('treats success with null data as a soft failure, not as an empty list', () => {
    const result: ApiResult<PublishJob[]> = { success: true, data: null, error: null, traceId: 't' };
    const d = nextPollDelay({ kind: 'response', result }, 0);
    expect(d.jobs).toBeNull();
    expect(d.showError).toBe(POLL_SOFT_FAILURE_MESSAGE);
    expect(d.delayMs).toBe(POLL_IDLE_MS);
  });

  it('carries the backoff counter so a blip does not restart an in-flight publish', () => {
    expect(nextPollDelay(soft(), 3).nextActivePolls).toBe(3);
  });

  it('never overwrites the rendered jobs with nothing', () => {
    expect(nextPollDelay(soft(), 0).jobs).toBeNull();
  });
});

describe('nextPollDelay: thrown failure', () => {
  it('backs off to the idle cadence and reports the thrown message', () => {
    const d = nextPollDelay({ kind: 'exception', error: new Error('Network Error') }, 2);
    expect(d.delayMs).toBe(POLL_IDLE_MS);
    expect(d.showError).toBe('Network Error');
    expect(d.nextActivePolls).toBe(2);
    expect(d.jobs).toBeNull();
  });

  it('reports something readable for a non-Error throw', () => {
    expect(nextPollDelay({ kind: 'exception', error: 'boom' }, 0).showError).toBe(
      POLL_NETWORK_FAILURE_MESSAGE,
    );
    expect(nextPollDelay({ kind: 'exception', error: new Error('') }, 0).showError).toBe(
      POLL_NETWORK_FAILURE_MESSAGE,
    );
  });
});

describe('nextPollDelay: the invariant', () => {
  const arbJob = fc.record({
    jobId: fc.string(),
    deckSlug: fc.string(),
    status: fc.constantFrom(...STATUSES),
    createdAt: fc.integer({ min: 0 }),
  });

  const arbOutcome: fc.Arbitrary<PollOutcome> = fc.oneof(
    fc.array(arbJob).map(jobs => ok(jobs)),
    fc.string().map(m => soft(m)),
    fc.constant<PollOutcome>({
      kind: 'response',
      result: { success: false, data: null, error: null, traceId: 't' },
    }),
    fc.constant<PollOutcome>({
      kind: 'response',
      result: { success: true, data: null, error: null, traceId: 't' },
    }),
    fc.string().map<PollOutcome>(m => ({ kind: 'exception', error: new Error(m) })),
    fc.anything().map<PollOutcome>(e => ({ kind: 'exception', error: e })),
  );

  it('every outcome yields a positive delay and no silent stop', () => {
    fc.assert(
      fc.property(arbOutcome, fc.integer({ min: 0, max: 500 }), (outcome, activePolls) => {
        const d = nextPollDelay(outcome, activePolls);
        expect(d.stopped).toBe(false);
        expect(d.delayMs).toBeGreaterThan(0);
        expect(d.delayMs).toBeLessThanOrEqual(POLL_IDLE_MS);
        expect(d.nextActivePolls).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('an outcome with nothing to render always has something to say', () => {
    fc.assert(
      fc.property(arbOutcome, fc.integer({ min: 0, max: 500 }), (outcome, activePolls) => {
        const d = nextPollDelay(outcome, activePolls);
        expect(d.jobs !== null || d.showError !== null).toBe(true);
      }),
    );
  });
});

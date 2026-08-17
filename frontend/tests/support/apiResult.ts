// tests/support/apiResult.ts
//
// The four ApiResult shapes the console's pages can actually receive, plus a
// promise you can hold open.
//
// Why these four and not a general builder: every fetch in src/api/authoring.ts
// is a try/catch that returns `fail(...)` on a throw, so the page layer sees
// exactly two failure shapes and never sees a rejection. Naming them here stops
// each test file from re-deriving the ApiResult literal (five files did that
// before this existed) and, more importantly, stops a test from inventing a
// fifth shape the API cannot produce.
//
// NOT collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import type { ApiResult } from '../../src/types/api';

/** HTTP 200, success: true, data present. The only shape a page renders from. */
export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null, traceId: 'trace-ok' };
}

/**
 * HTTP 200 carrying success: false. The server understood the request and said
 * no, and it chose the wording in `message`.
 *
 * Callers should assert against the message they passed in, never against a
 * string the page hard-codes — that is the difference between checking the page
 * surfaces the server's answer and checking it prints its own guess.
 */
export function refused<T>(code: string, message: string): ApiResult<T> {
  return { success: false, data: null, error: { code, message }, traceId: 'trace-refused' };
}

/**
 * What the api layer returns when the request threw: `fail(toApiErrorMessage(err))`,
 * which is code NETWORK_ERROR and an empty traceId.
 *
 * This is a RESOLVED promise, not a rejected one, because that is what the
 * pages see. Making a mock reject would exercise a state the api layer cannot
 * produce; on ContentIntelligencePage, whose effect calls `void run()` with no
 * catch, it would additionally turn one bad mock into an unhandled rejection
 * that fails the whole file.
 */
export function networkFailure<T>(message: string): ApiResult<T> {
  return { success: false, data: null, error: { code: 'NETWORK_ERROR', message }, traceId: '' };
}

/** A promise plus the handle that settles it. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * A promise the test settles by hand.
 *
 * The pending window between mounting and `resolve(...)` is the only place a
 * loading state is observable, so this is what the "does this control show a
 * spinner" cases are built on: point the mock at `d.promise`, act, assert the
 * page is busy, then `d.resolve(ok(...))` and assert it is not.
 *
 * The executor runs synchronously, so `resolve` is assigned before the
 * constructor returns; the non-null assertion is discharged by that, not
 * assumed. There is deliberately no `reject`: see networkFailure above.
 */
export function deferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>(res => {
    resolveFn = res;
  });
  return { promise, resolve: resolveFn as (value: T) => void };
}

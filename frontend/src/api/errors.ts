// src/api/errors.ts
//
// One error type for "the API answered, and the answer was no".
//
// Every fetch in src/api/authoring.ts returns an ApiResult carrying three
// things: a message, a machine-readable `code`, and the `traceId` the server
// stamped on that request. The read hooks used to throw
//
//     new Error(res.error?.message ?? '<fallback>')
//
// which keeps the sentence and drops the other two on the floor. That is not a
// tidiness complaint: the code is the only field a caller can BRANCH on — a
// deck that does not exist and a deck the caller may not read are the same
// sentence to a regex and different situations to a user — and the traceId is
// the only field that connects what the user is looking at to the server log
// line that explains it. Re-deriving either one from the message means parsing
// prose, which is how a wording change turns into a behaviour change.
//
// This class carries all three. It is deliberately the ONLY error the read
// hooks throw, so `instanceof ApiFailureError` is a complete test for "this
// failure came from an answered request", and anything else reaching a catch
// is a bug in the client rather than a verdict from the server.

import type { ApiResult } from '../types/api';

/**
 * The code the api layer uses for a deck that is not there.
 *
 * Written out here rather than typed as a union of every code the backend can
 * send: the set is open — the server may add a code tomorrow — and a union
 * would make an unknown code a compile error at the one place that must keep
 * working, the `else` that shows the server's own wording.
 */
export const NOT_FOUND = 'NOT_FOUND';

/**
 * The code the authoring API returns when `expectedVersion` is stale: somebody
 * else wrote to this row between the read and the write.
 *
 * It lives here rather than in src/lib/deckImportRunner.ts, which declared it
 * and still re-exports it for its own callers, because it now has a second
 * consumer -- EditCardPage's recovery path -- and a page importing the markdown
 * import runner to learn one string would drag that whole module into the card
 * editor's chunk to do it.
 */
export const VERSION_CONFLICT = 'VERSION_CONFLICT';

/** Stand-in for a refusal that carried no code at all. */
export const UNKNOWN_CODE = 'UNKNOWN';

export class ApiFailureError extends Error {
  readonly code: string;
  readonly traceId: string;

  constructor(message: string, code: string, traceId: string) {
    super(message);
    // Set explicitly: the class name is not on the prototype chain in the
    // compiled output, and `err.name` is what a console log and an error
    // reporter both show first.
    this.name = 'ApiFailureError';
    this.code = code;
    this.traceId = traceId;
  }
}

/**
 * The error for an ApiResult whose `success` is false.
 *
 * The fallbacks are the caller's, not this module's: each read path already has
 * a sentence it shows when the server sends none, and those sentences are what
 * the pages have always displayed. Inventing a house string here would give one
 * kind of failure two different wordings depending on which layer noticed it.
 */
export function apiFailure<T>(
  result: ApiResult<T>,
  fallbackMessage: string,
  fallbackCode: string = UNKNOWN_CODE,
): ApiFailureError {
  return new ApiFailureError(
    result.error?.message ?? fallbackMessage,
    result.error?.code ?? fallbackCode,
    result.traceId ?? '',
  );
}

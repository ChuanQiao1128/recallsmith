// src/lib/errorFeed.ts
//
// The console's error channel, as pure data.
//
// Why this replaces window.alert: alert is synchronous. Between the failing
// request and the user's click the whole main thread is parked, so nothing
// repaints, no input is processed, and the pause does not even show up in INP
// because the browser stops sampling. A failure that freezes the product is a
// worse failure than the one being reported.
//
// Why the decision lives here rather than in the pages: what an error feed
// does is not "render red text", it is a small state machine (report, replace,
// clear, cap). Inside a component that machine is only reachable by mounting a
// page and faking the network; as a total function over a list it is one cheap
// assertion per rule. Same split as src/lib/deckImport.ts and
// src/lib/publishJobsPolling.ts: decisions are pure and tested, the page wires
// them to state and to the DOM.
//
// Two rules carry the design:
//
// 1. Same key replaces, different keys stack (up to MAX_NOTICES). A retry loop
//    against a server that is still down reports the same failure over and
//    over; accumulating would bury the newest copy under identical rows and
//    grow the DOM without bound, while a single global slot would let a
//    publish failure silently erase a delete failure the user has not read
//    yet. The key is the operation, so each operation keeps exactly one, most
//    recent, verdict.
//
// 2. Nothing expires on a timer. A business message can be a sentence the user
//    has to act on, and a banner that vanishes after N seconds is unreadable
//    for anyone who looked away, so notices leave only when the user dismisses
//    them or when the same operation is attempted again (the page clears the
//    key before it starts, which also makes a successful retry clean up after
//    itself). No timers also means nothing to leak on unmount.

/**
 * Business failures are the server answering "no" in a form it chose: the
 * request arrived, was understood, and was refused, so the message is written
 * for a human and the outcome is known. Network failures are anything that
 * threw: the message is an accident of the transport and, crucially, the
 * caller cannot tell whether the write landed. Same banner component, opposite
 * advice, so the distinction has to survive into the data.
 */
export type ErrorKind = 'business' | 'network';

export interface ErrorNotice {
  /** Operation identity. One notice per key, newest wins. */
  key: string;
  kind: ErrorKind;
  /** What the user was trying to do, in their words. */
  title: string;
  /** Server message or transport text. Null when neither said anything. */
  detail: string | null;
}

/** Backstop for distinct keys, so a page cannot fill the viewport with red. */
export const MAX_NOTICES = 4;

export const BUSINESS_DETAIL_FALLBACK =
  'The server refused the request without giving a reason.';
export const NETWORK_DETAIL_FALLBACK =
  'The request failed before a readable reply came back.';

/** Names the class of failure, so the two are never read as one thing. */
export const KIND_LABEL: Record<ErrorKind, string> = {
  business: 'Rejected by the server',
  network: 'Network or unexpected error',
};

/**
 * The part that actually differs for the user: a refusal is final and the
 * state is known, a transport failure leaves the outcome undetermined.
 */
export const KIND_HINT: Record<ErrorKind, string> = {
  business: 'The request reached the server and was refused, so nothing changed.',
  network: 'The request may or may not have been applied. Reload before trying again.',
};

/**
 * Starting value for a page's feed. A factory rather than a shared constant so
 * that no two pages can ever end up holding the same array, and so it can be
 * passed straight to useState as a lazy initialiser.
 */
export function emptyErrorFeed(): ErrorNotice[] {
  return [];
}

function upsert(feed: readonly ErrorNotice[], notice: ErrorNotice): ErrorNotice[] {
  // Newest first: the thing that just failed is the thing being read.
  return [notice, ...feed.filter(n => n.key !== notice.key)].slice(0, MAX_NOTICES);
}

function trimmed(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/**
 * Pull something printable out of a thrown value. Anything that is not an
 * Error with a message, or a non-empty string, is dropped in favour of the
 * fallback: "[object Object]" tells the user less than a plain sentence.
 */
export function detailOfThrown(error: unknown): string {
  if (error instanceof Error) return trimmed(error.message) ?? NETWORK_DETAIL_FALLBACK;
  if (typeof error === 'string') return trimmed(error) ?? NETWORK_DETAIL_FALLBACK;
  return NETWORK_DETAIL_FALLBACK;
}

/** The server answered and said no. `message` is its own wording, if any. */
export function reportBusinessFailure(
  feed: readonly ErrorNotice[],
  key: string,
  title: string,
  message?: string | null,
): ErrorNotice[] {
  return upsert(feed, {
    key,
    kind: 'business',
    title,
    detail: trimmed(message) ?? BUSINESS_DETAIL_FALLBACK,
  });
}

/** Something threw, so the outcome of the operation is unknown. */
export function reportThrownFailure(
  feed: readonly ErrorNotice[],
  key: string,
  title: string,
  error: unknown,
): ErrorNotice[] {
  return upsert(feed, { key, kind: 'network', title, detail: detailOfThrown(error) });
}

/**
 * Remove one operation's notice. Used both for the dismiss button and by the
 * page before it retries, which is what makes a success clear the banner
 * without every success path having to remember to.
 */
export function clearNotice(feed: readonly ErrorNotice[], key: string): ErrorNotice[] {
  return feed.filter(n => n.key !== key);
}

// ---------------------- publish-jobs polling ----------------------

export const POLL_NOTICE_KEY = 'publishJobs.poll';
export const POLL_NOTICE_TITLE = 'Publish jobs are not refreshing';
export const POLL_STALE_SUFFIX = 'Job statuses shown below may be out of date.';
export const POLL_STOPPED_WITHOUT_ERROR =
  'Auto-refresh is no longer scheduled, and no reason was recorded.';

/** What the last poll attempt failed with, kept as one value so the kind and
 *  the message can never drift apart across two useState calls. */
export interface PollFailure {
  kind: ErrorKind;
  message: string;
}

/**
 * Fold the publish-jobs poll state into the same notice shape as everything
 * else, so the console has one error vocabulary instead of two.
 *
 * The invariant inherited from src/lib/publishJobsPolling.ts is that a stopped
 * poll must be visible. It is enforced here by deriving the notice from
 * `stopped` as well as from `failure`: a stop with no recorded error still
 * produces a notice, because a silently stopped poll renders stale job rows
 * that read as "the publish is stuck".
 */
export function pollingNotice(
  failure: PollFailure | null,
  stopped: boolean,
): ErrorNotice | null {
  if (!failure && !stopped) return null;

  return {
    key: POLL_NOTICE_KEY,
    // A stop with no error is an unexplained state, and unexplained means the
    // outcome is unknown, which is exactly what the network wording says.
    kind: failure?.kind ?? 'network',
    title: POLL_NOTICE_TITLE,
    detail: `${failure?.message ?? POLL_STOPPED_WITHOUT_ERROR} ${POLL_STALE_SUFFIX}`,
  };
}

// src/lib/deckImportRunner.ts
//
// Applies an ImportPlan through F01's transactional batch endpoint, in batches.
//
// This lives next to deckImport.ts rather than inside DeckImportPage because the
// risky part of an import is not the markup, it is the write path: how the plan
// is split into batches, what is retried, what a cancel leaves behind, and what
// exactly is sent for a field the author cleared. Keeping it here means those
// rules are covered by node level tests and the page stays wiring.
//
// The write path is now one call per batch instead of one call per card:
//
// 1. F01 writes a whole batch in a single transaction and upserts by
//    (deckId, stableUid), so a re-sent batch is a no-op and a batch that fails
//    rolls back entirely — no card in it lands. That is what makes a retry safe.
// 2. Transient failures (timeout, network, 429, 5xx) are retried with 1/2/4s
//    backoff. A timed-out batch that actually landed comes back as `unchanged`
//    on the retry, so a retry can never double-write.
// 3. A batch that fails for a non-transient reason does not stop the run: its
//    cards are recorded as failures and the next batch is attempted, so the
//    operator gets every failure at once.
// 4. Cleared optional fields are sent as "" instead of being omitted, and mcq is
//    always sent as an explicit value (null on a Q/A card). F01 upserts every
//    column from the payload, and the planner compares the same normalized
//    strings, so a re-import of the same file is a no-op — idempotence has to
//    survive deletions too.

import { VERSION_CONFLICT } from '../api/errors';
import type { ImportCardInput, ImportCardsBatchResult } from '../api/authoring';
import type { ApiError, ApiResult } from '../types/api';
import type { ImportCreate, ImportUpdate } from './deckImport';

export type ImportAction = ImportCreate | ImportUpdate;

// F01's per-call ceiling (CardsImport.MaxCards). A payload with more than this
// is refused, so the runner never sends one.
export const IMPORT_BATCH_MAX_CARDS = 500;

// A serialized-size ceiling that keeps each batch under E07's 1 MiB body cap
// with headroom for the request envelope. Measured on
// JSON.stringify({ deckId, cards }).
export const IMPORT_BATCH_MAX_CHARS = 900_000;

// Backoff between retries of a transient batch failure: 1s, 2s, 4s. Its length
// is the retry count, so there are at most three retries (four attempts total).
export const IMPORT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

// code stamped on a batch the operator cancelled mid-write. Distinct from the
// api layer's CANCELLED so the page can tell "you stopped this" from any other
// refusal and point the operator at a re-preview.
export const IMPORT_CANCELLED = 'IMPORT_CANCELLED';

const CANCELLED_MESSAGE =
  'Cancelled while this batch was being written. Re-run the preview to see whether it landed.';

/**
 * The one API call the runner needs, described structurally so tests can pass a
 * fake without importing api/authoring.ts (which pulls in axios and
 * import.meta.env, neither of which belongs in a unit test).
 */
export interface ImportBatchWriter {
  importCards(params: {
    deckId: number;
    cards: ImportCardInput[];
    signal?: AbortSignal;
  }): Promise<ApiResult<ImportCardsBatchResult>>;
}

export interface RunImportOptions {
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  /** Overridable so tests can run without real timers. Defaults to a setTimeout that resolves early on abort. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ImportFailure {
  action: ImportAction;
  stableUid: string;
  code: string;
  message: string;
}

export interface ImportRunResult {
  created: number;
  updated: number;
  failures: ImportFailure[];
  /** True when the operator cancelled before the run finished. */
  cancelled: boolean;
  /** Actions never attempted, because a cancel stopped the run before their batch. */
  notRun: number;
}

export interface ImportProgress {
  /** Actions finished so far, successful or not. */
  done: number;
  total: number;
  /** The last action of the batch just finished, so the UI can name what it is working on. */
  current: ImportAction;
}

// error.code the authoring API returns when expectedVersion is stale. Declared
// in src/api/errors.ts now that EditCardPage branches on it too, and re-exported
// from here so this module's existing importers do not have to care where it
// moved.
export { VERSION_CONFLICT };

/**
 * Optional text is stored trimmed by the server and read back as either null
 * or "", so the runner sends the same normalized string the planner compares.
 * Without this a card whose USAGE section is only whitespace would flip
 * between update and unchanged on alternating imports.
 */
function optionalText(value: string | null): string {
  return (value ?? '').trim();
}

/**
 * Builds the F01 card body for one action. Mirrors the create/update field rules
 * the per-card path used: cleared optional text becomes "", mcq is always an
 * explicit value (null on a Q/A card), and there is no expectedVersion because
 * F01 ignores it.
 */
function cardInputFor(action: ImportAction): ImportCardInput {
  const card = action.card;
  return {
    stableUid: card.stableUid,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: optionalText(card.codeSnippet),
    codeLanguage: optionalText(card.codeLanguage),
    realWorldUsage: optionalText(card.realWorldUsage),
    topic: optionalText(card.topic ?? null),
    mcq: card.mcq ?? null,
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
  };
}

/** Human sentence for a failure, with the one hint that is not obvious. */
export function describeFailure(failure: ImportFailure): string {
  // A stale version and a mid-import reorder are both cleared by planning again
  // against fresh server state, so both point the operator at the same fix.
  if (failure.code === VERSION_CONFLICT || failure.code === 'ORDER_CONFLICT') {
    return `${failure.message} Re-run the preview to refresh the reconciliation before retrying.`;
  }
  return failure.message;
}

/**
 * Splits actions, in plan order, into consecutive batches of at most `maxCards`
 * actions whose serialized `{ deckId, cards }` body stays within `maxChars`. A
 * single action that alone exceeds `maxChars` gets a batch of its own: the
 * server will refuse it, and that refusal is the honest answer rather than a
 * silent drop.
 */
export function chunkImportActions(
  deckId: number,
  actions: readonly ImportAction[],
  maxCards = IMPORT_BATCH_MAX_CARDS,
  maxChars = IMPORT_BATCH_MAX_CHARS,
): ImportAction[][] {
  // JSON.stringify({ deckId, cards: [c1, ..., cn] }).length is exactly this
  // wrapper's length plus each card's own serialized length plus the (n - 1)
  // commas between them, so the running sum below measures the real body without
  // re-stringifying the whole batch on every card.
  const wrapperLen = JSON.stringify({ deckId, cards: [] as ImportCardInput[] }).length;
  const chunkChars = (cardsLen: number, count: number): number =>
    count === 0 ? wrapperLen : wrapperLen + cardsLen + (count - 1);

  const chunks: ImportAction[][] = [];
  let current: ImportAction[] = [];
  let currentLen = 0;

  for (const action of actions) {
    const cardLen = JSON.stringify(cardInputFor(action)).length;
    const fits =
      current.length > 0 &&
      current.length < maxCards &&
      chunkChars(currentLen + cardLen, current.length + 1) <= maxChars;

    if (fits) {
      current.push(action);
      currentLen += cardLen;
    } else {
      if (current.length > 0) chunks.push(current);
      current = [action];
      currentLen = cardLen;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * True for a batch failure worth retrying: a timeout or network drop, a 429, or
 * any 5xx — except MIGRATION_REQUIRED, which is a 503 that stays broken until
 * someone runs migration 022, so retrying it only wastes the backoff. Everything
 * else (a cancel, a version or order conflict, a soft-deleted uid, a validation
 * error, a payload that is too large) is final.
 */
export function isRetryableImportFailure(error: ApiError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'MIGRATION_REQUIRED') return false;
  if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') return true;
  if (error.httpStatus === 429) return true;
  if (typeof error.httpStatus === 'number' && error.httpStatus >= 500) return true;
  return false;
}

/** setTimeout as a promise that also resolves early when `signal` aborts. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pushChunkFailures(
  result: ImportRunResult,
  chunk: readonly ImportAction[],
  code: string,
  message: string,
): void {
  for (const action of chunk) {
    result.failures.push({ action, stableUid: action.card.stableUid, code, message });
  }
}

/**
 * Runs the plan as a sequence of batches, in plan order. Returns counts plus the
 * list of actions that failed. A failed batch does not stop the run; a cancel
 * does, and everything the cancel left unwritten is reported so the operator can
 * re-preview against fresh server state before importing again.
 */
export async function runImport(
  deckId: number,
  actions: readonly ImportAction[],
  writer: ImportBatchWriter,
  options: RunImportOptions = {},
): Promise<ImportRunResult> {
  const { onProgress, signal, sleep = defaultSleep } = options;
  const result: ImportRunResult = {
    created: 0,
    updated: 0,
    failures: [],
    cancelled: false,
    notRun: 0,
  };
  const total = actions.length;
  const chunks = chunkImportActions(deckId, actions);
  let done = 0;

  for (const chunk of chunks) {
    // Cancelled before this batch even started: none of it, or anything after
    // it, was attempted.
    if (signal?.aborted) {
      result.cancelled = true;
      result.notRun = total - done;
      return result;
    }

    const cards = chunk.map(cardInputFor);

    for (let attempt = 0; ; attempt++) {
      let outcome: ApiResult<ImportCardsBatchResult>;
      try {
        outcome = await writer.importCards({ deckId, cards, signal });
      } catch (err: unknown) {
        // The api layer converts axios errors into ApiResult, so a throw here is
        // a bug or a browser-level failure. Record the batch and move on rather
        // than losing every batch after it.
        pushChunkFailures(
          result,
          chunk,
          'UNEXPECTED_ERROR',
          err instanceof Error ? err.message : 'Unexpected error.',
        );
        break;
      }

      if (outcome.success) {
        result.created += outcome.data?.created ?? 0;
        result.updated += outcome.data?.updated ?? 0;
        break;
      }

      const error = outcome.error;

      // A cancel during the request: the transaction rolled back, but the
      // operator cannot know that from here, so say so and stop.
      if (error?.code === 'CANCELLED' || signal?.aborted) {
        pushChunkFailures(result, chunk, IMPORT_CANCELLED, CANCELLED_MESSAGE);
        result.cancelled = true;
        result.notRun = total - (done + chunk.length);
        return result;
      }

      if (isRetryableImportFailure(error) && attempt < IMPORT_RETRY_DELAYS_MS.length) {
        await sleep(IMPORT_RETRY_DELAYS_MS[attempt], signal);
        // A cancel during the backoff wait ends the run the same way.
        if (signal?.aborted) {
          pushChunkFailures(result, chunk, IMPORT_CANCELLED, CANCELLED_MESSAGE);
          result.cancelled = true;
          result.notRun = total - (done + chunk.length);
          return result;
        }
        continue;
      }

      // Non-retryable, or the retries are spent. The transaction rolled back, so
      // no card in the batch landed.
      pushChunkFailures(
        result,
        chunk,
        error?.code ?? 'UNKNOWN_ERROR',
        error?.message ?? 'Write failed.',
      );
      break;
    }

    done += chunk.length;
    onProgress?.({ done, total, current: chunk[chunk.length - 1] });
  }

  return result;
}

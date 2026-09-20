// src/lib/deckImportRunner.ts
//
// Applies an ImportPlan through the authoring API, one card at a time.
//
// This lives next to deckImport.ts rather than inside DeckImportPage because
// the risky part of an import is not the markup, it is the write loop: order,
// partial failure, and what exactly gets sent for a field the author cleared.
// Keeping it here means those rules are covered by node level tests and the
// page stays wiring.
//
// Three deliberate choices:
//
// 1. Serial, never Promise.all. A deck import is a few hundred writes against
//    one Lambda and one row per card; firing them in parallel buys little and
//    turns a rate limit into a half applied deck with no useful failure list.
// 2. A failed card does not stop the run. The operator gets every failure at
//    once instead of discovering them one redeploy at a time.
// 3. Cleared optional fields are sent as "" instead of being omitted. The API
//    treats an absent key as "leave it alone", so omitting a cleared snippet
//    would leave the old text in the row, and the next import of the same file
//    would plan the same update forever. Idempotence is the whole point of
//    reconciling, so it has to survive deletions too. For the same reason mcq is
//    always sent as an explicit value (null on a Q/A card): an update that
//    removed the options must clear the column, and an absent key would leave
//    the old blob in place.

import { VERSION_CONFLICT } from '../api/errors';
import type { ApiResult } from '../types/api';
import type { Card } from '../types/card';
import type { McqBlob } from '../types/mcq';
import type { ImportCreate, ImportUpdate, ParsedCard } from './deckImport';
import { mcqOf } from './mcqRules';

export type ImportAction = ImportCreate | ImportUpdate;

export interface CreateCardParams {
  deckId: number;
  question: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
  realWorldUsage?: string;
  topic?: string;
  mcq?: McqBlob | null;
}

export interface UpdateCardParams {
  id: number;
  deckId: number;
  question?: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  realWorldUsage?: string;
  topic?: string;
  mcq?: McqBlob | null;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
  expectedVersion?: number;
}

/**
 * The two API calls the runner needs, described structurally so tests can pass
 * a fake without importing api/authoring.ts (which pulls in axios and
 * import.meta.env, neither of which belongs in a unit test).
 */
export interface ImportWriter {
  createCard(params: CreateCardParams): Promise<ApiResult<Card>>;
  updateCard(params: UpdateCardParams): Promise<ApiResult<Card>>;
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
}

export interface ImportProgress {
  /** Actions finished so far, successful or not. */
  done: number;
  total: number;
  /** The action just finished, so the UI can name what it is working on. */
  current: ImportAction;
}

// error.code the authoring API returns when expectedVersion is stale. Declared
// in src/api/errors.ts now that EditCardPage branches on it too, and re-exported
// from here so this module's existing importers do not have to care where it
// moved.
export { VERSION_CONFLICT };

// Raised by the readiness guard below when the first MCQ write comes back
// without its mcq blob: the API in front of us predates migration 019 / C08.
export const SERVER_NOT_READY_MCQ = 'SERVER_NOT_READY_MCQ';

/**
 * Optional text is stored trimmed by the server and read back as either null
 * or "", so the runner sends the same normalized string the planner compares.
 * Without this a card whose USAGE section is only whitespace would flip
 * between update and unchanged on alternating imports.
 */
function optionalText(value: string | null): string {
  return (value ?? '').trim();
}

function createParamsFor(deckId: number, card: ParsedCard): CreateCardParams {
  return {
    deckId,
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

function updateParamsFor(deckId: number, action: ImportUpdate): UpdateCardParams {
  return {
    id: action.existingId,
    deckId,
    stableUid: action.card.stableUid,
    question: action.card.question,
    explanation: action.card.explanation,
    codeSnippet: optionalText(action.card.codeSnippet),
    codeLanguage: optionalText(action.card.codeLanguage),
    realWorldUsage: optionalText(action.card.realWorldUsage),
    topic: optionalText(action.card.topic ?? null),
    mcq: action.card.mcq ?? null,
    difficulty: action.card.difficulty,
    orderInDeck: action.card.orderInDeck,
    expectedVersion: action.expectedVersion,
  };
}

/** Human sentence for a failure, with the one hint that is not obvious. */
export function describeFailure(failure: ImportFailure): string {
  if (failure.code === VERSION_CONFLICT) {
    return `${failure.message} Re-run the preview to refresh the reconciliation before retrying.`;
  }
  if (failure.code === SERVER_NOT_READY_MCQ) {
    return 'The server is not ready for MCQ cards (migration 019 / Lambda not deployed); nothing after this card was written.';
  }
  return failure.message;
}

/**
 * Runs creates and updates in the order given. Returns counts plus the list of
 * actions that failed, which the caller can hand straight back to runImport as
 * a retry (the actions are unchanged, so a retry of an update still carries the
 * version captured at plan time; a VERSION_CONFLICT can only be cleared by
 * planning again).
 */
export async function runImport(
  deckId: number,
  actions: readonly ImportAction[],
  writer: ImportWriter,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportRunResult> {
  const result: ImportRunResult = { created: 0, updated: 0, failures: [] };
  const total = actions.length;
  let done = 0;
  // The readiness check runs once per run, on the first action whose card
  // carries an mcq blob. A run without MCQ cards never reads outcome.data.
  let mcqProbed = false;

  for (const [index, action] of actions.entries()) {
    let outcome: ApiResult<Card>;

    try {
      outcome =
        action.kind === 'create'
          ? await writer.createCard(createParamsFor(deckId, action.card))
          : await writer.updateCard(updateParamsFor(deckId, action));
    } catch (err: unknown) {
      // The api layer already converts axios errors into ApiResult, so a throw
      // here is a bug or a browser level failure. Record it and keep going
      // rather than losing the cards that come after it.
      outcome = {
        success: false,
        data: null,
        error: {
          code: 'UNEXPECTED_ERROR',
          message: err instanceof Error ? err.message : 'Unexpected error.',
        },
        traceId: '',
      };
    }

    if (outcome.success) {
      if (!mcqProbed && action.card.mcq !== undefined) {
        mcqProbed = true;
        if (mcqOf(outcome.data) === null) {
          // The write succeeded but the echo has no mcq: the API in front of us
          // predates migration 019 / C08 and stored a Q/A card. Stop here so a
          // wrong deployment order costs one card, not the rest of the file.
          result.failures.push({ action, stableUid: action.card.stableUid, code: SERVER_NOT_READY_MCQ, message: `The server stored "${action.card.stableUid}" without its options.` });
          for (const skipped of actions.slice(index + 1)) {
            result.failures.push({ action: skipped, stableUid: skipped.card.stableUid, code: SERVER_NOT_READY_MCQ, message: `Not written: "${skipped.card.stableUid}" was skipped after the MCQ readiness check failed.` });
          }
          done += 1;
          onProgress?.({ done, total, current: action });
          return result;
        }
      }
      if (action.kind === 'create') result.created += 1;
      else result.updated += 1;
    } else {
      result.failures.push({
        action,
        stableUid: action.card.stableUid,
        code: outcome.error?.code ?? 'UNKNOWN_ERROR',
        message: outcome.error?.message ?? 'Write failed.',
      });
    }

    done += 1;
    onProgress?.({ done, total, current: action });
  }

  return result;
}

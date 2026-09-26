// The batch write path: how a plan is split into batches, what is retried and
// with what backoff, what a cancel leaves behind, and what each card body
// carries. All node-level: a fake ImportBatchWriter stands in for the api layer
// (no axios, no import.meta.env), sleep is stubbed so the backoff is inspected
// rather than waited on, and the plans are real, from parseDeckMarkdown +
// planImport.

import { describe, expect, it } from 'vitest';

import { parseDeckMarkdown, planImport } from '../src/lib/deckImport';
import {
  IMPORT_BATCH_MAX_CARDS,
  IMPORT_BATCH_MAX_CHARS,
  IMPORT_CANCELLED,
  chunkImportActions,
  describeFailure,
  isRetryableImportFailure,
  runImport,
  type ImportAction,
  type ImportBatchWriter,
} from '../src/lib/deckImportRunner';
import type { ImportCardInput, ImportCardsBatchResult } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';

const DECK_ID = 7;

function ok(counts: Partial<ImportCardsBatchResult> = {}): ApiResult<ImportCardsBatchResult> {
  return {
    success: true,
    data: { created: counts.created ?? 0, updated: counts.updated ?? 0, unchanged: counts.unchanged ?? 0 },
    error: null,
    traceId: 't',
  };
}

function fail(code: string, message = code, httpStatus?: number): ApiResult<ImportCardsBatchResult> {
  return { success: false, data: null, error: { code, message, httpStatus }, traceId: 't' };
}

interface Batch {
  deckId: number;
  cards: ImportCardInput[];
  signal?: AbortSignal;
}

interface Recorder {
  writer: ImportBatchWriter;
  batches: Batch[];
}

/** A fake writer whose response is chosen per call by `responses(callIndex, batch)`. */
function recorder(
  responses: (call: number, batch: Batch) => ApiResult<ImportCardsBatchResult> = () => ok(),
): Recorder {
  const batches: Batch[] = [];
  let call = 0;
  const writer: ImportBatchWriter = {
    async importCards(params) {
      const batch: Batch = { deckId: params.deckId, cards: params.cards, signal: params.signal };
      batches.push(batch);
      return responses(call++, batch);
    },
  };
  return { writer, batches };
}

/** sleep stub that records the delays it was asked to wait, and never waits. */
function sleepSpy(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

const SMALL_DOC = [
  '# deck: csharp-backend-fundamentals',
  '',
  '## cs-async-001 | d2',
  'Q:',
  'Does awaiting a completed Task switch threads?',
  'A:',
  'Not necessarily; the fast path continues synchronously.',
  'CODE: csharp',
  'var v = await Task.FromResult(42);',
  'USAGE:',
  'Hot paths stay cheap because of the fast path.',
  '',
  '## cs-span-002 | d3',
  'Q:',
  'When does Span<T> stop being usable?',
  'A:',
  'It is a ref struct, so it cannot cross an await.',
].join('\n');

/** A deck document with `n` plain Q/A cards, each question padded by `pad` chars. */
function genDoc(n: number, pad = 0): string {
  const lines = ['# deck: gen-deck', ''];
  for (let i = 0; i < n; i++) {
    const uid = `gen-${String(i).padStart(5, '0')}`;
    lines.push(`## ${uid} | d2`, 'Q:', `Question ${i} ${'x'.repeat(pad)}`.trim(), 'A:', `Answer ${i}`, '');
  }
  return lines.join('\n');
}

function actionsFor(doc: string, existing: readonly Card[] = []): ImportAction[] {
  const plan = planImport(parseDeckMarkdown(doc), existing);
  return [...plan.creates, ...plan.updates];
}

function existingCard(overrides: Partial<Card> & Pick<Card, 'id' | 'stableUid'>): Card {
  return {
    deckId: DECK_ID,
    question: '',
    difficulty: 0,
    orderInDeck: 0,
    explanation: '',
    realWorldUsage: null,
    codeSnippet: null,
    codeLanguage: null,
    version: 1,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function serializedLength(deckId: number, cards: ImportCardInput[]): number {
  return JSON.stringify({ deckId, cards }).length;
}

describe('runImport in batches', () => {
  it('sends the whole plan in one batch when it fits', async () => {
    const rec = recorder((_call, batch) => ok({ created: batch.cards.length }));

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: async () => {} });

    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0].deckId).toBe(DECK_ID);
    expect(rec.batches[0].cards.map((c) => c.stableUid)).toEqual(['cs-async-001', 'cs-span-002']);
    expect(result).toEqual({ created: 2, updated: 0, failures: [], cancelled: false, notRun: 0 });
  });

  it('splits at IMPORT_BATCH_MAX_CARDS cards', async () => {
    const actions = actionsFor(genDoc(IMPORT_BATCH_MAX_CARDS + 1));
    const rec = recorder((_call, batch) => ok({ created: batch.cards.length }));

    const result = await runImport(DECK_ID, actions, rec.writer, { sleep: async () => {} });

    expect(rec.batches).toHaveLength(2);
    expect(rec.batches[0].cards).toHaveLength(IMPORT_BATCH_MAX_CARDS);
    expect(rec.batches[1].cards).toHaveLength(1);
    expect(result.created).toBe(IMPORT_BATCH_MAX_CARDS + 1);
  });

  it('splits before a batch would exceed IMPORT_BATCH_MAX_CHARS characters', () => {
    // ~5 KB per card, so the character cap bites long before the 500-card cap.
    const actions = actionsFor(genDoc(300, 5_000));
    const chunks = chunkImportActions(DECK_ID, actions);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // The split is on size, not on the count cap: no chunk hit 500 cards.
      expect(chunk.length).toBeLessThan(IMPORT_BATCH_MAX_CARDS);
    }
    // Every batch's real serialized body stays within the cap.
    const inputs = actions.length;
    let seen = 0;
    for (const chunk of chunks) {
      const cards = chunk.map((a) => cardInputOf(a));
      expect(serializedLength(DECK_ID, cards)).toBeLessThanOrEqual(IMPORT_BATCH_MAX_CHARS);
      seen += chunk.length;
    }
    // Nothing was dropped in the split.
    expect(seen).toBe(inputs);
  });

  it('clears a removed optional section with "" and sends mcq explicitly', async () => {
    // The server has a snippet; the document dropped it. The update must send ""
    // (not omit the field), and mcq must be an explicit null on this Q/A card.
    const stripped = SMALL_DOC.split('\n')
      .filter((line) => line !== 'CODE: csharp' && !line.startsWith('var v ='))
      .join('\n');
    const existing = [
      existingCard({
        id: 41,
        stableUid: 'cs-async-001',
        question: 'Does awaiting a completed Task switch threads?',
        difficulty: 2,
        orderInDeck: 5,
        explanation: 'Not necessarily; the fast path continues synchronously.',
        codeSnippet: 'var v = await Task.FromResult(42);',
        codeLanguage: 'csharp',
        realWorldUsage: 'Hot paths stay cheap because of the fast path.',
        version: 3,
      }),
    ];
    const rec = recorder();

    await runImport(DECK_ID, actionsFor(stripped, existing), rec.writer, { sleep: async () => {} });

    const sent = rec.batches[0].cards.find((c) => c.stableUid === 'cs-async-001');
    if (!sent) throw new Error('cs-async-001 was not sent');
    expect(sent.codeSnippet).toBe('');
    expect(sent.codeLanguage).toBe('');
    expect(Object.hasOwn(sent, 'mcq')).toBe(true);
    expect(sent.mcq).toBeNull();
  });

  it('retries a timed-out batch with backoff and counts it once', async () => {
    const spy = sleepSpy();
    const rec = recorder((call, batch) =>
      call < 2 ? fail('TIMEOUT', 'The request timed out.') : ok({ created: batch.cards.length }),
    );

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: spy.sleep });

    expect(spy.slept).toEqual([1000, 2000]);
    expect(rec.batches).toHaveLength(3);
    // Counted once: three attempts, one success, so created is the batch size, not a multiple of it.
    expect(result.created).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('gives up after three retries and reports every card in the batch', async () => {
    const spy = sleepSpy();
    const rec = recorder(() => fail('TIMEOUT', 'The request timed out.'));

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: spy.sleep });

    expect(spy.slept).toEqual([1000, 2000, 4000]);
    expect(rec.batches).toHaveLength(4);
    expect(result.failures.map((f) => f.stableUid)).toEqual(['cs-async-001', 'cs-span-002']);
    expect(result.failures.every((f) => f.code === 'TIMEOUT')).toBe(true);
    expect(result.created).toBe(0);
  });

  it('does not retry a VERSION_CONFLICT', async () => {
    const spy = sleepSpy();
    const rec = recorder(() => fail('VERSION_CONFLICT', 'Card has been modified by another user.'));

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: spy.sleep });

    expect(spy.slept).toEqual([]);
    expect(rec.batches).toHaveLength(1);
    expect(result.failures.every((f) => f.code === 'VERSION_CONFLICT')).toBe(true);
  });

  it('stops before the next batch once cancelled and reports what was not written', async () => {
    const controller = new AbortController();
    // Two batches: 500 then 1. The first lands, then the operator cancels, so the
    // second is never attempted.
    const actions = actionsFor(genDoc(IMPORT_BATCH_MAX_CARDS + 1));
    const rec = recorder((call, batch) => {
      if (call === 0) controller.abort();
      return ok({ created: batch.cards.length });
    });

    const result = await runImport(DECK_ID, actions, rec.writer, {
      signal: controller.signal,
      sleep: async () => {},
    });

    expect(rec.batches).toHaveLength(1);
    expect(result.cancelled).toBe(true);
    expect(result.notRun).toBe(1);
    // The unwritten cards are counted in notRun, not listed as failures.
    expect(result.failures).toEqual([]);
    expect(result.created).toBe(IMPORT_BATCH_MAX_CARDS);
  });

  it('marks the in-flight batch cancelled when the api reports CANCELLED', async () => {
    // A cancel that lands during the request, not between batches: the batch's
    // own cards are reported with IMPORT_CANCELLED so the operator can re-preview.
    const rec = recorder(() => fail('CANCELLED', 'The request was cancelled.'));

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: async () => {} });

    expect(result.cancelled).toBe(true);
    expect(result.failures.map((f) => f.code)).toEqual([IMPORT_CANCELLED, IMPORT_CANCELLED]);
    expect(result.failures[0].message).toContain('Re-run the preview');
  });

  it('classifies 429 and 5xx as retryable and 4xx as final', () => {
    expect(isRetryableImportFailure({ code: 'TIMEOUT', message: 't' })).toBe(true);
    expect(isRetryableImportFailure({ code: 'NETWORK_ERROR', message: 'n' })).toBe(true);
    expect(isRetryableImportFailure({ code: 'HTTP_429', message: 'r', httpStatus: 429 })).toBe(true);
    expect(isRetryableImportFailure({ code: 'HTTP_500', message: 's', httpStatus: 500 })).toBe(true);
    expect(isRetryableImportFailure({ code: 'HTTP_503', message: 's', httpStatus: 503 })).toBe(true);

    expect(isRetryableImportFailure({ code: 'VALIDATION_ERROR', message: 'v', httpStatus: 400 })).toBe(false);
    expect(isRetryableImportFailure({ code: 'ORDER_CONFLICT', message: 'o', httpStatus: 409 })).toBe(false);
    expect(isRetryableImportFailure({ code: 'PAYLOAD_TOO_LARGE', message: 'p', httpStatus: 413 })).toBe(false);
    expect(isRetryableImportFailure({ code: 'CANCELLED', message: 'c' })).toBe(false);
    expect(isRetryableImportFailure(null)).toBe(false);
    expect(isRetryableImportFailure(undefined)).toBe(false);
  });

  it('does not retry MIGRATION_REQUIRED', async () => {
    // A 503, so it looks 5xx, but it stays broken until migration 022 runs.
    expect(
      isRetryableImportFailure({ code: 'MIGRATION_REQUIRED', message: 'm', httpStatus: 503 }),
    ).toBe(false);

    const spy = sleepSpy();
    const rec = recorder(() =>
      fail('MIGRATION_REQUIRED', 'cards.uq_cards_deck_order is not deferrable yet', 503),
    );

    const result = await runImport(DECK_ID, actionsFor(SMALL_DOC), rec.writer, { sleep: spy.sleep });

    expect(spy.slept).toEqual([]);
    expect(rec.batches).toHaveLength(1);
    expect(result.failures.every((f) => f.code === 'MIGRATION_REQUIRED')).toBe(true);
  });

  it('adds the re-preview hint to an ORDER_CONFLICT', () => {
    const message = describeFailure({
      action: actionsFor(SMALL_DOC)[0],
      stableUid: 'cs-async-001',
      code: 'ORDER_CONFLICT',
      message: 'orderInDeck 5 is held by card other, which is not in this import.',
    });

    expect(message).toContain('Re-run the preview to refresh the reconciliation before retrying.');
  });
});

/**
 * The runner does not export its per-action body builder, so this test mirrors
 * the same field rules to measure serialized sizes. It is only used by the
 * IMPORT_BATCH_MAX_CHARS case above.
 */
function cardInputOf(action: ImportAction): ImportCardInput {
  const card = action.card;
  const text = (v: string | null | undefined): string => (v ?? '').trim();
  return {
    stableUid: card.stableUid,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: text(card.codeSnippet),
    codeLanguage: text(card.codeLanguage),
    realWorldUsage: text(card.realWorldUsage),
    topic: text(card.topic ?? null),
    mcq: card.mcq ?? null,
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
  };
}

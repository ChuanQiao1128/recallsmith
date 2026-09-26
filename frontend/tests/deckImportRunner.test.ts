import { describe, expect, it } from 'vitest';

import { parseDeckMarkdown, planImport } from '../src/lib/deckImport';
import {
  describeFailure,
  runImport,
  VERSION_CONFLICT,
  type ImportAction,
  type ImportBatchWriter,
  type ImportProgress,
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

function err(code: string, message: string): ApiResult<ImportCardsBatchResult> {
  return { success: false, data: null, error: { code, message }, traceId: 't' };
}

interface Recorder {
  writer: ImportBatchWriter;
  batches: ImportCardInput[][];
}

/** A fake batch writer whose response is chosen per call. */
function recorder(
  responses: (call: number, cards: ImportCardInput[]) => ApiResult<ImportCardsBatchResult> = () => ok(),
): Recorder {
  const batches: ImportCardInput[][] = [];
  let call = 0;
  const writer: ImportBatchWriter = {
    async importCards(params) {
      batches.push(params.cards);
      return responses(call++, params.cards);
    },
  };
  return { writer, batches };
}

const DOC = [
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

describe('runImport', () => {
  it('sends every planned card in one batch, in plan order', async () => {
    const rec = recorder((_call, cards) => ok({ created: cards.length }));

    const result = await runImport(DECK_ID, actionsFor(DOC), rec.writer, { sleep: async () => {} });

    expect(result).toEqual({ created: 2, updated: 0, failures: [], cancelled: false, notRun: 0 });
    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0].map((c) => c.stableUid)).toEqual(['cs-async-001', 'cs-span-002']);
    expect(rec.batches[0][0]).toMatchObject({
      stableUid: 'cs-async-001',
      difficulty: 2,
      orderInDeck: 5,
      codeLanguage: 'csharp',
    });
  });

  it('builds an update body from the plan action, without an expectedVersion field', async () => {
    const existing = [
      existingCard({
        id: 41,
        stableUid: 'cs-span-002',
        question: 'old question',
        difficulty: 3,
        orderInDeck: 10,
        explanation: 'old answer',
        version: 9,
      }),
    ];
    const rec = recorder((_call, cards) => ok({ created: 1, updated: cards.length - 1 }));

    const result = await runImport(DECK_ID, actionsFor(DOC, existing), rec.writer, { sleep: async () => {} });

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    const updated = rec.batches[0].find((c) => c.stableUid === 'cs-span-002');
    if (!updated) throw new Error('cs-span-002 was not sent');
    // F01 ignores expectedVersion, so the runner does not send it.
    expect(Object.hasOwn(updated, 'expectedVersion')).toBe(false);
  });

  it('reports every card in a refused batch and keeps the run going', async () => {
    const rec = recorder(() => err('VALIDATION_ERROR', 'cards[0] (cs-async-001): Question too long'));

    const result = await runImport(DECK_ID, actionsFor(DOC), rec.writer, { sleep: async () => {} });

    expect(result.created).toBe(0);
    expect(result.failures.map((f) => f.stableUid)).toEqual(['cs-async-001', 'cs-span-002']);
    expect(result.failures.every((f) => f.code === 'VALIDATION_ERROR')).toBe(true);
  });

  it('turns a thrown writer error into a batch failure rather than losing the run', async () => {
    const writer: ImportBatchWriter = {
      async importCards() {
        throw new Error('socket hang up');
      },
    };

    const result = await runImport(DECK_ID, actionsFor(DOC), writer, { sleep: async () => {} });

    expect(result.failures[0]).toMatchObject({ code: 'UNEXPECTED_ERROR', message: 'socket hang up' });
    expect(result.failures).toHaveLength(2);
  });

  it('reports progress once per batch, naming the batch last action', async () => {
    const seen: ImportProgress[] = [];
    const rec = recorder((_call, cards) => ok({ created: cards.length }));

    await runImport(DECK_ID, actionsFor(DOC), rec.writer, {
      sleep: async () => {},
      onProgress: (p) => seen.push(p),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ done: 2, total: 2 });
    expect(seen[0].current.card.stableUid).toBe('cs-span-002');
  });

  it('does nothing at all for an empty action list', async () => {
    const rec = recorder();

    const result = await runImport(DECK_ID, [], rec.writer, { sleep: async () => {} });

    expect(result).toEqual({ created: 0, updated: 0, failures: [], cancelled: false, notRun: 0 });
    expect(rec.batches).toEqual([]);
  });
});

describe('describeFailure', () => {
  it('tells the operator to re-preview on a version conflict', () => {
    const message = describeFailure({
      action: actionsFor(DOC)[0],
      stableUid: 'cs-async-001',
      code: VERSION_CONFLICT,
      message: 'Card has been modified by another user.',
    });

    expect(message).toContain('Re-run the preview');
  });

  it('passes other messages through unchanged', () => {
    const message = describeFailure({
      action: actionsFor(DOC)[0],
      stableUid: 'cs-async-001',
      code: 'SERVER_ERROR',
      message: 'boom',
    });

    expect(message).toBe('boom');
  });
});

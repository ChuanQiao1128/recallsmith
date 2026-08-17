import { describe, expect, it } from 'vitest';

import { parseDeckMarkdown, planImport } from '../src/lib/deckImport';
import {
  describeFailure,
  runImport,
  VERSION_CONFLICT,
  type CreateCardParams,
  type ImportAction,
  type ImportProgress,
  type ImportWriter,
  type UpdateCardParams,
} from '../src/lib/deckImportRunner';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';

const DECK_ID = 7;

function ok(): ApiResult<Card> {
  // The runner only reads `success` and `error`, so a null payload is enough
  // and keeps the fixtures from pretending to know the server's row shape.
  return { success: true, data: null, error: null, traceId: 't' };
}

function err(code: string, message: string): ApiResult<Card> {
  return { success: false, data: null, error: { code, message }, traceId: 't' };
}

interface Recorder {
  writer: ImportWriter;
  creates: CreateCardParams[];
  updates: UpdateCardParams[];
  /** Call order across both methods, as "create:uid" / "update:id". */
  calls: string[];
}

function recorder(
  responses: (params: CreateCardParams | UpdateCardParams) => ApiResult<Card> = () => ok(),
): Recorder {
  const creates: CreateCardParams[] = [];
  const updates: UpdateCardParams[] = [];
  const calls: string[] = [];

  const writer: ImportWriter = {
    async createCard(params) {
      creates.push(params);
      calls.push(`create:${params.stableUid}`);
      return responses(params);
    },
    async updateCard(params) {
      updates.push(params);
      calls.push(`update:${params.id}`);
      return responses(params);
    },
  };

  return { writer, creates, updates, calls };
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
  it('creates every planned card serially, in plan order', async () => {
    const rec = recorder();

    const result = await runImport(DECK_ID, actionsFor(DOC), rec.writer);

    expect(result).toEqual({ created: 2, updated: 0, failures: [] });
    expect(rec.calls).toEqual(['create:cs-async-001', 'create:cs-span-002']);
    expect(rec.updates).toHaveLength(0);
    expect(rec.creates[0]).toMatchObject({
      deckId: DECK_ID,
      stableUid: 'cs-async-001',
      difficulty: 2,
      orderInDeck: 0,
      codeLanguage: 'csharp',
    });
    expect(rec.creates[1]).toMatchObject({ stableUid: 'cs-span-002', orderInDeck: 10 });
  });

  it('sends the version captured at plan time so a stale edit cannot be clobbered', async () => {
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
    const rec = recorder();

    const result = await runImport(DECK_ID, actionsFor(DOC, existing), rec.writer);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]).toMatchObject({ id: 41, expectedVersion: 9, deckId: DECK_ID });
  });

  it('clears a removed optional section with "" instead of omitting the field', async () => {
    // Omitting the key would mean "leave it alone" to the API, so the snippet
    // would survive its own deletion and the import would never converge.
    const stripped = DOC.split('\n')
      .filter((line) => line !== 'CODE: csharp' && !line.startsWith('var v ='))
      .join('\n');

    const existing = [
      existingCard({
        id: 41,
        stableUid: 'cs-async-001',
        question: 'Does awaiting a completed Task switch threads?',
        difficulty: 2,
        orderInDeck: 0,
        explanation: 'Not necessarily; the fast path continues synchronously.',
        codeSnippet: 'var v = await Task.FromResult(42);',
        codeLanguage: 'csharp',
        realWorldUsage: 'Hot paths stay cheap because of the fast path.',
        version: 3,
      }),
    ];
    const rec = recorder();

    await runImport(DECK_ID, actionsFor(stripped, existing), rec.writer);

    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].codeSnippet).toBe('');
    expect(rec.updates[0].codeLanguage).toBe('');
  });

  it('records a failed card and keeps writing the rest', async () => {
    const rec = recorder((params) =>
      'stableUid' in params && params.stableUid === 'cs-async-001'
        ? err('VALIDATION_ERROR', 'Question too long')
        : ok(),
    );

    const result = await runImport(DECK_ID, actionsFor(DOC), rec.writer);

    expect(result.created).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      stableUid: 'cs-async-001',
      code: 'VALIDATION_ERROR',
    });
    // The second card must still have been attempted.
    expect(rec.calls).toEqual(['create:cs-async-001', 'create:cs-span-002']);
  });

  it('turns a thrown error into a failure rather than losing the remaining cards', async () => {
    const calls: string[] = [];
    const writer: ImportWriter = {
      async createCard(params) {
        calls.push(String(params.stableUid));
        if (params.stableUid === 'cs-async-001') throw new Error('socket hang up');
        return ok();
      },
      async updateCard() {
        return ok();
      },
    };

    const result = await runImport(DECK_ID, actionsFor(DOC), writer);

    expect(calls).toEqual(['cs-async-001', 'cs-span-002']);
    expect(result.created).toBe(1);
    expect(result.failures[0]).toMatchObject({
      code: 'UNEXPECTED_ERROR',
      message: 'socket hang up',
    });
  });

  it('reports progress once per action, including failed ones', async () => {
    const seen: ImportProgress[] = [];
    const rec = recorder(() => err('SERVER_ERROR', 'boom'));

    await runImport(DECK_ID, actionsFor(DOC), rec.writer, (p) => seen.push(p));

    expect(seen.map((p) => p.done)).toEqual([1, 2]);
    expect(seen.every((p) => p.total === 2)).toBe(true);
    expect(seen[1].current.card.stableUid).toBe('cs-span-002');
  });

  it('retries only the failed actions when the failure list is fed back in', async () => {
    let firstAttempt = true;
    const rec = recorder((params) => {
      if ('stableUid' in params && params.stableUid === 'cs-span-002' && firstAttempt) {
        return err('SERVER_ERROR', 'boom');
      }
      return ok();
    });

    const actions = actionsFor(DOC);
    const first = await runImport(DECK_ID, actions, rec.writer);
    expect(first.failures).toHaveLength(1);

    firstAttempt = false;
    const retry = await runImport(
      DECK_ID,
      first.failures.map((f) => f.action),
      rec.writer,
    );

    expect(retry).toEqual({ created: 1, updated: 0, failures: [] });
    expect(rec.calls).toEqual([
      'create:cs-async-001',
      'create:cs-span-002',
      'create:cs-span-002',
    ]);
  });

  it('does nothing at all for an empty action list', async () => {
    const rec = recorder();

    const result = await runImport(DECK_ID, [], rec.writer);

    expect(result).toEqual({ created: 0, updated: 0, failures: [] });
    expect(rec.calls).toEqual([]);
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

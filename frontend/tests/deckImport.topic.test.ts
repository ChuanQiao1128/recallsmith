import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  parseDeckMarkdown,
  planImport,
  serializeDeckMarkdown,
  TOPIC_MAX_LENGTH,
  type ParsedCard,
} from '../src/lib/deckImport';
import {
  runImport,
  type CreateCardParams,
  type ImportWriter,
  type UpdateCardParams,
} from '../src/lib/deckImportRunner';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';

function doc(lines: string[]): string {
  return lines.join('\n');
}

/** A full Card the way the server hands one back, with topic defaulting to the parsed shape. */
function serverCard(card: ParsedCard, overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
    deckId: 7,
    stableUid: card.stableUid,
    question: card.question,
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
    explanation: card.explanation,
    realWorldUsage: card.realWorldUsage,
    codeSnippet: card.codeSnippet,
    codeLanguage: card.codeLanguage,
    topic: card.topic ?? null,
    revision: 1,
    version: 1,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function ok(): ApiResult<Card> {
  return { success: true, data: null, error: null, traceId: 't' };
}

interface Recorder {
  writer: ImportWriter;
  creates: CreateCardParams[];
  updates: UpdateCardParams[];
}

function recorder(): Recorder {
  const creates: CreateCardParams[] = [];
  const updates: UpdateCardParams[] = [];

  const writer: ImportWriter = {
    async createCard(params) {
      creates.push(params);
      return ok();
    },
    async updateCard(params) {
      updates.push(params);
      return ok();
    },
  };

  return { writer, creates, updates };
}

function firstCard(text: string): ParsedCard {
  const parsed = parseDeckMarkdown(text);
  return parsed.cards[0];
}

describe('TOPIC: marker', () => {
  it('reads a TOPIC: line into card.topic, trimmed', () => {
    const spaced = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d2', 'TOPIC:   Networking  ', 'Q:', 'q', 'A:', 'a']),
    );
    expect(spaced.errors).toEqual([]);
    expect(spaced.cards[0].topic).toBe('Networking');

    const tight = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d2', 'TOPIC:Networking', 'Q:', 'q', 'A:', 'a']),
    );
    expect(tight.errors).toEqual([]);
    expect(tight.cards[0].topic).toBe('Networking');
  });

  it('leaves topic absent, not null, when there is no TOPIC: line', () => {
    const parsed = parseDeckMarkdown(doc(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']));
    expect(parsed.errors).toEqual([]);
    expect(Object.hasOwn(parsed.cards[0], 'topic')).toBe(false);
    expect(parsed.cards[0]).toEqual({
      stableUid: 'a-1',
      difficulty: 0,
      question: 'q',
      explanation: 'a',
      codeSnippet: null,
      codeLanguage: null,
      realWorldUsage: null,
      orderInDeck: 5,
      sourceLine: 2,
    });
  });

  it('accepts TOPIC: anywhere inside the card without opening a section', () => {
    const parsed = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a1', 'TOPIC: Storage', 'a2']),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[0].explanation).toBe('a1\na2');
    expect(parsed.cards[0].topic).toBe('Storage');
  });

  it('flags an empty TOPIC: line as BAD_TOPIC and drops the card', () => {
    for (const line of ['TOPIC:', 'TOPIC:    ']) {
      const parsed = parseDeckMarkdown(doc(['# deck: d1', '## a-1 | d0', line, 'Q:', 'q', 'A:', 'a']));
      expect(parsed.cards).toEqual([]);
      expect(parsed.errors.map((e) => [e.code, e.line, e.stableUid])).toEqual([['BAD_TOPIC', 3, 'a-1']]);
    }
  });

  it('flags a topic longer than TOPIC_MAX_LENGTH as BAD_TOPIC and accepts one exactly at the limit', () => {
    const tooLong = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d0', 'TOPIC: ' + 'x'.repeat(TOPIC_MAX_LENGTH + 1), 'Q:', 'q', 'A:', 'a']),
    );
    expect(tooLong.cards).toEqual([]);
    expect(tooLong.errors.map((e) => [e.code, e.line, e.stableUid])).toEqual([['BAD_TOPIC', 3, 'a-1']]);

    const atLimit = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d0', 'TOPIC: ' + 'x'.repeat(TOPIC_MAX_LENGTH), 'Q:', 'q', 'A:', 'a']),
    );
    expect(atLimit.errors).toEqual([]);
    expect(atLimit.cards[0].topic?.length).toBe(TOPIC_MAX_LENGTH);
  });

  it('keeps the first TOPIC: and reports the second as DUPLICATE_TOPIC', () => {
    const parsed = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d0', 'TOPIC: First', 'TOPIC: Second', 'Q:', 'q', 'A:', 'a']),
    );
    expect(parsed.cards[0].topic).toBe('First');
    expect(parsed.errors.map((e) => [e.code, e.line, e.stableUid])).toEqual([['DUPLICATE_TOPIC', 4, 'a-1']]);
  });

  it('reports a TOPIC: line before any card as TEXT_BEFORE_CARD', () => {
    const parsed = parseDeckMarkdown(
      doc(['# deck: d1', 'TOPIC: Early', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']),
    );
    expect(parsed.errors.map((e) => e.code)).toEqual(['TEXT_BEFORE_CARD']);
    expect(parsed.errors[0].line).toBe(2);
    expect(Object.hasOwn(parsed.cards[0], 'topic')).toBe(false);
  });

  it('reports text after TOPIC: and before the first section as TEXT_BEFORE_SECTION', () => {
    const parsed = parseDeckMarkdown(
      doc(['# deck: d1', '## a-1 | d0', 'TOPIC: t', 'stray', 'Q:', 'q', 'A:', 'a']),
    );
    expect(parsed.errors.map((e) => e.code)).toEqual(['TEXT_BEFORE_SECTION']);
    expect(parsed.errors[0].line).toBe(4);
    expect(parsed.cards[0].topic).toBe('t');
  });
});

describe('serializeDeckMarkdown with topic', () => {
  it('emits TOPIC: directly under the card header and before Q:', () => {
    const tagged = firstCard(doc(['# deck: d1', '## a-1 | d2', 'TOPIC: Networking', 'Q:', 'q', 'A:', 'a']));
    const lines = serializeDeckMarkdown('d1', [tagged]).split('\n');
    expect(lines.slice(2, 5)).toEqual(['## a-1 | d2', 'TOPIC: Networking', 'Q:']);

    const untagged = firstCard(doc(['# deck: d1', '## a-1 | d2', 'Q:', 'q', 'A:', 'a']));
    const bare = serializeDeckMarkdown('d1', [untagged]).split('\n');
    expect(bare[3]).toBe('Q:');
    expect(bare.some((l) => l.startsWith('TOPIC:'))).toBe(false);
  });

  it('round trips any topic through serialize and parse', () => {
    const words = ['alpha', 'beta', 'gamma', 'storage', 'networking', 'databases'];
    const topicArb = fc
      .array(fc.constantFrom(...words), { minLength: 1, maxLength: 5 })
      .map((w) => w.join(' '));

    fc.assert(
      fc.property(topicArb, fc.boolean(), (topic, tagged) => {
        const base = firstCard(doc(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']));
        const card: ParsedCard = tagged ? { ...base, topic } : base;
        const parsed = parseDeckMarkdown(serializeDeckMarkdown('d1', [card]));
        expect(parsed.errors).toEqual([]);
        expect(parsed.cards[0].topic).toBe(tagged ? topic : undefined);
        expect(Object.hasOwn(parsed.cards[0], 'topic')).toBe(tagged);
      }),
    );
  });
});

describe('planImport with topic', () => {
  it('lists topic last in changedFields', () => {
    const card = firstCard(
      doc([
        '# deck: d1',
        '## a-1 | d2',
        'TOPIC: Networking',
        'Q:',
        'q',
        'A:',
        'a',
        'CODE: ts',
        'const x = 1;',
        'USAGE:',
        'use it',
      ]),
    );
    const existing = [
      serverCard(card, {
        id: 1,
        version: 1,
        question: 'other',
        difficulty: 0,
        orderInDeck: 10,
        explanation: 'other',
        codeSnippet: 'other',
        codeLanguage: 'sql',
        realWorldUsage: 'other',
        topic: 'other',
      }),
    ];
    const plan = planImport({ cards: [card] }, existing);
    expect(plan.updates[0].changedFields).toEqual([
      'question',
      'difficulty',
      'orderInDeck',
      'explanation',
      'codeSnippet',
      'codeLanguage',
      'realWorldUsage',
      'topic',
    ]);
  });

  it('treats a server null topic and an absent TOPIC: line as unchanged', () => {
    const untagged = firstCard(doc(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']));
    for (const serverTopic of [null, '']) {
      const plan = planImport({ cards: [untagged] }, [serverCard(untagged, { id: 1, topic: serverTopic })]);
      expect(plan.updates).toEqual([]);
      expect(plan.unchanged).toHaveLength(1);
    }

    const tagged = firstCard(doc(['# deck: d1', '## a-1 | d0', 'TOPIC: Networking', 'Q:', 'q', 'A:', 'a']));
    const trimPlan = planImport({ cards: [tagged] }, [serverCard(tagged, { id: 1, topic: '  Networking ' })]);
    expect(trimPlan.updates).toEqual([]);
    expect(trimPlan.unchanged).toHaveLength(1);
  });

  it('plans an update with changedFields [topic] when only the topic changed', () => {
    const tagged = firstCard(doc(['# deck: d1', '## a-1 | d0', 'TOPIC: New', 'Q:', 'q', 'A:', 'a']));
    const changed = planImport({ cards: [tagged] }, [serverCard(tagged, { id: 1, topic: 'Old' })]);
    expect(changed.updates[0].changedFields).toEqual(['topic']);

    const untagged = firstCard(doc(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a']));
    const removed = planImport({ cards: [untagged] }, [serverCard(untagged, { id: 1, topic: 'Old' })]);
    expect(removed.updates[0].changedFields).toEqual(['topic']);
  });
});

describe('runImport with topic', () => {
  it('sends topic on create and update, and an empty string when the file has none', async () => {
    const parsed = parseDeckMarkdown(
      doc([
        '# deck: d1',
        '## a-1 | d0',
        'TOPIC: Networking',
        'Q:',
        'q',
        'A:',
        'a',
        '## a-2 | d0',
        'Q:',
        'q',
        'A:',
        'a',
      ]),
    );
    const a1 = parsed.cards[0];
    const existing = [serverCard(a1, { id: 41, version: 3, topic: 'Old' })];
    const plan = planImport(parsed, existing);
    expect(plan.updates).toHaveLength(1);
    expect(plan.creates).toHaveLength(1);

    const rec = recorder();
    const result = await runImport(7, [...plan.creates, ...plan.updates], rec.writer);
    expect(rec.creates[0]).toMatchObject({ stableUid: 'a-2', topic: '' });
    expect(rec.updates[0]).toMatchObject({ id: 41, expectedVersion: 3, topic: 'Networking' });
    expect(result).toEqual({ created: 1, updated: 1, failures: [] });
  });
});

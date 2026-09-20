import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  formatIssue,
  parseDeckMarkdown,
  planImport,
  serializeDeckMarkdown,
  validateCards,
  type DeckCardContent,
  type ImportIssueCode,
  type ParsedCard,
  type ParsedDeck,
} from '../src/lib/deckImport';
import type { Card } from '../src/types/card';

// The document from docs/console-import-plan.md, copied verbatim. If the shared
// format ever drifts, this is the test that notices.
const EXAMPLE_DOC = [
  '# deck: csharp-backend-fundamentals',
  '',
  '## cs-async-001 | d2',
  'Q:',
  'await 一个已完成的 Task 时会发生线程切换吗?为什么?',
  'A:',
  '不一定。await 先检查 Task 状态,已完成则同步继续执行,',
  '不排队回调,这是 fast path。',
  'CODE: csharp',
  'var t = Task.FromResult(42);',
  'var v = await t; // no context switch here',
  'USAGE:',
  '热路径上大量 await 已完成任务时,fast path 是性能不塌的原因。',
].join('\n');

function codesOf(deck: ParsedDeck): ImportIssueCode[] {
  return deck.errors.map((e) => e.code);
}

/** Shape a parsed card the way the server would hand it back after a write. */
function toExistingCard(card: ParsedCard, id: number, version: number): Card {
  return {
    id,
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
    version,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** Content plus order, dropping sourceLine so line shifts do not fail a diff. */
function contentOf(deck: ParsedDeck): Array<DeckCardContent & { orderInDeck: number }> {
  return deck.cards.map((card) => ({
    stableUid: card.stableUid,
    difficulty: card.difficulty,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: card.codeSnippet,
    codeLanguage: card.codeLanguage,
    realWorldUsage: card.realWorldUsage,
    ...(card.topic !== undefined ? { topic: card.topic } : {}),
    orderInDeck: card.orderInDeck,
  }));
}

describe('parseDeckMarkdown: the documented example', () => {
  const deck = parseDeckMarkdown(EXAMPLE_DOC);

  it('reports no errors', () => {
    expect(deck.errors).toEqual([]);
  });

  it('reads the deck slug', () => {
    expect(deck.deckSlug).toBe('csharp-backend-fundamentals');
  });

  it('reads every card field', () => {
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0]).toEqual({
      stableUid: 'cs-async-001',
      difficulty: 2,
      question: 'await 一个已完成的 Task 时会发生线程切换吗?为什么?',
      explanation: '不一定。await 先检查 Task 状态,已完成则同步继续执行,\n不排队回调,这是 fast path。',
      codeSnippet: 'var t = Task.FromResult(42);\nvar v = await t; // no context switch here',
      codeLanguage: 'csharp',
      realWorldUsage: '热路径上大量 await 已完成任务时,fast path 是性能不塌的原因。',
      orderInDeck: 0,
      sourceLine: 3,
    });
  });

  it('numbers orderInDeck by ten so cards can be inserted later', () => {
    const twoCards = parseDeckMarkdown(
      ['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a', '## a-2 | d1', 'Q:', 'q', 'A:', 'a'].join('\n'),
    );
    expect(twoCards.errors).toEqual([]);
    expect(twoCards.cards.map((c) => c.orderInDeck)).toEqual([0, 10]);
  });

  it('leaves optional sections null when absent', () => {
    const minimal = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(minimal.cards[0].codeSnippet).toBeNull();
    expect(minimal.cards[0].codeLanguage).toBeNull();
    expect(minimal.cards[0].realWorldUsage).toBeNull();
  });
});

describe('parseDeckMarkdown: errors carry line numbers', () => {
  it('flags a missing A: section at the card header line', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '', '## a-1 | d2', 'Q:', 'why?'].join('\n'));
    expect(deck.cards).toEqual([]);
    expect(deck.errors).toEqual([
      { code: 'MISSING_ANSWER', line: 3, message: 'Card "a-1" has no A: content.', stableUid: 'a-1' },
    ]);
    expect(formatIssue(deck.errors[0])).toBe('line 3: Card "a-1" has no A: content.');
  });

  it('flags an empty A: section at the marker line', () => {
    const deck = parseDeckMarkdown(
      ['# deck: d1', '## a-1 | d2', 'Q:', 'why?', 'A:', '', '## a-2 | d1', 'Q:', 'q', 'A:', 'a'].join('\n'),
    );
    expect(deck.errors).toHaveLength(1);
    expect(deck.errors[0].code).toBe('MISSING_ANSWER');
    expect(deck.errors[0].line).toBe(5);
    // One broken card does not discard the good ones.
    expect(deck.cards.map((c) => c.stableUid)).toEqual(['a-2']);
    expect(deck.cards[0].orderInDeck).toBe(0);
  });

  it('flags a missing Q: section', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d2', 'A:', 'answer'].join('\n'));
    expect(codesOf(deck)).toEqual(['MISSING_QUESTION']);
    expect(deck.errors[0].line).toBe(2);
  });

  it('flags an out of range difficulty', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '', '## a-1 | d9', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(deck.cards).toEqual([]);
    expect(codesOf(deck)).toContain('BAD_DIFFICULTY');
    expect(deck.errors[0].line).toBe(3);
    expect(deck.errors[0].stableUid).toBe('a-1');
  });

  it('flags a difficulty that is not written as d<n>', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | hard', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toContain('BAD_DIFFICULTY');
    expect(deck.errors[0].line).toBe(2);
  });

  it('flags a card header without the difficulty field', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(deck.cards).toEqual([]);
    expect(codesOf(deck)).toContain('BAD_CARD_HEADER');
    expect(deck.errors[0].line).toBe(2);
  });

  it('flags a duplicate uid at the second occurrence and names the first line', () => {
    const deck = parseDeckMarkdown(
      [
        '# deck: d1',
        '## a-1 | d2',
        'Q:',
        'q1',
        'A:',
        'a1',
        '',
        '## a-1 | d3',
        'Q:',
        'q2',
        'A:',
        'a2',
      ].join('\n'),
    );
    expect(codesOf(deck)).toEqual(['DUPLICATE_UID']);
    expect(deck.errors[0].line).toBe(8);
    expect(deck.errors[0].message).toContain('line 2');
    expect(deck.errors[0].stableUid).toBe('a-1');
  });

  it('flags a document with no deck header at line 1', () => {
    const deck = parseDeckMarkdown(['## a-1 | d2', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(deck.deckSlug).toBeNull();
    expect(codesOf(deck)).toEqual(['MISSING_DECK_HEADER']);
    expect(deck.errors[0].line).toBe(1);
    // The cards still parse, so the UI can show a preview and ask for a deck.
    expect(deck.cards).toHaveLength(1);
  });

  it('flags an empty document', () => {
    expect(codesOf(parseDeckMarkdown('   \n\n'))).toEqual(['EMPTY_DOCUMENT']);
  });

  it('flags a second deck header', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '# deck: d2', '## a-1 | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toEqual(['DUPLICATE_DECK_HEADER']);
    expect(deck.errors[0].line).toBe(2);
    expect(deck.deckSlug).toBe('d1');
  });

  it('flags a bad deck slug', () => {
    const deck = parseDeckMarkdown(['# deck: Not A Slug', '## a-1 | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toEqual(['BAD_DECK_SLUG']);
    expect(deck.deckSlug).toBeNull();
  });

  it('flags a bad uid format', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## Not_A_UID! | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toEqual(['BAD_UID_FORMAT']);
    expect(deck.errors[0].line).toBe(2);
  });

  it('accepts the ensureStableUid fallback shape', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## card_1762000000000_ab12cd | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(deck.errors).toEqual([]);
  });

  it('reports stray text once per stretch, not once per line', () => {
    const deck = parseDeckMarkdown(['# deck: d1', 'intro line', 'another intro line', '## a-1 | d0', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toEqual(['TEXT_BEFORE_CARD']);
    expect(deck.errors[0].line).toBe(2);
    expect(deck.cards).toHaveLength(1);
  });

  it('reports text between the card header and its first marker', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'loose text', 'Q:', 'q', 'A:', 'a'].join('\n'));
    expect(codesOf(deck)).toEqual(['TEXT_BEFORE_SECTION']);
    expect(deck.errors[0].line).toBe(3);
  });

  it('keeps the first copy of a repeated section and says so', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'Q:', 'first', 'A:', 'a', 'Q:', 'second'].join('\n'));
    expect(codesOf(deck)).toEqual(['DUPLICATE_SECTION']);
    expect(deck.errors[0].line).toBe(7);
    expect(deck.cards[0].question).toBe('first');
  });
});

describe('parseDeckMarkdown: lexing rules', () => {
  it('treats markers as markers only at column 0', () => {
    const deck = parseDeckMarkdown(
      ['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a', 'CODE: csharp', '  // A: not a marker', '  ## nor this'].join('\n'),
    );
    expect(deck.errors).toEqual([]);
    expect(deck.cards[0].codeSnippet).toBe('  // A: not a marker\n  ## nor this');
  });

  it('accepts content on the marker line itself', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'Q: inline question', 'A: inline answer'].join('\n'));
    expect(deck.errors).toEqual([]);
    expect(deck.cards[0].question).toBe('inline question');
    expect(deck.cards[0].explanation).toBe('inline answer');
  });

  it('accepts a bare CODE: with no language', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a', 'CODE:', 'x = 1'].join('\n'));
    expect(deck.errors).toEqual([]);
    expect(deck.cards[0].codeSnippet).toBe('x = 1');
    expect(deck.cards[0].codeLanguage).toBeNull();
  });

  it('drops a code language that has no snippet', () => {
    const deck = parseDeckMarkdown(['# deck: d1', '## a-1 | d0', 'Q:', 'q', 'A:', 'a', 'CODE: csharp'].join('\n'));
    expect(deck.cards[0].codeSnippet).toBeNull();
    expect(deck.cards[0].codeLanguage).toBeNull();
  });

  it('parses CRLF and a BOM the same as plain LF', () => {
    const lf = parseDeckMarkdown(EXAMPLE_DOC);
    const crlf = parseDeckMarkdown(`\uFEFF${EXAMPLE_DOC.replace(/\n/g, '\r\n')}`);
    expect(crlf).toEqual(lf);
  });
});

describe('validateCards', () => {
  const base: ParsedCard = {
    stableUid: 'a-1',
    difficulty: 2,
    question: 'q',
    explanation: 'a',
    codeSnippet: null,
    codeLanguage: null,
    realWorldUsage: null,
    orderInDeck: 0,
    sourceLine: 3,
  };

  it('passes a well formed card', () => {
    expect(validateCards([base])).toEqual([]);
  });

  it('rejects a duplicate uid even when the cards differ', () => {
    const issues = validateCards([base, { ...base, question: 'other', orderInDeck: 10, sourceLine: 9 }]);
    expect(issues.map((i) => i.code)).toEqual(['DUPLICATE_UID']);
    expect(issues[0].line).toBe(9);
  });

  it('rejects a non integer difficulty', () => {
    expect(validateCards([{ ...base, difficulty: 1.5 }]).map((i) => i.code)).toEqual(['BAD_DIFFICULTY']);
  });

  it('rejects whitespace only content', () => {
    const issues = validateCards([{ ...base, question: '   ', explanation: '\t' }]);
    expect(issues.map((i) => i.code)).toEqual(['MISSING_QUESTION', 'MISSING_ANSWER']);
  });
});

describe('planImport', () => {
  const doc = [
    '# deck: d1',
    '## a-1 | d2',
    'Q:',
    'q1',
    'A:',
    'a1',
    '## a-2 | d3',
    'Q:',
    'q2',
    'A:',
    'a2',
  ].join('\n');
  const parsed = parseDeckMarkdown(doc);

  it('creates everything against an empty deck', () => {
    const plan = planImport(parsed, []);
    expect(plan.creates.map((c) => c.card.stableUid)).toEqual(['a-1', 'a-2']);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('reports unchanged when the deck already matches', () => {
    const existing = parsed.cards.map((c, i) => toExistingCard(c, 100 + i, 4));
    const plan = planImport(parsed, existing);
    expect(plan.unchanged.map((u) => [u.card.stableUid, u.existingId])).toEqual([
      ['a-1', 100],
      ['a-2', 101],
    ]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it('treats null and empty string optionals as the same content', () => {
    const existing = parsed.cards.map((c, i) => ({
      ...toExistingCard(c, 100 + i, 4),
      realWorldUsage: '',
      codeSnippet: '',
      codeLanguage: null,
    }));
    expect(planImport(parsed, existing).updates).toEqual([]);
    expect(planImport(parsed, existing).unchanged).toHaveLength(2);
  });

  it('produces exactly one update when one answer changed, carrying the server version', () => {
    const existing = parsed.cards.map((c, i) => toExistingCard(c, 100 + i, 4 + i));
    existing[1].explanation = 'stale answer';

    const plan = planImport(parsed, existing);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].card.stableUid).toBe('a-2');
    expect(plan.updates[0].existingId).toBe(101);
    // Optimistic concurrency: the plan pins the version it saw.
    expect(plan.updates[0].expectedVersion).toBe(5);
    expect(plan.updates[0].changedFields).toEqual(['explanation']);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.creates).toEqual([]);
  });

  it('reconciles on stableUid, not on question text or row id', () => {
    const existing = [toExistingCard({ ...parsed.cards[0], question: 'totally different' }, 55, 9)];
    const plan = planImport(parsed, existing);
    expect(plan.updates.map((u) => [u.card.stableUid, u.existingId, u.expectedVersion])).toEqual([
      ['a-1', 55, 9],
    ]);
    expect(plan.creates.map((c) => c.card.stableUid)).toEqual(['a-2']);
  });

  it('lists every changed field for the preview', () => {
    const existing = [
      { ...toExistingCard(parsed.cards[0], 100, 2), difficulty: 0, codeSnippet: 'x', codeLanguage: 'sql' },
      toExistingCard(parsed.cards[1], 101, 2),
    ];
    expect(planImport(parsed, existing).updates[0].changedFields).toEqual([
      'difficulty',
      'codeSnippet',
      'codeLanguage',
    ]);
  });

  it('renumbers cards that moved, so document order is what the deck ends up with', () => {
    // Nothing else covers orderInDeck as a reconciled field: dropping it from
    // the comparison left every other test green, which would have let a
    // reordered document import as a silent no-op.
    const existing = parsed.cards.map((c, i) => toExistingCard(c, 100 + i, 3));
    const reordered = parseDeckMarkdown(
      ['# deck: d1', '## a-2 | d3', 'Q:', 'q2', 'A:', 'a2', '## a-1 | d2', 'Q:', 'q1', 'A:', 'a1'].join('\n'),
    );

    const plan = planImport(reordered, existing);
    expect(plan.updates.map((u) => [u.card.stableUid, u.card.orderInDeck, u.changedFields])).toEqual([
      ['a-2', 0, ['orderInDeck']],
      ['a-1', 10, ['orderInDeck']],
    ]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.creates).toEqual([]);
  });

  it('never applies a duplicated uid twice', () => {
    const dup = parseDeckMarkdown(
      ['# deck: d1', '## a-1 | d2', 'Q:', 'q1', 'A:', 'a1', '## a-1 | d2', 'Q:', 'q2', 'A:', 'a2'].join('\n'),
    );
    const plan = planImport(dup, []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.conflicts.map((c) => c.reason)).toEqual(['DUPLICATE_UID_IN_FILE']);
  });

  it('refuses a card whose uid is malformed', () => {
    const bad = parseDeckMarkdown(['# deck: d1', '## BAD.UID | d2', 'Q:', 'q', 'A:', 'a'].join('\n'));
    const plan = planImport(bad, []);
    expect(plan.creates).toEqual([]);
    expect(plan.conflicts.map((c) => c.reason)).toEqual(['INVALID_CARD']);
  });

  it('refuses to pick a target when the deck already has a duplicated uid', () => {
    const existing = [
      toExistingCard(parsed.cards[0], 100, 1),
      toExistingCard(parsed.cards[0], 200, 1),
      toExistingCard(parsed.cards[1], 101, 1),
    ];
    const plan = planImport(parsed, existing);
    expect(plan.conflicts.map((c) => [c.reason, c.card.stableUid])).toEqual([
      ['AMBIGUOUS_EXISTING_UID', 'a-1'],
    ]);
  });

  it('refuses to recreate a uid that is only soft deleted', () => {
    const existing = [{ ...toExistingCard(parsed.cards[0], 100, 1), isDeleted: 1 }];
    const plan = planImport(parsed, existing);
    expect(plan.conflicts.map((c) => c.reason)).toEqual(['EXISTING_SOFT_DELETED']);
    expect(plan.creates.map((c) => c.card.stableUid)).toEqual(['a-2']);
  });
});

// ---------------------- property based ----------------------

const UID_SEGMENTS = ['cs', 'async', 'core', 'db', '001', '002', 'x9', 'net'];
const WORDS = ['alpha', 'beta', 'gamma', 'fast', 'path', '状态', '回调', 'x', '42', 'await'];

const uidArb = fc
  .array(fc.constantFrom(...UID_SEGMENTS), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('-'));

const lineArb = fc
  .array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 })
  .map((words) => words.join(' '));

const textArb = fc.array(lineArb, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n'));

// Topics are single line, trim-stable and far below TOPIC_MAX_LENGTH (4 words of WORDS ≤ 23 chars).
const topicArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 4 }).map((words) => words.join(' '));

// Code bodies may be indented, which the column 0 marker rule must preserve.
const codeArb = fc
  .array(
    fc.oneof(
      lineArb,
      lineArb.map((l) => `  ${l}`),
    ),
    { minLength: 1, maxLength: 3 },
  )
  .map((lines) => lines.join('\n'));

const cardArb: fc.Arbitrary<DeckCardContent> = fc
  .record({
    stableUid: uidArb,
    difficulty: fc.integer({ min: 0, max: 4 }),
    question: textArb,
    explanation: textArb,
    code: fc.option(
      fc.record({
        snippet: codeArb,
        language: fc.option(fc.constantFrom('csharp', 'sql', 'ts'), { nil: null }),
      }),
      { nil: null },
    ),
    realWorldUsage: fc.option(textArb, { nil: null }),
    topic: fc.option(topicArb, { nil: undefined }),
  })
  .map((r) => ({
    stableUid: r.stableUid,
    difficulty: r.difficulty,
    question: r.question,
    explanation: r.explanation,
    codeSnippet: r.code ? r.code.snippet : null,
    codeLanguage: r.code ? r.code.language : null,
    realWorldUsage: r.realWorldUsage,
    ...(r.topic !== undefined ? { topic: r.topic } : {}),
  }));

const deckArb = fc.record({
  slug: fc.constantFrom('csharp-backend-fundamentals', 'deck-two', 'x1', 'net-core-002'),
  cards: fc.uniqueArray(cardArb, {
    minLength: 1,
    maxLength: 6,
    selector: (c) => c.stableUid,
  }),
});

const blankLineArb = fc.constantFrom('', '   ', '\t', '  \t ');

describe('deckImport properties', () => {
  it('round trips: serialize then parse returns every field unchanged', () => {
    fc.assert(
      fc.property(deckArb, ({ slug, cards }) => {
        const parsed = parseDeckMarkdown(serializeDeckMarkdown(slug, cards));
        expect(parsed.errors).toEqual([]);
        expect(parsed.deckSlug).toBe(slug);
        expect(contentOf(parsed)).toEqual(
          cards.map((c, i) => ({ ...c, orderInDeck: i * 10 })),
        );
      }),
    );
  });

  it('blank lines and CRLF anywhere do not change the parse result', () => {
    fc.assert(
      fc.property(
        deckArb,
        fc.array(fc.tuple(fc.nat(), blankLineArb), { maxLength: 10 }),
        fc.boolean(),
        ({ slug, cards }, injections, useCrlf) => {
          const markdown = serializeDeckMarkdown(slug, cards);
          const baseline = parseDeckMarkdown(markdown);

          const lines = markdown.split('\n');
          for (const [position, filler] of injections) {
            lines.splice(position % (lines.length + 1), 0, filler);
          }
          const mangled = lines.join(useCrlf ? '\r\n' : '\n');

          const after = parseDeckMarkdown(mangled);
          expect(after.errors).toEqual([]);
          expect(after.deckSlug).toBe(baseline.deckSlug);
          expect(contentOf(after)).toEqual(contentOf(baseline));
        },
      ),
    );
  });

  it('any document with a repeated uid is rejected', () => {
    const duplicatedDeckArb = fc
      .record({
        slug: fc.constant('dup-deck'),
        cards: fc.uniqueArray(cardArb, { minLength: 2, maxLength: 6, selector: (c) => c.stableUid }),
        offset: fc.nat(),
      })
      .map(({ slug, cards, offset }) => {
        const copies = cards.map((c) => ({ ...c }));
        const victim = 1 + (offset % (copies.length - 1));
        copies[victim].stableUid = copies[0].stableUid;
        return { slug, cards: copies, duplicatedUid: copies[0].stableUid };
      });

    fc.assert(
      fc.property(duplicatedDeckArb, ({ slug, cards, duplicatedUid }) => {
        const parsed = parseDeckMarkdown(serializeDeckMarkdown(slug, cards));

        expect(parsed.errors.some((e) => e.code === 'DUPLICATE_UID')).toBe(true);
        expect(validateCards(parsed.cards).some((e) => e.code === 'DUPLICATE_UID')).toBe(true);

        // The plan must never write the same uid twice, whatever the deck state.
        const plan = planImport(parsed, []);
        const applied = [...plan.creates, ...plan.updates].filter(
          (entry) => entry.card.stableUid === duplicatedUid,
        );
        expect(applied).toHaveLength(1);
        expect(plan.conflicts.some((c) => c.reason === 'DUPLICATE_UID_IN_FILE')).toBe(true);
      }),
    );
  });

  it('planImport is idempotent and calls identical content unchanged', () => {
    fc.assert(
      fc.property(deckArb, fc.integer({ min: 1, max: 50 }), ({ slug, cards }, version) => {
        const parsed = parseDeckMarkdown(serializeDeckMarkdown(slug, cards));

        const emptyDeckPlan = planImport(parsed, []);
        expect(planImport(parsed, [])).toEqual(emptyDeckPlan);
        expect(emptyDeckPlan.creates).toHaveLength(parsed.cards.length);

        // Model what the server holds after the creates were applied, including
        // its habit of storing absent optional text as an empty string.
        const existing: Card[] = parsed.cards.map((card, i) => ({
          ...toExistingCard(card, 500 + i, version),
          codeSnippet: card.codeSnippet ?? '',
          realWorldUsage: card.realWorldUsage ?? '',
          codeLanguage: card.codeLanguage ?? '',
        }));

        const first = planImport(parsed, existing);
        const second = planImport(parsed, existing);
        expect(second).toEqual(first);
        expect(first.unchanged).toHaveLength(parsed.cards.length);
        expect(first.creates).toEqual([]);
        expect(first.updates).toEqual([]);
        expect(first.conflicts).toEqual([]);
      }),
    );
  });

  it('every reported issue points at a real line', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const parsed = parseDeckMarkdown(text);
        const lineCount = text.replace(/\r\n?/g, '\n').split('\n').length;
        for (const issue of parsed.errors) {
          expect(issue.line).toBeGreaterThanOrEqual(1);
          expect(issue.line).toBeLessThanOrEqual(lineCount);
        }
      }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  parseDeckMarkdown,
  planImport,
  serializeDeckMarkdown,
  validateCards,
  type DeckCardContent,
  type ParsedCard,
  type ParsedDeck,
} from '../src/lib/deckImport';
import {
  describeFailure,
  runImport,
  type CreateCardParams,
  type ImportAction,
  type ImportProgress,
  type ImportWriter,
  type UpdateCardParams,
  SERVER_NOT_READY_MCQ,
} from '../src/lib/deckImportRunner';
import { validateMcq, normalizeMcqForCompare, LETTER_REFERENCE, type McqIssueCode } from '../src/lib/mcqRules';
import type { McqBlob, McqOption } from '../src/types/mcq';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';

const DECK_ID = 7;

// The last two cards of docs/mcq-card-type-plan-2026-09-18.md (§4.3, :177-253),
// copied verbatim. Not the placeholder header at :175.
const MCQ_CARD_1 = [
  '## aws-sqs-order-buffer-mcq-01 | d2',
  'QUALIFIER: LEAST operational overhead',
  'Q:',
  'An order API runs on Amazon EC2 instances behind an Application Load Balancer.',
  'During flash sales the downstream fulfilment service is overwhelmed and orders',
  'are lost. The company wants the API to keep accepting orders while fulfilment',
  'catches up, with the LEAST operational overhead. Which solution meets these',
  'requirements?',
  'OPT: a',
  'Increase the instance size of the fulfilment service and enable detailed',
  'CloudWatch monitoring.',
  'WHY:',
  'Vertical scaling raises the ceiling but does not buffer a burst; once the larger',
  'instance saturates, orders are lost again, and someone has to keep resizing it.',
  'OPT: b *',
  'Publish each order to an Amazon SQS standard queue and run the fulfilment',
  'service in an Auto Scaling group that scales on',
  'ApproximateNumberOfMessagesVisible.',
  'OPT: c',
  'Write each order to an Amazon Kinesis Data Streams stream with one shard and',
  'process it with AWS Lambda.',
  'WHY:',
  'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard',
  'count right is exactly the operational work the question asks to avoid.',
  'OPT: d',
  'Insert each order into an Amazon RDS table and have the fulfilment service poll',
  'for unprocessed rows every second.',
  'WHY:',
  'Polling a relational table turns the database into a queue: extra load, locking',
  'logic, and the two services stay coupled.',
  'A:',
  'Put an SQS standard queue between the API and fulfilment and scale the',
  'fulfilment fleet on queue depth. The queue stores the burst durably and the',
  'Auto Scaling group drains it with no manual work. Resizing the instance only',
  'raises the ceiling, a one-shard Kinesis stream caps throughput and adds shard',
  'management, and polling RDS makes the database a queue.',
  'USAGE:',
  'In my own checkout side project the checkout Lambda drops a message on SQS and',
  'the email sender consumes it, so an email-provider outage never blocks a',
  'purchase.',
].join('\n');

const MCQ_CARD_2 = [
  '## aws-s3-compliance-copy-mcq-02 | d3',
  'Q:',
  'A company must keep a copy of every object written to an S3 bucket in a second',
  'Region and must be able to prove that no copy can be deleted for seven years,',
  'even by an account administrator. Which combination of actions meets these',
  'requirements? (Choose two.)',
  'OPT: a *',
  'Enable versioning on both buckets and configure S3 Cross-Region Replication to',
  'the destination bucket.',
  'OPT: b',
  'Enable S3 Transfer Acceleration on the source bucket.',
  'WHY:',
  'Transfer Acceleration speeds up uploads over long distances; it never copies an',
  'object to another Region.',
  'OPT: c *',
  'Enable S3 Object Lock in compliance mode with a seven-year retention period on',
  'the destination bucket.',
  'OPT: d',
  'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to',
  'all principals.',
  'WHY:',
  'A bucket policy can be edited or removed by an administrator, so it cannot prove',
  'that a copy is undeletable; compliance-mode Object Lock cannot be shortened or',
  'removed by anyone.',
  'OPT: e',
  'Enable MFA Delete on the source bucket.',
  'WHY:',
  "MFA Delete protects the source bucket's versions from casual deletion; it does",
  'not cover the second-Region copy and an administrator with the MFA device can',
  'still delete.',
  'A:',
  'Replicate with versioning enabled and lock the destination copies with Object',
  'Lock in compliance mode for seven years. Replication provides the second-Region',
  'copy; compliance mode is the only setting that no principal, including the root',
  'user, can shorten or remove. Transfer Acceleration, a deny policy, and MFA',
  'Delete do not meet the "cannot be deleted by anyone" requirement.',
].join('\n');

const EXAMPLE_MCQ_DOC = ['# deck: aws-associate-architect', '', MCQ_CARD_1, '', MCQ_CARD_2].join('\n');

const doc = (...lines: string[]): string => lines.join('\n');

function requireMcq(card: DeckCardContent): McqBlob {
  if (!card.mcq) throw new Error(`expected card ${card.stableUid} to carry an mcq blob`);
  return card.mcq;
}

// ---------------------- shared fixtures ----------------------

function opt(key: string, correct: boolean, why: string | null, text = `${key} choice text`): McqOption {
  return { key, text, why, correct };
}

/** A clean valid blob: a wrong, b correct, c wrong. validateMcq returns []. */
function baseBlob(): McqBlob {
  return {
    v: 1,
    qualifier: null,
    shuffle: true,
    options: [opt('a', false, 'alpha is not right'), opt('b', true, null), opt('c', false, 'gamma is not right')],
  };
}

/** Two correct options, so a bare stem is a choose-N mismatch. */
function twoStarBlob(): McqBlob {
  return {
    v: 1,
    qualifier: null,
    shuffle: true,
    options: [opt('a', true, null), opt('b', false, 'beta is not right'), opt('c', true, null)],
  };
}

function ok(data: Card | null): ApiResult<Card> {
  return { success: true, data, error: null, traceId: 't' };
}

function echoRow(params: CreateCardParams | UpdateCardParams, mcq?: McqBlob | null): Card & { mcq?: McqBlob | null } {
  return {
    id: 1,
    deckId: DECK_ID,
    stableUid: params.stableUid ?? 'x',
    question: params.question ?? '',
    difficulty: params.difficulty ?? 1,
    orderInDeck: params.orderInDeck ?? 0,
    explanation: params.explanation ?? '',
    realWorldUsage: params.realWorldUsage ?? null,
    codeSnippet: params.codeSnippet ?? null,
    codeLanguage: params.codeLanguage ?? null,
    topic: params.topic ?? null,
    version: 1,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...(mcq !== undefined ? { mcq } : {}),
  };
}

interface Recorder {
  writer: ImportWriter;
  creates: CreateCardParams[];
  updates: UpdateCardParams[];
  calls: string[];
}

function recorder(responses: (params: CreateCardParams | UpdateCardParams) => ApiResult<Card> = () => ok(null)): Recorder {
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

function actionsFor(document: string, existing: readonly Card[] = []): ImportAction[] {
  const plan = planImport(parseDeckMarkdown(document), existing);
  return [...plan.creates, ...plan.updates];
}

function toCard(card: ParsedCard, id: number, version: number): Card & { mcq?: McqBlob | null } {
  return {
    id,
    deckId: DECK_ID,
    stableUid: card.stableUid,
    question: card.question,
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
    explanation: card.explanation,
    realWorldUsage: card.realWorldUsage ?? '',
    codeSnippet: card.codeSnippet ?? '',
    codeLanguage: card.codeLanguage ?? '',
    topic: card.topic ?? null,
    version,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    mcq: card.mcq ?? null,
  };
}

/** Content plus order, dropping sourceLine so a line shift does not fail a diff. */
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
    ...(card.mcq !== undefined ? { mcq: card.mcq } : {}),
    orderInDeck: card.orderInDeck,
  }));
}

// ---------------------- property based (valid MCQ cards) ----------------------

const UID_SEGMENTS = ['cs', 'async', 'core', 'db', '001', '002', 'x9', 'net'];
const WORDS = ['alpha', 'beta', 'gamma', 'fast', 'path', '状态', '回调', 'x', '42', 'await'];

const uidArb = fc.array(fc.constantFrom(...UID_SEGMENTS), { minLength: 1, maxLength: 3 }).map((parts) => parts.join('-'));
const lineArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 }).map((words) => words.join(' '));
const textArb = fc.array(lineArb, { minLength: 1, maxLength: 3 }).map((lines) => lines.join('\n'));

/** Generates only cards for which validateMcq returns []. Returns the MCQ parts. */
const mcqArb: fc.Arbitrary<{ mcq: McqBlob; difficulty: number; question: string }> = fc
  .integer({ min: 3, max: 6 })
  .chain((n) =>
    fc
      .record({
        difficulty: fc.integer({ min: 1, max: 3 }),
        stem: lineArb,
        qualifier: fc.option(fc.constantFrom('LEAST operational overhead', 'MOST cost-effective'), { nil: null }),
        texts: fc.uniqueArray(lineArb, { minLength: n, maxLength: n }),
        correctIdx: fc.subarray([...Array(n).keys()], { minLength: 1, maxLength: Math.min(3, n - 1) }),
        correctWhy: fc.array(fc.option(lineArb, { nil: null }), { minLength: n, maxLength: n }),
        wrongWhy: fc.array(lineArb, { minLength: n, maxLength: n }),
      })
      .map((r) => {
        const correctSet = new Set(r.correctIdx);
        const options: McqOption[] = r.texts.map((text, i) => {
          const correct = correctSet.has(i);
          return { key: String.fromCharCode(97 + i), text, why: correct ? r.correctWhy[i] : r.wrongWhy[i], correct };
        });
        const required = r.correctIdx.length;
        const chooseSuffix = required === 2 ? ' (Choose two.)' : required === 3 ? ' (Choose three.)' : '';
        const qualifierSentence = r.qualifier ? ` We want the ${r.qualifier} here.` : '';
        return {
          mcq: { v: 1, qualifier: r.qualifier, shuffle: true, options } as McqBlob,
          difficulty: r.difficulty,
          question: `${r.stem}${qualifierSentence}${chooseSuffix}`,
        };
      }),
  );

const mcqDeckArb = fc
  .record({
    slug: fc.constantFrom('aws-associate-architect', 'deck-two', 'x1', 'net-core-002'),
    cards: fc.uniqueArray(fc.record({ uid: uidArb, explanation: textArb, core: mcqArb }), {
      minLength: 1,
      maxLength: 4,
      selector: (c) => c.uid,
    }),
  })
  .map(({ slug, cards }) => ({
    slug,
    cards: cards.map(
      (c): DeckCardContent => ({
        stableUid: c.uid,
        difficulty: c.core.difficulty,
        question: c.core.question,
        explanation: c.explanation,
        codeSnippet: null,
        codeLanguage: null,
        realWorldUsage: null,
        mcq: c.core.mcq,
      }),
    ),
  }));

// ---------------------- the two example cards ----------------------

describe('parseDeckMarkdown: the two example cards of MCQ plan §4.3', () => {
  const deck = parseDeckMarkdown(EXAMPLE_MCQ_DOC);

  it('parses the single-answer example card: options a-d, correct b, qualifier set', () => {
    const card = deck.cards[0];
    expect(card.stableUid).toBe('aws-sqs-order-buffer-mcq-01');
    expect(card.difficulty).toBe(2);
    const mcq = requireMcq(card);
    expect(mcq.options.map((o) => o.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(mcq.options.filter((o) => o.correct).map((o) => o.key)).toEqual(['b']);
    expect(mcq.qualifier).toBe('LEAST operational overhead');
    expect(mcq.options[1].why).toBeNull();
    expect(mcq.options[0].why?.startsWith('Vertical scaling')).toBe(true);
    expect(mcq.shuffle).toBe(true);
    expect(mcq.v).toBe(1);
    expect(card.realWorldUsage?.startsWith('In my own checkout')).toBe(true);
  });

  it('parses the choose-two example card: options a-e, correct a and c, no qualifier', () => {
    const card = deck.cards[1];
    expect(card.stableUid).toBe('aws-s3-compliance-copy-mcq-02');
    expect(card.difficulty).toBe(3);
    const mcq = requireMcq(card);
    expect(mcq.options.map((o) => o.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(mcq.options.filter((o) => o.correct).map((o) => o.key)).toEqual(['a', 'c']);
    expect(mcq.qualifier).toBeNull();
    expect(card.realWorldUsage).toBeNull();
  });

  it('reports no issues for the example document', () => {
    expect(deck.errors).toEqual([]);
    for (const card of deck.cards) {
      expect(
        validateMcq({ question: card.question, explanation: card.explanation, difficulty: card.difficulty, mcq: requireMcq(card) }),
      ).toEqual([]);
    }
  });

  it('leaves the mcq key absent on Q/A cards in the same document', () => {
    const mixed = parseDeckMarkdown(
      doc(
        '# deck: mixed-deck',
        '## qa-1 | d2',
        'Q:',
        'a plain question',
        'A:',
        'a plain answer',
        '## m-1 | d2',
        'Q:',
        'stem',
        'OPT: a *',
        'alpha choice',
        'OPT: b',
        'beta choice',
        'WHY:',
        'beta is not right',
        'OPT: c',
        'gamma choice',
        'WHY:',
        'gamma is not right',
        'A:',
        'answer',
      ),
    );
    expect('mcq' in mixed.cards[0]).toBe(false);
    expect(mixed.cards[1].mcq).toBeDefined();
    const plan = planImport(mixed, []);
    expect(plan.creates).toHaveLength(2);
  });
});

// ---------------------- lenient markers, strict payloads ----------------------

describe('lenient markers, strict payloads', () => {
  it('reports a mistyped OPT: line as MCQ_BAD_OPT_LINE at that line and drops the card', () => {
    for (const bad of ['OPT: g', 'OPT: a Increase the instance size', 'OPT: A)']) {
      const lines = ['# deck: d1', '## m-1 | d2', 'Q:', 'stem line', bad, 'body text', 'A:', 'answer'];
      const parsed = parseDeckMarkdown(lines.join('\n'));
      expect(parsed.cards).toEqual([]);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].code).toBe('MCQ_BAD_OPT_LINE');
      expect(parsed.errors[0].line).toBe(lines.indexOf(bad) + 1);
      expect(parsed.errors[0].stableUid).toBe('m-1');
    }
  });

  it('never glues a mistyped OPT: line into the open section', () => {
    const parsed = parseDeckMarkdown(
      doc(
        '# deck: d1',
        '## bad-1 | d2',
        'Q:',
        'real question',
        'OPT: zz',
        'glued body',
        'A:',
        'ans',
        '## good-1 | d2',
        'Q:',
        'good question',
        'A:',
        'good answer',
      ),
    );
    expect(parsed.errors.some((e) => e.code === 'TEXT_BEFORE_SECTION')).toBe(false);
    expect(parsed.cards.map((c) => c.stableUid)).toEqual(['good-1']);
    expect(parsed.cards[0].question).toBe('good question');
    for (const card of parsed.cards) {
      expect(card.question).not.toContain('OPT:');
      expect(card.explanation).not.toContain('OPT:');
      for (const o of card.mcq?.options ?? []) expect(o.text).not.toContain('OPT:');
    }
  });

  it('accepts an uppercase key and normalizes it to lowercase', () => {
    const parsed = parseDeckMarkdown(
      doc('# deck: d1', '## m-1 | d2', 'Q:', 'stem', 'OPT: A', 'alpha', 'OPT: B *', 'beta', 'OPT: C', 'gamma', 'A:', 'answer'),
    );
    const mcq = requireMcq(parsed.cards[0]);
    expect(mcq.options.map((o) => o.key)).toEqual(['a', 'b', 'c']);
    const b = mcq.options.find((o) => o.key === 'b');
    expect(b).toEqual({ key: 'b', text: 'beta', why: null, correct: true });
  });

  it('reports a WHY: before any OPT: as MCQ_WHY_WITHOUT_OPTION', () => {
    const lines = ['# deck: d1', '## m-1 | d2', 'Q:', 'stem', 'WHY:', 'orphan why body', 'A:', 'answer'];
    const parsed = parseDeckMarkdown(lines.join('\n'));
    const issue = parsed.errors.find((e) => e.code === 'MCQ_WHY_WITHOUT_OPTION');
    expect(issue?.line).toBe(lines.indexOf('WHY:') + 1);
    expect(parsed.errors.some((e) => e.code === 'TEXT_BEFORE_SECTION')).toBe(false);
  });

  it('reports a second QUALIFIER: as MCQ_DUPLICATE_QUALIFIER and keeps the first', () => {
    const parsed = parseDeckMarkdown(
      doc(
        '# deck: d1',
        '## m-1 | d2',
        'QUALIFIER: first phrase',
        'QUALIFIER: second phrase',
        'Q:',
        'stem that names the first phrase',
        'OPT: a *',
        'alpha',
        'OPT: b',
        'beta',
        'WHY:',
        'beta is not right',
        'OPT: c',
        'gamma',
        'WHY:',
        'gamma is not right',
        'A:',
        'answer',
      ),
    );
    expect(parsed.errors.some((e) => e.code === 'MCQ_DUPLICATE_QUALIFIER')).toBe(true);
    expect(requireMcq(parsed.cards[0]).qualifier).toBe('first phrase');
  });

  it('reports a repeated OPT: key as MCQ_DUPLICATE_OPTION_KEY, not DUPLICATE_SECTION', () => {
    const parsed = parseDeckMarkdown(
      doc(
        '# deck: d1',
        '## m-1 | d2',
        'Q:',
        'stem',
        'OPT: a *',
        'first alpha',
        'OPT: a',
        'second alpha',
        'OPT: b',
        'beta',
        'A:',
        'answer',
      ),
    );
    expect(parsed.errors.some((e) => e.code === 'MCQ_DUPLICATE_OPTION_KEY')).toBe(true);
    expect(parsed.errors.some((e) => e.code === 'DUPLICATE_SECTION')).toBe(false);
    const aOptions = requireMcq(parsed.cards[0]).options.filter((o) => o.key === 'a');
    expect(aOptions).toHaveLength(1);
    expect(aOptions[0].text).toBe('first alpha');
  });

  it('reports a second WHY: for one option as DUPLICATE_SECTION and keeps the first', () => {
    const parsed = parseDeckMarkdown(
      doc(
        '# deck: d1',
        '## m-1 | d2',
        'Q:',
        'stem',
        'OPT: a',
        'alpha',
        'WHY:',
        'first why',
        'WHY:',
        'second why',
        'OPT: b *',
        'beta',
        'A:',
        'answer',
      ),
    );
    expect(parsed.errors.some((e) => e.code === 'DUPLICATE_SECTION')).toBe(true);
    const a = requireMcq(parsed.cards[0]).options.find((o) => o.key === 'a');
    expect(a?.why).toBe('first why');
  });
});

// ---------------------- validateMcq ----------------------

type ValidateInput = { question: string; explanation: string; difficulty: number; mcq: McqBlob };
type CodeCase = { doc: string } | { input: ValidateInput };

describe('validateMcq', () => {
  it('produces every McqIssueCode from at least one positive case', () => {
    const table: Record<McqIssueCode, CodeCase> = {
      MCQ_BAD_OPT_LINE: { doc: doc('# deck: d1', '## m-1 | d2', 'Q:', 'stem', 'OPT: g', 'body', 'A:', 'answer') },
      MCQ_WHY_WITHOUT_OPTION: { doc: doc('# deck: d1', '## m-1 | d2', 'Q:', 'stem', 'WHY:', 'orphan', 'A:', 'answer') },
      MCQ_DIFFICULTY_RANGE: { input: { question: 'stem', explanation: 'exp', difficulty: 4, mcq: baseBlob() } },
      MCQ_TOO_FEW_OPTIONS: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null), opt('b', false, 'b wrong')] },
        },
      },
      MCQ_TOO_MANY_OPTIONS: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: {
            v: 1,
            qualifier: null,
            shuffle: true,
            options: [
              opt('a', true, null),
              opt('b', false, 'b wrong'),
              opt('c', false, 'c wrong'),
              opt('d', false, 'd wrong'),
              opt('e', false, 'e wrong'),
              opt('f', false, 'f wrong'),
              opt('g', false, 'g wrong'),
            ],
          },
        },
      },
      MCQ_KEY_SEQUENCE: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null), opt('c', false, 'c wrong'), opt('d', false, 'd wrong')] },
        },
      },
      MCQ_DUPLICATE_OPTION_KEY: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null), opt('a', false, 'a again'), opt('b', false, 'b wrong')] },
        },
      },
      MCQ_OPTION_EMPTY: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null, ''), opt('b', false, 'b wrong'), opt('c', false, 'c wrong')] },
        },
      },
      MCQ_OPTION_TEXT_DUPLICATE: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: {
            v: 1,
            qualifier: null,
            shuffle: true,
            options: [opt('a', true, null, 'same text'), opt('b', false, 'b wrong', 'same text'), opt('c', false, 'c wrong', 'other')],
          },
        },
      },
      MCQ_NO_CORRECT: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', false, 'a wrong'), opt('b', false, 'b wrong'), opt('c', false, 'c wrong')] },
        },
      },
      MCQ_TOO_MANY_CORRECT: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: {
            v: 1,
            qualifier: null,
            shuffle: true,
            options: [opt('a', true, null), opt('b', true, null), opt('c', true, null), opt('d', true, null), opt('e', false, 'e wrong')],
          },
        },
      },
      MCQ_ALL_CORRECT: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null), opt('b', true, null), opt('c', true, null)] },
        },
      },
      MCQ_WHY_MISSING: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: { v: 1, qualifier: null, shuffle: true, options: [opt('a', true, null), opt('b', false, null), opt('c', false, 'c wrong')] },
        },
      },
      MCQ_FORBIDDEN_OPTION_TEXT: {
        input: {
          question: 'stem',
          explanation: 'exp',
          difficulty: 2,
          mcq: {
            v: 1,
            qualifier: null,
            shuffle: true,
            options: [opt('a', true, null), opt('b', false, 'b wrong', 'all of the above'), opt('c', false, 'c wrong')],
          },
        },
      },
      MCQ_LETTER_REFERENCE: { input: { question: 'stem', explanation: 'See Option B here.', difficulty: 2, mcq: baseBlob() } },
      MCQ_QUALIFIER_NOT_IN_STEM: {
        input: { question: 'a plain stem', explanation: 'exp', difficulty: 2, mcq: { ...baseBlob(), qualifier: 'a missing phrase' } },
      },
      MCQ_QUALIFIER_EMPTY: { input: { question: 'stem', explanation: 'exp', difficulty: 2, mcq: { ...baseBlob(), qualifier: '' } } },
      MCQ_QUALIFIER_IS_CHOOSE_N: { input: { question: 'stem', explanation: 'exp', difficulty: 2, mcq: { ...baseBlob(), qualifier: 'choose two' } } },
      MCQ_CHOOSE_N_MISMATCH: { input: { question: 'stem (Choose two.)', explanation: 'exp', difficulty: 2, mcq: baseBlob() } },
    };

    for (const [code, testCase] of Object.entries(table) as Array<[McqIssueCode, CodeCase]>) {
      const codes =
        'doc' in testCase
          ? parseDeckMarkdown(testCase.doc).errors.map((e) => e.code)
          : validateMcq(testCase.input).map((i) => i.code);
      expect(codes).toContain(code);
    }
    expect(Object.keys(table)).toHaveLength(19);
  });

  it('does not flag "answer a question" as a letter reference', () => {
    expect(LETTER_REFERENCE.test('answer a question')).toBe(false);
    expect(LETTER_REFERENCE.test('Option B')).toBe(true);
    expect(LETTER_REFERENCE.test('B) text')).toBe(true);
    const issues = validateMcq({ question: 'stem', explanation: 'We answer a question here.', difficulty: 2, mcq: baseBlob() });
    expect(issues.some((i) => i.code === 'MCQ_LETTER_REFERENCE')).toBe(false);
  });

  it('checks choose-N in both directions', () => {
    const oneStarWithPhrase = validateMcq({ question: 'stem (Choose two.)', explanation: 'exp', difficulty: 2, mcq: baseBlob() });
    expect(oneStarWithPhrase.some((i) => i.code === 'MCQ_CHOOSE_N_MISMATCH')).toBe(true);
    const twoStarNoPhrase = validateMcq({ question: 'stem', explanation: 'exp', difficulty: 2, mcq: twoStarBlob() });
    expect(twoStarNoPhrase.some((i) => i.code === 'MCQ_CHOOSE_N_MISMATCH')).toBe(true);
    const twoStarWithPhrase = validateMcq({ question: 'stem (Choose two.)', explanation: 'exp', difficulty: 2, mcq: twoStarBlob() });
    expect(twoStarWithPhrase.some((i) => i.code === 'MCQ_CHOOSE_N_MISMATCH')).toBe(false);
  });

  it('blocks an invalid MCQ card through validateCards and planImport as INVALID_CARD', () => {
    const parsed = parseDeckMarkdown(
      doc(
        '# deck: d1',
        '## m-1 | d4',
        'Q:',
        'stem',
        'OPT: a *',
        'alpha',
        'OPT: b',
        'beta',
        'WHY:',
        'beta is not right',
        'OPT: c',
        'gamma',
        'WHY:',
        'gamma is not right',
        'A:',
        'answer',
      ),
    );
    const issue = validateCards(parsed.cards).find((i) => i.code === 'MCQ_DIFFICULTY_RANGE');
    expect(issue?.line).toBe(2);
    expect(issue?.stableUid).toBe('m-1');
    const plan = planImport(parsed, []);
    expect(plan.creates).toEqual([]);
    expect(plan.conflicts.map((c) => c.reason)).toContain('INVALID_CARD');
  });
});

// ---------------------- round trip and reconciliation ----------------------

describe('round trip and reconciliation', () => {
  it('round trips: serialize then parse returns every MCQ field unchanged', () => {
    fc.assert(
      fc.property(mcqDeckArb, ({ slug, cards }) => {
        for (const card of cards) {
          expect(
            validateMcq({ question: card.question, explanation: card.explanation, difficulty: card.difficulty, mcq: requireMcq(card) }),
          ).toEqual([]);
        }
        const parsed = parseDeckMarkdown(serializeDeckMarkdown(slug, cards));
        expect(parsed.errors).toEqual([]);
        expect(parsed.deckSlug).toBe(slug);
        expect(contentOf(parsed)).toEqual(cards.map((c, i) => ({ ...c, orderInDeck: i * 10 })));
      }),
    );
  });

  it('serializes QUALIFIER: before Q: and OPT:/WHY: between the question and A:', () => {
    const parsed = parseDeckMarkdown(EXAMPLE_MCQ_DOC);
    const serialized = serializeDeckMarkdown('aws-associate-architect', parsed.cards);
    const lines = serialized.split('\n');
    const start = lines.indexOf('## aws-sqs-order-buffer-mcq-01 | d2');
    const end = lines.indexOf('## aws-s3-compliance-copy-mcq-02 | d3');
    const card1 = lines.slice(start, end);
    const at = (s: string): number => card1.indexOf(s);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(at('QUALIFIER: LEAST operational overhead')).toBeGreaterThan(-1);
    expect(at('QUALIFIER: LEAST operational overhead')).toBeLessThan(at('Q:'));
    expect(at('Q:')).toBeLessThan(at('OPT: a'));
    expect(at('OPT: a')).toBeLessThan(at('WHY:'));
    expect(at('WHY:')).toBeLessThan(at('OPT: b *'));
    expect(at('OPT: b *')).toBeLessThan(at('A:'));
    const reparsed = parseDeckMarkdown(serialized);
    expect(reparsed.errors).toEqual([]);
    expect(contentOf(reparsed)).toEqual(contentOf(parsed));
  });

  it('re-planning the serialized document against rows built from it is all unchanged', () => {
    fc.assert(
      fc.property(mcqDeckArb, ({ slug, cards }) => {
        const parsed = parseDeckMarkdown(serializeDeckMarkdown(slug, cards));
        const rows = parsed.cards.map((c, i) => toCard(c, 700 + i, 3));
        const plan = planImport(parsed, rows);
        expect(plan.unchanged).toHaveLength(parsed.cards.length);
        expect(plan.updates).toEqual([]);

        const cleared = rows.map((r, i) => (i === 0 ? { ...r, mcq: null } : r));
        const plan2 = planImport(parsed, cleared);
        expect(plan2.updates).toHaveLength(1);
        expect(plan2.updates[0].changedFields).toEqual(['mcq']);
      }),
    );
  });

  it('normalizeMcqForCompare treats server null and file absence alike and ignores spacing, key order and v', () => {
    expect(normalizeMcqForCompare(null)).toBe('');
    expect(normalizeMcqForCompare(undefined)).toBe('');

    const forward = baseBlob();
    const reversed: McqBlob = { ...baseBlob(), options: [...baseBlob().options].reverse() };
    expect(normalizeMcqForCompare(forward)).toBe(normalizeMcqForCompare(reversed));

    const withEmpty: McqBlob = { ...baseBlob(), options: baseBlob().options.map((o) => (o.key === 'a' ? { ...o, why: '' } : o)) };
    const withNull: McqBlob = { ...baseBlob(), options: baseBlob().options.map((o) => (o.key === 'a' ? { ...o, why: null } : o)) };
    expect(normalizeMcqForCompare(withEmpty)).toBe(normalizeMcqForCompare(withNull));

    const card1 = requireMcq(parseDeckMarkdown(EXAMPLE_MCQ_DOC).cards[0]);
    // Hand-written copy in PG key order (v, options, shuffle, qualifier / key, why, text, correct),
    // with the options reversed and the text and qualifier padded.
    const hand: McqBlob = {
      v: 1,
      options: [...card1.options].reverse().map((o) => ({ key: o.key, why: o.why, text: `  ${o.text}  `, correct: o.correct })),
      shuffle: true,
      qualifier: '  LEAST operational overhead  ',
    };
    expect(normalizeMcqForCompare(hand)).toBe(normalizeMcqForCompare(card1));
  });
});

// ---------------------- runImport readiness guard ----------------------

const QA_LEAD = ['## qa-lead-01 | d1', 'Q:', 'a plain question', 'A:', 'a plain answer'].join('\n');
const QA_TRAIL = ['## qa-trail-01 | d1', 'Q:', 'another question', 'A:', 'another answer'].join('\n');
const GUARD_DOC = ['# deck: aws-associate-architect', '', QA_LEAD, '', MCQ_CARD_1, '', MCQ_CARD_2, '', QA_TRAIL].join('\n');
const QA_DOC = ['# deck: qa-deck', '', QA_LEAD, '', QA_TRAIL].join('\n');

describe('runImport readiness guard', () => {
  it('stops after the first MCQ write whose echo lacks mcq and lists the rest as SERVER_NOT_READY_MCQ', async () => {
    const rec = recorder((params) => ok(echoRow(params)));
    let lastProgress: ImportProgress | undefined;
    const result = await runImport(DECK_ID, actionsFor(GUARD_DOC), rec.writer, (p) => {
      lastProgress = p;
    });

    expect(result.created).toBe(1);
    expect(result.failures.map((f) => f.stableUid)).toEqual([
      'aws-sqs-order-buffer-mcq-01',
      'aws-s3-compliance-copy-mcq-02',
      'qa-trail-01',
    ]);
    expect(result.failures.every((f) => f.code === SERVER_NOT_READY_MCQ)).toBe(true);
    expect(rec.calls).toHaveLength(2);
    expect(lastProgress?.done).toBe(2);
  });

  it('continues when the echo carries an mcq object', async () => {
    const rec = recorder((params) => ok(echoRow(params, params.mcq ?? null)));
    const result = await runImport(DECK_ID, actionsFor(GUARD_DOC), rec.writer);

    expect(result.created).toBe(4);
    expect(result.failures).toEqual([]);
    const expected = requireMcq(parseDeckMarkdown(GUARD_DOC).cards[1]);
    expect(rec.creates[1].mcq).toEqual(expected);
    expect(rec.creates[0].mcq).toBeNull();
  });

  it('never inspects the echo of a Q/A-only run', async () => {
    const rec = recorder();
    const result = await runImport(DECK_ID, actionsFor(QA_DOC), rec.writer);
    expect(result.failures).toEqual([]);
    expect(result.created).toBe(2);
  });

  it('describeFailure names the server readiness problem', () => {
    const action = actionsFor(QA_DOC)[0];
    expect(describeFailure({ action, stableUid: 'x', code: SERVER_NOT_READY_MCQ, message: 'ignored' })).toBe(
      'The server is not ready for MCQ cards (migration 019 / Lambda not deployed); nothing after this card was written.',
    );
    expect(describeFailure({ action, stableUid: 'x', code: 'OTHER', message: 'plain message' })).toBe('plain message');
  });
});

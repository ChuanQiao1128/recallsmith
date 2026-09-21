import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  warnMcq,
  formatWarning,
  sortWarnings,
  firstSentence,
  wordCount,
  MCQ_WARN_SHAPES,
  type McqWarningCode,
  type McqWarningInput,
} from '../src/lib/mcqWarnings';
import { parseDeckMarkdown } from '../src/lib/deckImport';
import type { McqBlob, McqOption } from '../src/types/mcq';

// The last two cards of docs/mcq-card-type-plan-2026-09-18.md (§4.3, :177-253),
// copied verbatim — the only MCQ text a fixture may quote.
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

function right(key: string, text: string): McqOption {
  return { key, text, why: null, correct: true };
}
function wrong(key: string, text: string, why: string): McqOption {
  return { key, text, why, correct: false };
}
function blob(options: McqOption[], qualifier: string | null = null): McqBlob {
  return { v: 1, qualifier, shuffle: true, options };
}

const WELL_SHAPED: McqWarningInput = {
  question: 'Short stem. And a second sentence.',
  realWorldUsage: 'Used at work.',
  mcq: blob([
    right('a', 'x'.repeat(100)),
    wrong('b', 'x'.repeat(100), 'w'.repeat(60)),
    wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
    wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
  ]),
};

/** `words` single letters split into sentences of at most 20 words. */
function buildStem(words: number): string {
  const parts: string[] = [];
  let remaining = words;
  while (remaining > 0) {
    const n = Math.min(20, remaining);
    parts.push(Array(n).fill('a').join(' '));
    remaining -= n;
  }
  return `${parts.join('. ')}.`;
}

function codesOf(card: McqWarningInput): McqWarningCode[] {
  return warnMcq(card).map((w) => w.code);
}

describe('warnMcq — the non-blocking suggestion tier', () => {
  it('fires each warning code once from a minimal positive case', () => {
    const cases: Record<McqWarningCode, McqWarningInput> = {
      MCQ_WARN_CORRECT_LONGEST: {
        ...WELL_SHAPED,
        mcq: blob([
          right('a', 'x'.repeat(140)),
          wrong('b', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
        ]),
      },
      MCQ_WARN_WHY_SHORT: {
        ...WELL_SHAPED,
        mcq: blob([
          right('a', 'x'.repeat(100)),
          wrong('b', 'x'.repeat(100), 'w'.repeat(39)),
          wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
        ]),
      },
      MCQ_WARN_STEM_LONG: { ...WELL_SHAPED, question: buildStem(121) },
      MCQ_WARN_FIRST_SENTENCE_LONG: { ...WELL_SHAPED, question: `${'a'.repeat(140)}. More.` },
      MCQ_WARN_SHAPE: {
        ...WELL_SHAPED,
        mcq: blob([
          right('a', 'x'.repeat(100)),
          wrong('b', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
          wrong('e', 'x'.repeat(100), 'w'.repeat(60)),
        ]),
      },
      MCQ_WARN_NO_USAGE: { ...WELL_SHAPED, realWorldUsage: null },
    };

    const expectedNumber: Record<McqWarningCode, string> = {
      MCQ_WARN_CORRECT_LONGEST: '140',
      MCQ_WARN_WHY_SHORT: '39',
      MCQ_WARN_STEM_LONG: '121',
      MCQ_WARN_FIRST_SENTENCE_LONG: '141',
      MCQ_WARN_SHAPE: '1 correct of 5',
      MCQ_WARN_NO_USAGE: 'USAGE',
    };

    for (const key of Object.keys(cases) as McqWarningCode[]) {
      const result = warnMcq(cases[key]);
      expect(result.map((w) => w.code)).toEqual([key]);
      expect(result[0].message).toContain(expectedNumber[key]);
    }
  });

  it('sits exactly on each threshold', () => {
    const longest = (correctLen: number): McqWarningInput => ({
      ...WELL_SHAPED,
      mcq: blob([
        right('a', 'x'.repeat(correctLen)),
        wrong('b', 'x'.repeat(100), 'w'.repeat(60)),
        wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
        wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
      ]),
    });
    expect(codesOf(longest(139))).not.toContain('MCQ_WARN_CORRECT_LONGEST');
    expect(codesOf(longest(140))).toContain('MCQ_WARN_CORRECT_LONGEST');

    const why = (whyLen: number): McqWarningInput => ({
      ...WELL_SHAPED,
      mcq: blob([
        right('a', 'x'.repeat(100)),
        wrong('b', 'x'.repeat(100), 'w'.repeat(whyLen)),
        wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
        wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
      ]),
    });
    expect(codesOf(why(40))).not.toContain('MCQ_WARN_WHY_SHORT');
    expect(codesOf(why(39))).toContain('MCQ_WARN_WHY_SHORT');

    expect(codesOf({ ...WELL_SHAPED, question: buildStem(120) })).not.toContain('MCQ_WARN_STEM_LONG');
    expect(codesOf({ ...WELL_SHAPED, question: buildStem(121) })).toContain('MCQ_WARN_STEM_LONG');

    expect(codesOf({ ...WELL_SHAPED, question: `${'a'.repeat(139)}. More.` })).not.toContain('MCQ_WARN_FIRST_SENTENCE_LONG');
    expect(codesOf({ ...WELL_SHAPED, question: `${'a'.repeat(140)}. More.` })).toContain('MCQ_WARN_FIRST_SENTENCE_LONG');
  });

  it('stays silent on a well-shaped card', () => {
    fc.assert(
      fc.property(
        fc.record({
          shape: fc.constantFrom(...MCQ_WARN_SHAPES),
          wrongLen: fc.integer({ min: 20, max: 200 }),
          ratio: fc.double({ min: 0.3, max: 1.39, noNaN: true }),
          whyLen: fc.integer({ min: 40, max: 200 }),
          words: fc.integer({ min: 1, max: 120 }),
        }),
        ({ shape, wrongLen, ratio, whyLen, words }) => {
          const [correctCount, total] = shape;
          const correctLen = Math.floor(ratio * wrongLen);
          const options: McqOption[] = [];
          for (let i = 0; i < total; i += 1) {
            const key = String.fromCharCode(97 + i);
            options.push(
              i < correctCount
                ? right(key, 'x'.repeat(correctLen))
                : wrong(key, 'y'.repeat(wrongLen), 'w'.repeat(whyLen)),
            );
          }
          const card: McqWarningInput = {
            question: buildStem(words),
            realWorldUsage: 'Used at work.',
            mcq: blob(options),
          };
          expect(warnMcq(card)).toEqual([]);
        },
      ),
    );

    expect(wordCount('')).toBe(0);
    expect(firstSentence('No terminator here')).toBe('No terminator here');
  });

  it('flags every shape outside 1 of 4, 2 of 5 and 3 of 6', () => {
    for (let n = 3; n <= 6; n += 1) {
      for (let r = 1; r <= Math.min(3, n - 1); r += 1) {
        const options: McqOption[] = [];
        for (let i = 0; i < n; i += 1) {
          const key = String.fromCharCode(97 + i);
          options.push(
            i < r ? right(key, 'x'.repeat(100)) : wrong(key, 'x'.repeat(100), 'w'.repeat(60)),
          );
        }
        const card: McqWarningInput = { ...WELL_SHAPED, mcq: blob(options) };
        const hasShapeWarning = codesOf(card).includes('MCQ_WARN_SHAPE');
        const isKnown = MCQ_WARN_SHAPES.some(([c, o]) => c === r && o === n);
        expect(hasShapeWarning).toBe(!isKnown);
      }
    }
  });

  it('never throws on a card the blocking rules would refuse', () => {
    const noOptions = warnMcq({ ...WELL_SHAPED, mcq: blob([]) });
    expect(Array.isArray(noOptions)).toBe(true);

    const allCorrect = warnMcq({
      ...WELL_SHAPED,
      mcq: blob([
        right('a', 'x'.repeat(100)),
        right('b', 'x'.repeat(100)),
        right('c', 'x'.repeat(100)),
        right('d', 'x'.repeat(100)),
      ]),
    });
    expect(Array.isArray(allCorrect)).toBe(true);
    expect(allCorrect.some((w) => w.code === 'MCQ_WARN_CORRECT_LONGEST')).toBe(false);

    const emptyTexts = warnMcq({
      ...WELL_SHAPED,
      mcq: blob([
        right('a', ''),
        wrong('b', '', 'w'.repeat(60)),
        wrong('c', '', 'w'.repeat(60)),
        wrong('d', '', 'w'.repeat(60)),
      ]),
    });
    expect(Array.isArray(emptyTexts)).toBe(true);

    const emptyWhy = warnMcq({
      ...WELL_SHAPED,
      mcq: blob([
        right('a', 'x'.repeat(100)),
        wrong('b', 'x'.repeat(100), ''),
        wrong('c', 'x'.repeat(100), 'w'.repeat(60)),
        wrong('d', 'x'.repeat(100), 'w'.repeat(60)),
      ]),
    });
    expect(emptyWhy.some((w) => w.code === 'MCQ_WARN_WHY_SHORT')).toBe(true);

    const badOptions = warnMcq({
      ...WELL_SHAPED,
      mcq: { v: 1, qualifier: null, shuffle: true, options: 'x' as unknown as McqOption[] },
    });
    expect(Array.isArray(badOptions)).toBe(true);
  });

  it('reports exactly the longest-correct suggestion on the plan card', () => {
    const oneCard = parseDeckMarkdown(['# deck: aws-associate-architect', '', MCQ_CARD_1].join('\n'));
    expect(oneCard.errors).toEqual([]);
    expect(oneCard.warnings).toEqual([
      {
        code: 'MCQ_WARN_CORRECT_LONGEST',
        severity: 'warning',
        line: oneCard.cards[0].sourceLine,
        message: expect.stringContaining('"b"'),
        stableUid: 'aws-sqs-order-buffer-mcq-01',
      },
    ]);

    const twoCards = parseDeckMarkdown(
      ['# deck: aws-associate-architect', '', MCQ_CARD_1, '', MCQ_CARD_2].join('\n'),
    );
    const card1Codes = twoCards.warnings
      .filter((w) => w.stableUid === 'aws-sqs-order-buffer-mcq-01')
      .map((w) => w.code);
    const card2Codes = twoCards.warnings
      .filter((w) => w.stableUid === 'aws-s3-compliance-copy-mcq-02')
      .map((w) => w.code);
    expect(card1Codes).toEqual(['MCQ_WARN_CORRECT_LONGEST']);
    expect(card2Codes).toEqual([
      'MCQ_WARN_CORRECT_LONGEST',
      'MCQ_WARN_FIRST_SENTENCE_LONG',
      'MCQ_WARN_NO_USAGE',
    ]);
    const lines = twoCards.warnings.map((w) => w.line);
    expect([...lines]).toEqual([...lines].sort((a, b) => a - b));

    const qaOnly = parseDeckMarkdown(
      ['# deck: aws-associate-architect', '', '## qa-card-1 | d1', 'Q:', 'What is 2+2?', 'A:', 'Four.'].join('\n'),
    );
    expect(qaOnly.warnings).toEqual([]);

    expect(formatWarning({ line: 3, message: 'm' })).toBe('line 3: m');

    const cA: McqWarningCode = 'MCQ_WARN_CORRECT_LONGEST';
    const cB: McqWarningCode = 'MCQ_WARN_FIRST_SENTENCE_LONG';
    const unsorted = [
      { code: cB, severity: 'warning' as const, line: 9, message: 'x', stableUid: 'x' },
      { code: cB, severity: 'warning' as const, line: 3, message: 'x', stableUid: 'x' },
      { code: cA, severity: 'warning' as const, line: 3, message: 'x', stableUid: 'x' },
    ];
    expect(sortWarnings(unsorted).map((w) => [w.line, w.code])).toEqual([
      [3, cA],
      [3, cB],
      [9, cB],
    ]);
  });
});

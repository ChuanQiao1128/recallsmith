import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  normalizeMcq,
  mcqRequiredCount,
  resolveMcq,
  isMcqCard,
  MCQ_KEYS,
  MCQ_MAX_OPTION_TEXT,
} from '../../src/features/gacha/mcq/normalizeMcq';
import { DEFAULT_FEATURE_FLAGS } from '../../src/config/featureFlags';
import type { McqExport } from '../../src/types/deckExport';

/** Plan §4.3 card 1 (:177-217) as the server emits it — PG jsonb key order (C00 §2.9.1). */
const PLAN_CARD_1_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
    { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
    { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
    { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};
/** Plan §4.3 card 2 (:218-253): choose-two, no qualifier. */
const PLAN_CARD_2_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: null, text: 'Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.', correct: true },
    { key: 'b', why: 'Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.', text: 'Enable S3 Transfer Acceleration on the source bucket.', correct: false },
    { key: 'c', why: null, text: 'Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.', correct: true },
    { key: 'd', why: 'A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.', text: 'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.', correct: false },
    { key: 'e', why: "MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.", text: 'Enable MFA Delete on the source bucket.', correct: false },
  ],
  shuffle: true,
  qualifier: null,
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const nonBlank = (max: number) => fc.string({ minLength: 1, maxLength: max }).filter((s) => s.trim().length > 0);
const mcqArb = fc.integer({ min: 3, max: 6 }).chain((n) =>
  fc
    .record({
      correctIdx: fc.subarray([...Array(n).keys()], { minLength: 1, maxLength: Math.min(3, n - 1) }),
      texts: fc.array(nonBlank(MCQ_MAX_OPTION_TEXT), { minLength: n, maxLength: n }),
      whys: fc.array(nonBlank(200), { minLength: n, maxLength: n }),
      qualifier: fc.option(fc.constantFrom('LEAST operational overhead', 'MOST performant', 'MOST cost-effective'), { nil: null }),
      shuffle: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map(({ correctIdx, texts, whys, qualifier, shuffle }) => ({
      v: 1,
      options: texts.map((text, i) => ({ key: MCQ_KEYS[i], why: correctIdx.includes(i) ? null : whys[i], text, correct: correctIdx.includes(i) })),
      ...(shuffle === undefined ? {} : { shuffle }),
      qualifier,
    })),
);

describe('normalizeMcq', () => {
  it('normalises the plan §4.3 cards and is idempotent', () => {
    const one = normalizeMcq(PLAN_CARD_1_MCQ)!;
    expect(one).not.toBeNull();
    expect(mcqRequiredCount(one)).toBe(1);
    expect(one.qualifier).toBe('LEAST operational overhead');
    expect(one.shuffle).toBe(true);
    expect(one.options.map((o) => o.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(one.options[1].correct).toBe(true);
    expect(one.options[1].why).toBe(null);
    expect(one.options[0].why!.startsWith('Vertical scaling')).toBe(true);
    expect(Object.keys(one)).toEqual(['v', 'qualifier', 'shuffle', 'options']);
    expect(Object.keys(one.options[0])).toEqual(['key', 'text', 'why', 'correct']);
    expect(Object.isFrozen(one)).toBe(true);
    expect(Object.isFrozen(one.options)).toBe(true);
    expect(Object.isFrozen(one.options[0])).toBe(true);
    expect(normalizeMcq(one)).toEqual(one);
    expect(one).not.toBe(PLAN_CARD_1_MCQ);
    expect(one.options).not.toBe(PLAN_CARD_1_MCQ.options);
    const card1Before = JSON.stringify(PLAN_CARD_1_MCQ);
    normalizeMcq(PLAN_CARD_1_MCQ);
    expect(JSON.stringify(PLAN_CARD_1_MCQ)).toBe(card1Before);

    const two = normalizeMcq(PLAN_CARD_2_MCQ)!;
    expect(mcqRequiredCount(two)).toBe(2);
    expect(two.options.map((o) => o.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(two.options.filter((o) => o.correct).map((o) => o.key)).toEqual(['a', 'c']);
    expect(two.qualifier).toBe(null);

    fc.assert(
      fc.property(mcqArb, (raw) => {
        const before = JSON.stringify(raw);
        const out = normalizeMcq(raw);
        expect(out).not.toBeNull();
        expect(out!.options.length).toBe(raw.options.length);
        expect(mcqRequiredCount(out!)).toBe(raw.options.filter((o) => o.correct).length);
        out!.options.forEach((o, i) => {
          expect(o.key).toBe(MCQ_KEYS[i]);
          expect(o.text).toBe(raw.options[i].text.trim());
          if (raw.options[i].correct) {
            expect(o.why).toBe(null);
          } else {
            expect(o.why).toBe(raw.options[i].why!.trim());
          }
        });
        expect(out!.shuffle).toBe('shuffle' in raw ? raw.shuffle : true);
        expect(normalizeMcq(out!)).toEqual(out!);
        expect(Object.isFrozen(out!) && Object.isFrozen(out!.options) && out!.options.every(Object.isFrozen)).toBe(true);
        expect(JSON.stringify(raw)).toBe(before);
      }),
    );
  });

  it('returns null for every single-rule violation', () => {
    expect(normalizeMcq(clone(PLAN_CARD_2_MCQ))).not.toBeNull();

    const withV2 = clone(PLAN_CARD_2_MCQ);
    withV2.v = 2 as any;
    expect(normalizeMcq(withV2)).toBeNull();

    const twoOptions = clone(PLAN_CARD_2_MCQ);
    twoOptions.options = twoOptions.options.slice(0, 2);
    expect(normalizeMcq(twoOptions)).toBeNull();

    const sevenOptions = clone(PLAN_CARD_2_MCQ);
    sevenOptions.options.push({ key: 'f', why: 'Not a valid choice for this scenario at all.', text: 'A sixth option that does not help.', correct: false } as any);
    sevenOptions.options.push({ key: 'g', why: 'Also not a valid choice for this scenario.', text: 'A seventh option that does not help.', correct: false } as any);
    expect(normalizeMcq(sevenOptions)).toBeNull();

    const keyBFirst = clone(PLAN_CARD_2_MCQ);
    keyBFirst.options[0].key = 'b';
    expect(normalizeMcq(keyBFirst)).toBeNull();

    const dupKey = clone(PLAN_CARD_2_MCQ);
    dupKey.options[1].key = 'a';
    expect(normalizeMcq(dupKey)).toBeNull();

    const emptyText = clone(PLAN_CARD_2_MCQ);
    emptyText.options[0].text = '   ';
    expect(normalizeMcq(emptyText)).toBeNull();

    const longText = clone(PLAN_CARD_2_MCQ);
    longText.options[0].text = 'x'.repeat(MCQ_MAX_OPTION_TEXT + 1);
    expect(normalizeMcq(longText)).toBeNull();

    const badCorrect = clone(PLAN_CARD_2_MCQ);
    (badCorrect.options[0] as any).correct = 'yes';
    expect(normalizeMcq(badCorrect)).toBeNull();

    const zeroCorrect = clone(PLAN_CARD_2_MCQ);
    zeroCorrect.options.forEach((o) => {
      o.correct = false;
      o.why = 'This option is wrong for a clearly explained reason.';
    });
    expect(normalizeMcq(zeroCorrect)).toBeNull();

    const allCorrect = clone(PLAN_CARD_2_MCQ);
    allCorrect.options.forEach((o) => {
      o.correct = true;
    });
    expect(normalizeMcq(allCorrect)).toBeNull();

    const fourOfSix = clone(PLAN_CARD_2_MCQ);
    fourOfSix.options.push({ key: 'f', why: 'A sixth wrong option with a proper explanation.', text: 'A sixth option that does not help.', correct: false } as any);
    fourOfSix.options[1].correct = true;
    fourOfSix.options[3].correct = true;
    expect(fourOfSix.options.filter((o) => o.correct).length).toBe(4);
    expect(normalizeMcq(fourOfSix)).toBeNull();

    const wrongEmptyWhy = clone(PLAN_CARD_2_MCQ);
    wrongEmptyWhy.options[1].why = '';
    expect(normalizeMcq(wrongEmptyWhy)).toBeNull();

    const wrongUndefinedWhy = clone(PLAN_CARD_2_MCQ);
    wrongUndefinedWhy.options[1].why = undefined as any;
    expect(normalizeMcq(wrongUndefinedWhy)).toBeNull();

    const chooseTwoQualifier = clone(PLAN_CARD_2_MCQ);
    chooseTwoQualifier.qualifier = 'Choose two' as any;
    expect(normalizeMcq(chooseTwoQualifier)).toBeNull();

    const numberQualifier = clone(PLAN_CARD_2_MCQ);
    (numberQualifier as any).qualifier = 7;
    expect(normalizeMcq(numberQualifier)).toBeNull();

    const stringOptions = clone(PLAN_CARD_2_MCQ);
    (stringOptions as any).options = 'a';
    expect(normalizeMcq(stringOptions)).toBeNull();

    const nullOption = clone(PLAN_CARD_2_MCQ);
    (nullOption.options[2] as any) = null;
    expect(normalizeMcq(nullOption)).toBeNull();

    const boundaryText = clone(PLAN_CARD_2_MCQ);
    boundaryText.options[0].text = 'x'.repeat(MCQ_MAX_OPTION_TEXT);
    expect(normalizeMcq(boundaryText)).not.toBeNull();
  });

  it('never throws on junk', () => {
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        has() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    const junk: unknown[] = [
      null,
      undefined,
      [],
      'x',
      7,
      true,
      {},
      { v: 1 },
      { v: 1, options: 'a' },
      { v: 1, options: [null, 1, 'x'] },
      { v: '1', options: [] },
      Object.create(null),
      proxy,
    ];
    for (const x of junk) {
      expect(() => normalizeMcq(x)).not.toThrow();
      expect(normalizeMcq(x)).toBeNull();
    }
    expect(() => resolveMcq({ Mcq: proxy as any }, DEFAULT_FEATURE_FLAGS)).not.toThrow();
    expect(resolveMcq({ Mcq: proxy as any }, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(() => isMcqCard({ Mcq: proxy as any }, DEFAULT_FEATURE_FLAGS)).not.toThrow();
    expect(isMcqCard({ Mcq: proxy as any }, DEFAULT_FEATURE_FLAGS)).toBe(false);
  });

  it('defaults shuffle to true and honours false', () => {
    const noShuffle = clone(PLAN_CARD_1_MCQ);
    delete (noShuffle as any).shuffle;
    expect(normalizeMcq(noShuffle)!.shuffle).toBe(true);

    const nullShuffle = clone(PLAN_CARD_1_MCQ);
    (nullShuffle as any).shuffle = null;
    expect(normalizeMcq(nullShuffle)!.shuffle).toBe(true);

    const stringShuffle = clone(PLAN_CARD_1_MCQ);
    (stringShuffle as any).shuffle = 'no';
    expect(normalizeMcq(stringShuffle)!.shuffle).toBe(true);

    const oneShuffle = clone(PLAN_CARD_1_MCQ);
    (oneShuffle as any).shuffle = 1;
    expect(normalizeMcq(oneShuffle)!.shuffle).toBe(true);

    const falseShuffle = clone(PLAN_CARD_1_MCQ);
    falseShuffle.shuffle = false;
    expect(normalizeMcq(falseShuffle)!.shuffle).toBe(false);

    const trueShuffle = clone(PLAN_CARD_1_MCQ);
    trueShuffle.shuffle = true;
    expect(normalizeMcq(trueShuffle)!.shuffle).toBe(true);
  });

  it('isMcqCard is false under the kill switch and for a card without Mcq', () => {
    const off = { mcq: { ...DEFAULT_FEATURE_FLAGS.mcq, enabled: false } };
    expect(resolveMcq({ Mcq: PLAN_CARD_1_MCQ as McqExport }, off)).toBeNull();
    expect(isMcqCard({ Mcq: PLAN_CARD_1_MCQ as McqExport }, off)).toBe(false);

    expect(resolveMcq({ Mcq: PLAN_CARD_1_MCQ as McqExport }, DEFAULT_FEATURE_FLAGS)).toEqual(
      normalizeMcq(PLAN_CARD_1_MCQ),
    );
    expect(isMcqCard({ Mcq: PLAN_CARD_1_MCQ as McqExport }, DEFAULT_FEATURE_FLAGS)).toBe(true);

    expect(resolveMcq({} as any, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(isMcqCard({} as any, DEFAULT_FEATURE_FLAGS)).toBe(false);
    expect(resolveMcq({ Mcq: undefined }, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(isMcqCard({ Mcq: undefined }, DEFAULT_FEATURE_FLAGS)).toBe(false);
    expect(resolveMcq({ Mcq: null }, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(isMcqCard({ Mcq: null }, DEFAULT_FEATURE_FLAGS)).toBe(false);

    expect(resolveMcq({ Mcq: [] as any }, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(isMcqCard({ Mcq: [] as any }, DEFAULT_FEATURE_FLAGS)).toBe(false);
    expect(resolveMcq({ Mcq: { v: 2 } as any }, DEFAULT_FEATURE_FLAGS)).toBeNull();
    expect(isMcqCard({ Mcq: { v: 2 } as any }, DEFAULT_FEATURE_FLAGS)).toBe(false);

    const softened = { mcq: { ...DEFAULT_FEATURE_FLAGS.mcq, recallFirst: false, maxPerRun: 0 } };
    expect(isMcqCard({ Mcq: PLAN_CARD_1_MCQ as McqExport }, softened)).toBe(true);
  });
});

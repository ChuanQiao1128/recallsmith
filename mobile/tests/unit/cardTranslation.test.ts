// Card translations contract §1: the shape check of `cards[].translations`. Anything that is not
// exactly the contract shape — `correct` above all — makes that locale entry invalid.
import { describe, expect, it } from 'vitest';

import {
  CARD_TRANSLATION_LOCALE,
  parseCardTranslations,
  parseRawCardTranslation,
} from '../../src/content/cardTranslation';

const VALID = {
  v: 1,
  question: '  一家公司要在不改代码的情况下缓冲突发流量，哪种方案的运维开销最低？  ',
  explanation: '在 API 和处理服务之间放一个 Amazon SQS 队列。',
  realWorldUsage: '下单函数把消息写进 SQS，邮件服务再慢慢消费。',
  mcq: {
    qualifier: '运维开销最低',
    options: {
      a: { text: '把处理服务换成更大的实例。', why: '更大的实例也会被突发流量压满。' },
      b: { text: '用 Amazon SQS 队列缓冲订单。', why: null },
      c: { text: '把订单写进单分片的 Kinesis 流。', why: '单分片有吞吐上限，还要一直调分片数。' },
    },
  },
};

describe('parseRawCardTranslation', () => {
  it('accepts the contract shape and trims every string', () => {
    const parsed = parseRawCardTranslation(VALID);
    expect(parsed).toEqual({
      v: 1,
      question: '一家公司要在不改代码的情况下缓冲突发流量，哪种方案的运维开销最低？',
      explanation: '在 API 和处理服务之间放一个 Amazon SQS 队列。',
      realWorldUsage: '下单函数把消息写进 SQS，邮件服务再慢慢消费。',
      mcq: {
        qualifier: '运维开销最低',
        options: {
          a: { text: '把处理服务换成更大的实例。', why: '更大的实例也会被突发流量压满。' },
          b: { text: '用 Amazon SQS 队列缓冲订单。', why: null },
          c: { text: '把订单写进单分片的 Kinesis 流。', why: '单分片有吞吐上限，还要一直调分片数。' },
        },
      },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.mcq?.options)).toBe(true);
  });

  it('reads absent or empty optional fields as null', () => {
    expect(parseRawCardTranslation({ v: 1, question: '问题？' })).toEqual({
      v: 1,
      question: '问题？',
      explanation: null,
      realWorldUsage: null,
      mcq: null,
    });
    const blanks = parseRawCardTranslation({ v: 1, question: '问题？', explanation: '  ', realWorldUsage: null, mcq: null });
    expect(blanks).toMatchObject({ explanation: null, realWorldUsage: null, mcq: null });
    const noQualifier = parseRawCardTranslation({ ...VALID, mcq: { options: VALID.mcq.options } });
    expect(noQualifier?.mcq?.qualifier).toBeNull();
    const emptyWhy = parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: { ...VALID.mcq.options, b: { text: 'B', why: ' ' } } } });
    expect(emptyWhy?.mcq?.options.b.why).toBeNull();
  });

  it('rejects a correct mark anywhere in the entry', () => {
    expect(parseRawCardTranslation({ ...VALID, correct: ['b'] })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, correct: 'b' } })).toBeNull();
    const markedOption = { ...VALID.mcq.options, b: { text: '用 Amazon SQS 队列缓冲订单。', why: null, correct: true } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: markedOption } })).toBeNull();
    const markedWrong = { ...VALID.mcq.options, a: { ...VALID.mcq.options.a, correct: false } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: markedWrong } })).toBeNull();
  });

  it('rejects every other field the English card owns', () => {
    for (const key of ['shuffle', 'codeSnippet', 'codeLanguage', 'topic', 'source', 'difficulty', 'revision', 'stableUid', 'orderInDeck']) {
      expect(parseRawCardTranslation({ ...VALID, [key]: 'x' })).toBeNull();
    }
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, shuffle: false } })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, v: 1 } })).toBeNull();
    const withKey = { ...VALID.mcq.options, a: { ...VALID.mcq.options.a, key: 'b' } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: withKey } })).toBeNull();
  });

  it('rejects a wrong version, type or option layout', () => {
    expect(parseRawCardTranslation(null)).toBeNull();
    expect(parseRawCardTranslation('问题')).toBeNull();
    expect(parseRawCardTranslation([VALID])).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, v: 2 })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, v: '1' })).toBeNull();
    const { v: _v, ...noVersion } = VALID;
    expect(parseRawCardTranslation(noVersion)).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, question: '   ' })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, question: 7 })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, explanation: ['解析'] })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, realWorldUsage: 3 })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: 'b' })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, qualifier: 5 } })).toBeNull();
    // Options are keyed by the English option key, never an ordered array.
    const asArray = [
      { key: 'a', text: 'A', why: '不是这个。' },
      { key: 'b', text: 'B', why: null },
    ];
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: asArray } })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: {} } })).toBeNull();
    expect(parseRawCardTranslation({ ...VALID, mcq: { qualifier: null } })).toBeNull();
    const badKey = { ...VALID.mcq.options, g: { text: 'G', why: '不是这个。' } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: badKey } })).toBeNull();
    const upperKey = { A: { text: 'A', why: null } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: upperKey } })).toBeNull();
    const emptyText = { ...VALID.mcq.options, a: { text: '  ', why: '不是这个。' } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: emptyText } })).toBeNull();
    const longText = { ...VALID.mcq.options, a: { text: '长'.repeat(601), why: '不是这个。' } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: longText } })).toBeNull();
    const atLimit = { ...VALID.mcq.options, a: { text: '长'.repeat(600), why: '不是这个。' } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: atLimit } })?.mcq?.options.a.text).toHaveLength(600);
    const numericWhy = { ...VALID.mcq.options, a: { text: 'A', why: 1 } };
    expect(parseRawCardTranslation({ ...VALID, mcq: { ...VALID.mcq, options: numericWhy } })).toBeNull();
  });
});

describe('parseCardTranslations', () => {
  it('keeps the zh-CN entry and skips locales this build does not know', () => {
    expect(CARD_TRANSLATION_LOCALE).toBe('zh-CN');
    const parsed = parseCardTranslations({ 'zh-CN': VALID, 'zh-TW': { v: 1, question: '問題？' }, ja: 'x' });
    expect(Object.keys(parsed ?? {})).toEqual(['zh-CN']);
    expect(parsed?.['zh-CN']?.question).toBe('一家公司要在不改代码的情况下缓冲突发流量，哪种方案的运维开销最低？');
  });

  it('is null when there is no valid zh-CN entry', () => {
    expect(parseCardTranslations(undefined)).toBeNull();
    expect(parseCardTranslations(null)).toBeNull();
    expect(parseCardTranslations([])).toBeNull();
    expect(parseCardTranslations({})).toBeNull();
    expect(parseCardTranslations({ 'zh-TW': VALID })).toBeNull();
    expect(parseCardTranslations({ 'zh-CN': { ...VALID, correct: 'b' } })).toBeNull();
  });
});

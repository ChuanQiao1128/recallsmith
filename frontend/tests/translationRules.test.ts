// src/lib/translationRules.ts: every blocking code of card translations
// contract §2, the canonical compare, the wire reader and the non-blocking
// longest-answer hint. The server (TranslationValidation.cs) answers with the
// same codes, so the last test pins that every code in the list is reachable
// from a concrete input here.

import { describe, expect, it } from 'vitest';

import type { McqBlob } from '../src/types/mcq';
import {
  CHOOSE_N_STEM_ZH,
  TRANSLATION_ISSUE_CODES,
  TRANSLATION_OPTION_MAX_LENGTH,
  hasCjk,
  normalizeTranslationsForCompare,
  translationsOf,
  validateTranslation,
  warnTranslation,
  type TranslationEnglish,
  type TranslationIssueCode,
} from '../src/lib/translationRules';

// FORMAT.md §3.3 / §3.4: choose two of five, a and c correct, a WHY on every wrong option.
const MCQ: McqBlob = {
  v: 1,
  qualifier: 'MOST secure',
  shuffle: true,
  options: [
    { key: 'a', text: 'Create a customer managed KMS key with rotation.', why: null, correct: true },
    { key: 'b', text: 'Enable SSE-S3 default encryption on the bucket.', why: 'SSE-S3 keys are owned by S3, not the team.', correct: false },
    { key: 'c', text: 'Deny s3:PutObject without aws:kms encryption.', why: null, correct: true },
    { key: 'd', text: 'Enable S3 Versioning.', why: 'Versioning keeps prior copies; it encrypts nothing.', correct: false },
    { key: 'e', text: 'Enable MFA Delete on the bucket.', why: 'MFA Delete protects versions from deletion.', correct: false },
  ],
};

const ENGLISH: TranslationEnglish = {
  question: 'Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)',
  explanation: 'Use a customer managed KMS key and a deny policy.',
  realWorldUsage: 'Only a deny policy turns "should" into "must".',
  mcq: MCQ,
};

const QA_ENGLISH: TranslationEnglish = {
  question: 'Which S3 storage class keeps nightly dumps cheapest?',
  explanation: 'S3 Glacier Flexible Retrieval.',
  realWorldUsage: null,
  mcq: null,
};

type Entry = Record<string, unknown> & {
  mcq?: Record<string, unknown> & { options?: Record<string, Record<string, unknown>> };
};

function zh(): Entry {
  return {
    v: 1,
    question: '哪种操作组合是同时满足这两项要求的最安全方式？（选择两项。）',
    explanation: '使用客户托管的 AWS KMS 密钥，再加一条拒绝策略。',
    realWorldUsage: '只有拒绝策略才能把“应该”变成“必须”。',
    mcq: {
      qualifier: '最安全',
      options: {
        a: { text: '创建启用轮换的客户托管 KMS 密钥。', why: null },
        b: { text: '在存储桶上启用 SSE-S3 默认加密。', why: 'SSE-S3 的密钥归 Amazon S3 所有，不归团队控制。' },
        c: { text: '拒绝未用 KMS 加密的上传。', why: null },
        d: { text: '启用 S3 Versioning。', why: 'Versioning 只保留旧版本，不加密任何内容。' },
        e: { text: '在存储桶上启用 MFA Delete。', why: 'MFA Delete 只防止版本被删除。' },
      },
    },
  };
}

function zhQa(): Entry {
  return { v: 1, question: '哪种 S3 存储类别最便宜？', explanation: 'S3 Glacier Flexible Retrieval。' };
}

const seen = new Set<TranslationIssueCode>();

function codes(translations: unknown, english: TranslationEnglish = ENGLISH, deckLocale?: string): TranslationIssueCode[] {
  const result = validateTranslation({ translations, english, deckLocale }).map((issue) => issue.code);
  for (const code of result) seen.add(code);
  return result;
}

function withEntry(mutate: (entry: Entry) => void, base: () => Entry = zh): unknown {
  const entry = base();
  mutate(entry);
  return { 'zh-CN': entry };
}

describe('validateTranslation', () => {
  it('accepts a complete MCQ translation and a complete Q/A translation', () => {
    expect(codes({ 'zh-CN': zh() })).toEqual([]);
    expect(codes({ 'zh-CN': zhQa() }, QA_ENGLISH)).toEqual([]);
  });

  it('treats null, undefined and an empty map as "no translation", which is valid (the server stores null)', () => {
    expect(codes(null)).toEqual([]);
    expect(codes(undefined)).toEqual([]);
    expect(codes({})).toEqual([]);
  });

  it('TRANSLATION_BAD_SHAPE: not a map, unknown keys, wrong types, v other than 1', () => {
    expect(codes([])).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes('zh')).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes({ 'zh-CN': 'not an object' })).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { e.note = 'x'; }))).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { e.v = 2; }))).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { delete e.v; }))).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { e.explanation = 42; }))).toEqual(['TRANSLATION_BAD_SHAPE', 'TRANSLATION_ANSWER_EMPTY']);
    expect(codes(withEntry((e) => { e.mcq!.shuffle = false; }))).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { e.mcq!.options!.a.key = 'b'; }))).toEqual(['TRANSLATION_BAD_SHAPE']);
    expect(codes(withEntry((e) => { e.mcq!.qualifier = 7; }))).toEqual(['TRANSLATION_BAD_SHAPE', 'TRANSLATION_QUALIFIER_MISMATCH']);
    // An options ARRAY is exactly the "option order" a translation must never carry.
    expect(codes(withEntry((e) => { e.mcq!.options = [] as unknown as Record<string, Record<string, unknown>>; }))).toEqual([
      'TRANSLATION_BAD_SHAPE',
    ]);
  });

  it('TRANSLATION_BAD_LOCALE: only zh-CN in v1, and never the deck locale itself', () => {
    expect(codes({ 'zh-TW': zh() })).toEqual(['TRANSLATION_BAD_LOCALE']);
    expect(codes({ ja: zh() })).toEqual(['TRANSLATION_BAD_LOCALE']);
    expect(codes({ 'zh-CN': zh() }, ENGLISH, 'zh-CN')).toEqual(['TRANSLATION_BAD_LOCALE']);
    expect(codes({ 'zh-CN': zh() }, ENGLISH, 'zh-cn')).toEqual(['TRANSLATION_BAD_LOCALE']);
    expect(codes({ 'zh-CN': zh() }, ENGLISH, 'en-US')).toEqual([]);
  });

  it('TRANSLATION_QUESTION_EMPTY and TRANSLATION_ANSWER_EMPTY', () => {
    expect(codes(withEntry((e) => { e.question = '   '; }))).toContain('TRANSLATION_QUESTION_EMPTY');
    expect(codes(withEntry((e) => { delete e.question; }))).toContain('TRANSLATION_QUESTION_EMPTY');
    expect(codes(withEntry((e) => { e.explanation = ''; }))).toEqual(['TRANSLATION_ANSWER_EMPTY']);
    expect(codes(withEntry((e) => { delete e.explanation; }))).toEqual(['TRANSLATION_ANSWER_EMPTY']);
  });

  it('TRANSLATION_FIELD_MISSING / TRANSLATION_FIELD_EXTRA mirror realWorldUsage and mcq presence', () => {
    expect(codes(withEntry((e) => { delete e.realWorldUsage; }))).toEqual(['TRANSLATION_FIELD_MISSING']);
    expect(codes(withEntry((e) => { delete e.mcq; }))).toEqual(['TRANSLATION_FIELD_MISSING']);
    expect(codes(withEntry((e) => { e.mcq = null as unknown as Entry['mcq']; }))).toEqual(['TRANSLATION_FIELD_MISSING']);
    expect(codes(withEntry((e) => { e.realWorldUsage = '多出来的。'; }, zhQa), QA_ENGLISH)).toEqual(['TRANSLATION_FIELD_EXTRA']);
    expect(codes(withEntry((e) => { e.mcq = zh().mcq; }, zhQa), QA_ENGLISH)).toEqual(['TRANSLATION_FIELD_EXTRA']);
    expect(codes({ 'zh-CN': zhQa() }, { ...QA_ENGLISH, explanation: '' })).toEqual(['TRANSLATION_FIELD_EXTRA']);
    // A blank usage on both sides is "absent" on both sides.
    expect(codes(withEntry((e) => { e.realWorldUsage = ' '; }, zhQa), QA_ENGLISH)).toEqual([]);
  });

  it('TRANSLATION_OPTION_KEYS_MISMATCH: the key set must equal the English one', () => {
    expect(codes(withEntry((e) => { delete e.mcq!.options!.e; }))).toEqual(['TRANSLATION_OPTION_KEYS_MISMATCH']);
    expect(codes(withEntry((e) => { e.mcq!.options!.f = { text: '多出来的选项。', why: null }; }))).toEqual([
      'TRANSLATION_OPTION_KEYS_MISMATCH',
    ]);
  });

  it('TRANSLATION_CORRECT_MARK: correct never appears inside a translation, at any level or letter case, once per locale', () => {
    expect(codes(withEntry((e) => { e.mcq!.options!.a.correct = true; }))).toEqual(['TRANSLATION_CORRECT_MARK']);
    expect(codes(withEntry((e) => { e.mcq!.correct = ['a', 'c']; }))).toEqual(['TRANSLATION_CORRECT_MARK']);
    expect(codes(withEntry((e) => { e.correct = 'a'; }))).toEqual(['TRANSLATION_CORRECT_MARK']);
    expect(codes(withEntry((e) => { e.mcq!.options!.a.Correct = true; e.mcq!.options!.c.CORRECT = true; }))).toEqual([
      'TRANSLATION_CORRECT_MARK',
    ]);
  });

  it('TRANSLATION_OPTION_EMPTY / TOO_LONG / TEXT_DUPLICATE', () => {
    expect(codes(withEntry((e) => { e.mcq!.options!.b.text = ' '; }))).toEqual(['TRANSLATION_OPTION_EMPTY']);
    expect(codes(withEntry((e) => { e.mcq!.options!.b.text = '长'.repeat(TRANSLATION_OPTION_MAX_LENGTH + 1); }))).toEqual([
      'TRANSLATION_OPTION_TOO_LONG',
    ]);
    expect(codes(withEntry((e) => { e.mcq!.options!.b.text = '长'.repeat(TRANSLATION_OPTION_MAX_LENGTH); }))).toEqual([]);
    expect(codes(withEntry((e) => { e.mcq!.options!.d.text = ` ${String(e.mcq!.options!.b.text)} `; }))).toEqual([
      'TRANSLATION_OPTION_TEXT_DUPLICATE',
    ]);
    // Case-folded like the English rule, for the Latin service names inside the text.
    expect(codes(withEntry((e) => {
      e.mcq!.options!.d.text = '启用 S3 VERSIONING。';
      e.mcq!.options!.e.text = '启用 s3 versioning。';
    }))).toEqual(['TRANSLATION_OPTION_TEXT_DUPLICATE']);
  });

  it('TRANSLATION_WHY_MISMATCH: an English why exactly when a translated why', () => {
    expect(codes(withEntry((e) => { e.mcq!.options!.b.why = null; }))).toEqual(['TRANSLATION_WHY_MISMATCH']);
    expect(codes(withEntry((e) => { e.mcq!.options!.b.why = '  '; }))).toEqual(['TRANSLATION_WHY_MISMATCH']);
    expect(codes(withEntry((e) => { e.mcq!.options!.a.why = '正确选项不需要理由。'; }))).toEqual(['TRANSLATION_WHY_MISMATCH']);
  });

  it('TRANSLATION_QUALIFIER_MISMATCH and TRANSLATION_QUALIFIER_NOT_IN_STEM', () => {
    expect(codes(withEntry((e) => { e.mcq!.qualifier = null; }))).toEqual(['TRANSLATION_QUALIFIER_MISMATCH']);
    expect(codes(withEntry((e) => { e.mcq!.qualifier = ''; }))).toEqual(['TRANSLATION_QUALIFIER_MISMATCH']);
    expect(codes({ 'zh-CN': zh() }, { ...ENGLISH, mcq: { ...MCQ, qualifier: null } })).toEqual(['TRANSLATION_QUALIFIER_MISMATCH']);
    expect(codes(withEntry((e) => { e.mcq!.qualifier = '最便宜'; }))).toEqual(['TRANSLATION_QUALIFIER_NOT_IN_STEM']);
    // Case-insensitive, like the English rule (and the server's OrdinalIgnoreCase).
    expect(codes(withEntry((e) => {
      e.question = '哪种 MOST secure 组合最好？（选择两项。）';
      e.mcq!.qualifier = 'most SECURE';
    }))).toEqual([]);
  });

  it('TRANSLATION_CHOOSE_N_MISMATCH: the Chinese choose-N marker agrees with the English star count both ways', () => {
    const singleAnswer: McqBlob = { ...MCQ, options: MCQ.options.map((o) => ({ ...o, correct: o.key === 'a' })) };
    const three: McqBlob = { ...MCQ, options: MCQ.options.map((o) => ({ ...o, correct: o.key !== 'b' && o.key !== 'd' })) };
    const stem = (s: string) => withEntry((e) => { e.question = s; });

    expect(codes(stem('哪种组合最安全？'))).toEqual(['TRANSLATION_CHOOSE_N_MISMATCH']);
    expect(codes(stem('哪种组合最安全？（选择三项。）'))).toEqual(['TRANSLATION_CHOOSE_N_MISMATCH']);
    expect(codes(stem('哪种组合最安全？(选择两项)'))).toEqual([]);
    expect(codes(stem('哪种组合最安全？（选两项）'))).toEqual([]);
    expect(codes(stem('哪种组合最安全？（选择 2 项。）'))).toEqual([]);
    expect(codes(stem('哪种做法最安全？（选择两项。）'), { ...ENGLISH, mcq: singleAnswer })).toContain('TRANSLATION_CHOOSE_N_MISMATCH');
    expect(codes(stem('哪种组合最安全？（选择三项。）'), { ...ENGLISH, mcq: three })).toEqual([]);
  });

  it('TRANSLATION_NOT_TRANSLATED: the question must contain a Chinese character; punctuation alone does not count', () => {
    expect(codes(withEntry((e) => { e.question = 'Which S3 storage class is cheapest?'; }, zhQa), QA_ENGLISH)).toEqual([
      'TRANSLATION_NOT_TRANSLATED',
    ]);
    expect(codes(withEntry((e) => { e.question = 'Which S3 class? （）。'; }, zhQa), QA_ENGLISH)).toEqual([
      'TRANSLATION_NOT_TRANSLATED',
    ]);
  });

  it('returns every issue in the server check order, so the first one is the code a write would be refused with', () => {
    const issues = validateTranslation({
      translations: withEntry((e) => {
        e.question = 'untranslated (Choose two.)';
        e.mcq!.options!.b.why = null;
        e.mcq!.options!.a.correct = true;
        e.mcq!.options!.d.text = '';
        delete e.realWorldUsage;
      }),
      english: ENGLISH,
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      'TRANSLATION_CORRECT_MARK',
      'TRANSLATION_NOT_TRANSLATED',
      'TRANSLATION_FIELD_MISSING',
      'TRANSLATION_QUALIFIER_NOT_IN_STEM',
      'TRANSLATION_OPTION_EMPTY',
      'TRANSLATION_WHY_MISMATCH',
      'TRANSLATION_CHOOSE_N_MISMATCH',
    ]);
    expect(issues.every((issue) => issue.locale === 'zh-CN')).toBe(true);
    for (const issue of issues) seen.add(issue.code);
  });

  it('the escaped choose-N regex behaves exactly like the contract literal', () => {
    const literal = /[（(]\s*选择?\s*(两|二|三|2|3)\s*项\s*[。.]?\s*[）)]/;
    for (const sample of ['（选择两项。）', '（选择三项）', '(选二项.)', '(选 3 项)', '（选择两个。）', '选择两项', '（选择四项。）', '（ 选择 两 项 。 ）']) {
      expect(CHOOSE_N_STEM_ZH.exec(sample)?.[1] ?? null, sample).toBe(literal.exec(sample)?.[1] ?? null);
    }
  });

  it('hasCjk sees Han ideographs only', () => {
    expect(hasCjk('最安全')).toBe(true);
    expect(hasCjk('Amazon S3（）。')).toBe(false);
    expect(hasCjk('plain English')).toBe(false);
  });

  // Last on purpose: every case above recorded its codes in `seen`.
  it('reaches every contract §2 code from a concrete input', () => {
    expect([...seen].sort()).toEqual([...TRANSLATION_ISSUE_CODES].sort());
  });
});

describe('normalizeTranslationsForCompare', () => {
  it('maps null, undefined, a wrong type and an empty map to the empty string', () => {
    expect(normalizeTranslationsForCompare(null)).toBe('');
    expect(normalizeTranslationsForCompare(undefined)).toBe('');
    expect(normalizeTranslationsForCompare('x')).toBe('');
    expect(normalizeTranslationsForCompare({})).toBe('');
  });

  it('ignores key order, surrounding whitespace, v, and a blank why or usage', () => {
    const canonical = normalizeTranslationsForCompare({ 'zh-CN': zh() });
    const reordered = zh();
    const pgOrder = {
      'zh-CN': {
        mcq: {
          options: Object.fromEntries(
            Object.entries(reordered.mcq!.options!).reverse().map(([key, o]) => [key, { why: o.why, text: ` ${String(o.text)}\n` }]),
          ),
          qualifier: ' 最安全 ',
        },
        question: reordered.question,
        explanation: reordered.explanation,
        realWorldUsage: reordered.realWorldUsage,
      },
    };
    expect(normalizeTranslationsForCompare(pgOrder)).toBe(canonical);

    const qa = { 'zh-CN': { ...zhQa(), realWorldUsage: '' } };
    expect(normalizeTranslationsForCompare(qa)).toBe(normalizeTranslationsForCompare({ 'zh-CN': zhQa() }));
  });

  it('changes when any translated text changes', () => {
    const canonical = normalizeTranslationsForCompare({ 'zh-CN': zh() });
    expect(normalizeTranslationsForCompare(withEntry((e) => { e.mcq!.options!.b.text = '别的文字。'; }))).not.toBe(canonical);
    expect(normalizeTranslationsForCompare(withEntry((e) => { e.mcq!.options!.d.why = '别的理由。'; }))).not.toBe(canonical);
    expect(normalizeTranslationsForCompare(withEntry((e) => { e.explanation = '别的解析。'; }))).not.toBe(canonical);
  });
});

describe('translationsOf', () => {
  it('reads the wire key without trusting its type', () => {
    expect(translationsOf(null)).toBeNull();
    expect(translationsOf({})).toBeNull();
    expect(translationsOf({ translations: null })).toBeNull();
    expect(translationsOf({ translations: ['zh-CN'] })).toBeNull();
    const map = { 'zh-CN': zhQa() };
    expect(translationsOf({ translations: map })).toBe(map);
  });
});

describe('warnTranslation', () => {
  it('ZH_WARN_CORRECT_LONGEST fires on the Chinese text, using the English correct marks', () => {
    const giveaway = withEntry((e) => { e.mcq!.options!.a.text = '这是一个非常非常长而且把答案细节全部说出来的正确选项文字。'; });
    expect(warnTranslation({ translations: giveaway, mcq: MCQ }).map((w) => w.code)).toEqual(['ZH_WARN_CORRECT_LONGEST']);
    expect(warnTranslation({ translations: { 'zh-CN': zh() }, mcq: MCQ })).toEqual([]);
  });

  it('is total: no mcq, no translation, a broken shape', () => {
    expect(warnTranslation({ translations: { 'zh-CN': zhQa() }, mcq: null })).toEqual([]);
    expect(warnTranslation({ translations: null, mcq: MCQ })).toEqual([]);
    expect(warnTranslation({ translations: { 'zh-CN': { mcq: { options: 'x' } } }, mcq: MCQ })).toEqual([]);
  });
});

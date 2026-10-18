// Card translations contract §5: localizeForDisplay swaps text only. The shown order, the keys the
// picks are made of, the correct marks and the shuffle flag are the English card's, so grading a set
// of picks gives the same verdict whichever language was on screen; an incomplete translation shows
// the whole card in English.
import { describe, expect, it } from 'vitest';

import type { CardExport } from '../../src/types/deckExport';
import { parseRawCardTranslation, type CardTranslation } from '../../src/content/cardTranslation';
import {
  cardTranslationFor,
  hasCompleteTranslation,
  isChineseDeckLocale,
  localizeForDisplay,
} from '../../src/content/localizeCard';
import { normalizeMcq } from '../../src/features/gacha/mcq/normalizeMcq';
import { mcqSeed, shownOrderFor } from '../../src/features/gacha/mcq/mcqShuffle';
import { resolveMcqVerdict } from '../../src/features/gacha/mcq/mcqVerdict';

const ENGLISH_MCQ = normalizeMcq({
  v: 1,
  qualifier: 'LEAST operational overhead',
  shuffle: true,
  options: [
    { key: 'a', text: 'Resize the worker instances by hand.', why: 'A bigger instance still saturates under a burst.', correct: false },
    { key: 'b', text: 'Buffer the requests in an Amazon SQS queue.', why: null, correct: true },
    { key: 'c', text: 'Write the requests to a one-shard stream.', why: 'One shard caps the ingest rate.', correct: false },
    { key: 'd', text: 'Poll a database table for new rows.', why: 'Polling turns the database into a queue.', correct: false },
  ],
})!;

const CARD: CardExport = {
  StableUid: 'buffer-burst-mcq',
  Revision: 3,
  Question: 'A burst of requests overwhelms a worker fleet. Which design absorbs it with the LEAST operational overhead?',
  Explanation: 'A queue stores the burst durably and the workers drain it at their own pace.',
  RealWorldUsage: 'A checkout function drops each order on a queue for the email sender.',
  CodeSnippet: 'aws sqs create-queue --queue-name orders',
  CodeLanguage: 'bash',
  Difficulty: 2,
  OrderInDeck: 12,
  Topic: 'decoupling',
  Mcq: ENGLISH_MCQ,
};

const ZH: CardTranslation = parseRawCardTranslation({
  v: 1,
  question: '突发请求压垮了一组工作实例。哪种设计能以运维开销最低的方式吸收这些请求？',
  explanation: '队列会持久保存突发的请求，工作实例按自己的节奏慢慢处理。',
  realWorldUsage: '结账函数把每个订单放进队列，由邮件服务去消费。',
  mcq: {
    qualifier: '运维开销最低',
    options: {
      a: { text: '手动调大工作实例。', why: '实例再大，突发流量下也会被压满。' },
      b: { text: '用 Amazon SQS 队列缓冲请求。', why: null },
      c: { text: '把请求写进单分片的流。', why: '单分片限制了写入速率。' },
      d: { text: '轮询数据库表里的新行。', why: '轮询会把数据库变成队列。' },
    },
  },
})!;

const SHOWN = shownOrderFor(ENGLISH_MCQ, mcqSeed('session-1', CARD.StableUid, 0));

function zhDisplay(translation: CardTranslation | null = ZH, card: CardExport = CARD) {
  return localizeForDisplay({ card, mcq: ENGLISH_MCQ, shownOrder: SHOWN, translation, lang: 'zh-CN' });
}

describe('localizeForDisplay', () => {
  it('swaps the question, explanation, usage and every option text and why, matched by key', () => {
    const display = zhDisplay();
    expect(display.lang).toBe('zh-CN');
    expect(display.card.Question).toBe(ZH.question);
    expect(display.card.Explanation).toBe(ZH.explanation);
    expect(display.card.RealWorldUsage).toBe(ZH.realWorldUsage);
    expect(display.mcq?.qualifier).toBe('运维开销最低');
    for (const option of display.mcq!.options) {
      expect(option.text).toBe(ZH.mcq!.options[option.key].text);
      expect(option.why).toBe(ZH.mcq!.options[option.key].why);
    }
  });

  it('keeps everything that is not display text from the English card', () => {
    const display = zhDisplay();
    const { Question, Explanation, RealWorldUsage, ...rest } = display.card;
    const { Question: q, Explanation: e, RealWorldUsage: r, ...englishRest } = CARD;
    expect(rest).toEqual(englishRest);
    expect(display.card.Mcq).toBe(CARD.Mcq);
    expect(display.mcq?.v).toBe(1);
    expect(display.mcq?.shuffle).toBe(ENGLISH_MCQ.shuffle);
    expect(display.mcq?.options.map((o) => [o.key, o.correct])).toEqual(ENGLISH_MCQ.options.map((o) => [o.key, o.correct]));
    // The input is never mutated.
    expect(CARD.Question).toMatch(/^A burst/);
    expect(ENGLISH_MCQ.options[0].text).toBe('Resize the worker instances by hand.');
  });

  it('keeps the shown order: the same keys in the same sequence, no reshuffle', () => {
    const display = zhDisplay();
    expect(display.shownOrder.map((o) => o.key)).toEqual(SHOWN.map((o) => o.key));
    expect(display.shownOrder.map((o) => o.text)).toEqual(SHOWN.map((o) => ZH.mcq!.options[o.key].text));
    // Unshuffled cards keep the stored order too.
    const stored = normalizeMcq({ ...ENGLISH_MCQ, shuffle: false })!;
    const storedOrder = shownOrderFor(stored, 7);
    const storedDisplay = localizeForDisplay({ card: CARD, mcq: stored, shownOrder: storedOrder, translation: ZH, lang: 'zh-CN' });
    expect(storedDisplay.shownOrder.map((o) => o.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(storedDisplay.mcq?.shuffle).toBe(false);
  });

  it('leaves picks and verdicts alone: the same keys grade the same either way', () => {
    const display = zhDisplay();
    for (const picks of [['b'], ['a'], ['c'], []]) {
      expect(resolveMcqVerdict(picks, display.mcq!)).toBe(resolveMcqVerdict(picks, ENGLISH_MCQ));
    }
    // A pick made on the Chinese row is the English option with the same key.
    const pickedRow = display.shownOrder.find((o) => o.key === 'b')!;
    expect(ENGLISH_MCQ.options.find((o) => o.key === pickedRow.key)?.correct).toBe(true);
  });

  it('never takes a correct mark from a translation, even one that slipped past the parser', () => {
    // A hand-built entry carrying correct marks that disagree with the English card.
    const forged = {
      ...ZH,
      mcq: {
        qualifier: '运维开销最低',
        options: Object.fromEntries(
          Object.entries(ZH.mcq!.options).map(([key, option]) => [key, { ...option, correct: key === 'a' }]),
        ),
      },
    } as unknown as CardTranslation;
    const display = zhDisplay(forged);
    expect(display.mcq?.options.find((o) => o.key === 'b')?.correct).toBe(true);
    expect(display.mcq?.options.find((o) => o.key === 'a')?.correct).toBe(false);
    expect(display.shownOrder.every((o) => Object.keys(o).sort().join() === 'correct,key,text,why')).toBe(true);
    // The parser itself refuses such an entry outright.
    expect(parseRawCardTranslation({ ...ZH, mcq: forged.mcq })).toBeNull();
  });

  it('shows the whole card in English when the translation misses anything the English card shows', () => {
    const englishOf = (translation: CardTranslation | null, card: CardExport = CARD) => {
      const display = zhDisplay(translation, card);
      expect(display.lang).toBe('en');
      expect(display.card).toBe(card);
      expect(display.mcq).toBe(ENGLISH_MCQ);
      expect(display.shownOrder).toBe(SHOWN);
    };
    const { c: _c, ...withoutC } = ZH.mcq!.options;
    englishOf({ ...ZH, mcq: { ...ZH.mcq!, options: withoutC } });
    englishOf({ ...ZH, mcq: { ...ZH.mcq!, options: { ...ZH.mcq!.options, e: { text: '多出来的选项', why: '不是这个。' } } } });
    englishOf({ ...ZH, mcq: { ...ZH.mcq!, options: { ...ZH.mcq!.options, a: { text: '手动调大工作实例。', why: null } } } });
    englishOf({ ...ZH, mcq: { ...ZH.mcq!, qualifier: null } });
    englishOf({ ...ZH, mcq: null });
    englishOf({ ...ZH, explanation: null });
    englishOf({ ...ZH, realWorldUsage: null });
    englishOf(null);
  });

  it('is the English card itself for lang en', () => {
    const display = localizeForDisplay({ card: CARD, mcq: ENGLISH_MCQ, shownOrder: SHOWN, translation: ZH, lang: 'en' });
    expect(display).toEqual({ card: CARD, mcq: ENGLISH_MCQ, shownOrder: SHOWN, lang: 'en' });
    expect(display.card).toBe(CARD);
    expect(display.shownOrder).toBe(SHOWN);
  });

  it('uses only the text the English card carries', () => {
    // No English usage or qualifier: a Chinese one is not shown; an English why-less option stays why-less.
    const card = { ...CARD, RealWorldUsage: '' };
    const mcq = normalizeMcq({ ...ENGLISH_MCQ, qualifier: null })!;
    const display = localizeForDisplay({ card, mcq, shownOrder: mcq.options, translation: ZH, lang: 'zh-CN' });
    expect(display.lang).toBe('zh-CN');
    expect(display.card.RealWorldUsage).toBe('');
    expect(display.mcq?.qualifier).toBeNull();
    const withCorrectWhy = { ...ZH, mcq: { ...ZH.mcq!, options: { ...ZH.mcq!.options, b: { text: '用队列。', why: '多余的解释' } } } };
    expect(zhDisplay(withCorrectWhy).mcq?.options.find((o) => o.key === 'b')?.why).toBeNull();
  });

  it('localizes a Q/A card and ignores an MCQ translation it cannot show', () => {
    const qa: CardExport = { ...CARD, Mcq: null };
    const display = localizeForDisplay({ card: qa, mcq: null, shownOrder: [], translation: ZH, lang: 'zh-CN' });
    expect(display.lang).toBe('zh-CN');
    expect(display.card.Question).toBe(ZH.question);
    expect(display.mcq).toBeNull();
    expect(display.shownOrder).toEqual([]);
  });
});

describe('cardTranslationFor / hasCompleteTranslation', () => {
  it('offers the zh-CN entry only on a deck that is not itself Chinese', () => {
    const translations = { 'zh-CN': ZH };
    expect(cardTranslationFor(translations, 'en-US')).toBe(ZH);
    expect(cardTranslationFor(translations, 'zh-CN')).toBeNull();
    expect(cardTranslationFor(translations, ' ZH-cn ')).toBeNull();
    expect(cardTranslationFor(undefined, 'en-US')).toBeNull();
    expect(cardTranslationFor({}, 'en-US')).toBeNull();
    expect(isChineseDeckLocale('zh-CN')).toBe(true);
    expect(isChineseDeckLocale('en-US')).toBe(false);
    expect(isChineseDeckLocale(undefined)).toBe(false);
  });

  it('is true exactly when the card would switch', () => {
    expect(hasCompleteTranslation(CARD, ENGLISH_MCQ, ZH)).toBe(true);
    expect(hasCompleteTranslation(CARD, ENGLISH_MCQ, { ...ZH, mcq: null })).toBe(false);
    expect(hasCompleteTranslation(CARD, ENGLISH_MCQ, null)).toBe(false);
    expect(hasCompleteTranslation({ ...CARD, Mcq: null }, null, { ...ZH, mcq: null })).toBe(true);
  });
});

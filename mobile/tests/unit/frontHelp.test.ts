import { describe, expect, it } from 'vitest';
import { parseFrontHelp } from '../../src/content/frontHelp';
import { parseRawCardTranslation } from '../../src/content/cardTranslation';
import { localizeForDisplay } from '../../src/content/localizeCard';
import type { CardExport } from '../../src/types/deckExport';

const help = [{ term: 'latency', definition: 'Time until a response.' }];
const zhHelp = [{ term: '延迟', definition: '收到响应所需的时间。' }];
const card: CardExport = { StableUid: 'latency-01', Revision: 2, Question: 'What does latency measure?', Explanation: 'Time.', FrontHelp: help, Difficulty: 1, OrderInDeck: 5 };
const translation = parseRawCardTranslation({ v: 1, question: '延迟衡量什么？', explanation: '时间。', frontHelp: zhHelp })!;

describe('front help parsing and display localization', () => {
  it('keeps the v1 extension strict, including fields inside help entries', () => {
    expect(translation.frontHelp).toEqual(zhHelp);
    for (const extra of [{ correct: true }, { frontHelps: [] }, { frontHelp: [{ ...zhHelp[0], correct: true }] }, { frontHelp: [zhHelp[0], zhHelp[0]] }, { frontHelp: [{ term: 'x', definition: 3 }] }]) {
      expect(parseRawCardTranslation({ v: 1, question: '问题', ...extra })).toBeNull();
    }
    expect(parseFrontHelp([{ term: ' latency ', definition: ' time ' }])).toEqual([{ term: 'latency', definition: 'time' }]);
    for (const raw of [null, undefined, []]) expect(parseFrontHelp(raw)).toBeNull();
    for (const raw of [[{ term: 'x'.repeat(81), definition: 'y' }], [{ term: 'x', definition: 'y'.repeat(241) }], [help[0], { ...help[0], term: 'LATENCY' }]]) expect(parseFrontHelp(raw)).toBeUndefined();
  });
  it('switches help with question text without changing identity, revision or the original card', () => {
    const input = { card, mcq: null, shownOrder: [], translation };
    const zh = localizeForDisplay({ ...input, lang: 'zh-CN' });
    expect(zh.card.FrontHelp).toEqual(zhHelp);
    expect(zh.card.Question).toBe(translation.question);
    expect(zh.card.StableUid).toBe(card.StableUid);
    expect(zh.card.Revision).toBe(card.Revision);
    expect(card.FrontHelp).toEqual(help);
    expect(localizeForDisplay({ ...input, lang: 'en' }).card).toBe(card);
    expect(localizeForDisplay({ ...input, lang: 'zh-CN', translation: { ...translation, frontHelp: [] } }).card).toBe(card);
    const legacy = { ...card }; delete legacy.FrontHelp;
    expect(localizeForDisplay({ ...input, card: legacy, lang: 'zh-CN' }).card).toBe(legacy);
    expect(localizeForDisplay({ ...input, card: legacy, translation: { ...translation, frontHelp: null }, lang: 'zh-CN' }).lang).toBe('zh-CN');
  });
});

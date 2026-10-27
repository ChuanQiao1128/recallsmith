import { describe, expect, it } from 'vitest';
import { parseFrontHelp, parseFrontHelpJson } from '../src/lib/frontHelp';
import { parseDeckMarkdown, planImport, serializeDeckMarkdown } from '../src/lib/deckImport';
import { runImport, type ImportBatchWriter } from '../src/lib/deckImportRunner';
import { cardFace } from '../src/lib/translationView';
import { buildDeckExportPreview } from '../src/lib/deckExportPreview';
import type { ImportCardInput } from '../src/api/authoring';
import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { ok } from './support/apiResult';

const help = [{ term: 'latency', definition: 'The time a request takes to receive a response.' }];
const zhHelp = [{ term: '延迟', definition: '请求发出到收到响应所需的时间。' }];
const base = '# deck: aws-basics\n## aws-01 | d1\nQ:\nWhat does latency measure?\nA:\nTime until a response.\n';
const bilingual = `${base}Q_ZH:\n延迟衡量什么？\nA_ZH:\n收到响应所需的时间。\nHELP:\n${JSON.stringify(help)}\nHELP_ZH:\n${JSON.stringify(zhHelp)}\n`;
const existing = (extra: Partial<Card> = {}): Card => ({ ...parseDeckMarkdown(base).cards[0], id: 1, deckId: 1, version: 2, createdAt: '', updatedAt: '', ...extra });

describe('question-side bilingual help', () => {
  it('validates trimmed entries, size, keys, types and duplicate terms or JSON keys', () => {
    expect(parseFrontHelp([{ term: ' latency ', definition: ' time ' }])).toEqual([{ term: 'latency', definition: 'time' }]);
    for (const raw of [null, undefined, []]) expect(parseFrontHelp(raw)).toBeNull();
    for (const raw of [{}, [help[0], help[0]], [help[0], { ...help[0], term: 'LATENCY' }], [{ term: 1, definition: 'a' }], [{ term: 'a', definition: 'b', correct: true }], [{ term: 'a'.repeat(81), definition: 'b' }], [{ term: 'a', definition: 'b'.repeat(241) }]]) expect(parseFrontHelp(raw)).toBeUndefined();
    expect(() => parseFrontHelpJson('[{"term":"a","term":"b","definition":"c"}]')).toThrow(/unique/);
    expect(parseFrontHelpJson('[{"term":"a","definition":"a \\"term\\": key"}]')).toHaveLength(1);
  });

  it('round trips both languages and keeps the optional extension on translation v1', () => {
    const parsed = parseDeckMarkdown(bilingual);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[0].frontHelp).toEqual(help);
    expect(parsed.cards[0].translations?.['zh-CN']).toMatchObject({ v: 1, frontHelp: zhHelp });
    expect(parseDeckMarkdown(serializeDeckMarkdown('aws-basics', parsed.cards)).cards[0]).toEqual({ ...parsed.cards[0], sourceLine: 3 });
    const card = parsed.cards[0];
    const english = { ...card, realWorldUsage: null, mcq: null };
    expect(cardFace(english, card.translations, 'en').frontHelp).toEqual(help);
    expect(cardFace(english, card.translations, 'zh-CN').frontHelp).toEqual(zhHelp);
    const preview = buildDeckExportPreview({ slug: 'aws-basics', deckType: 1 } as Deck, [existing(card)]);
    expect(preview.Cards[0].FrontHelp).toEqual(help);
    expect(preview.Cards[0].Translations?.['zh-CN']?.frontHelp).toEqual(zhHelp);
  });

  it('refuses malformed, unknown and misspelled markers and missing Chinese help', () => {
    for (const marker of ['HELP :', 'HELP_ZH：', 'HELP_EN:', 'HEPL:', 'HELPERS:']) {
      const parsed = parseDeckMarkdown(`${base}${marker}\n${JSON.stringify(help)}\n`);
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.cards[0]?.explanation ?? '').not.toContain(marker);
    }
    expect(parseDeckMarkdown(bilingual.replace(`HELP_ZH:\n${JSON.stringify(zhHelp)}\n`, '')).errors.map(x => x.code)).toContain('ZH_MISSING_FIELD');
    expect(parseDeckMarkdown(bilingual.replace(JSON.stringify(zhHelp), '[]')).errors.map(x => x.code)).toContain('TRANSLATION_FRONT_HELP_MISMATCH');
    expect(parseDeckMarkdown(`${base}HELP:\nnull`).errors.map(x => x.code)).toContain('FRONT_HELP_BAD_SHAPE');
  });

  it('preserves both languages when a pre-help bilingual file updates other content', async () => {
    const stored = existing(parseDeckMarkdown(bilingual).cards[0]);
    const oldFile = bilingual.replace(`HELP:\n${JSON.stringify(help)}\nHELP_ZH:\n${JSON.stringify(zhHelp)}\n`, '');
    const plan = planImport(parseDeckMarkdown(oldFile.replace('Time until', 'The time until')), [stored]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.updates[0].card).not.toHaveProperty('frontHelp');
    expect(plan.updates[0].card.translations?.['zh-CN']?.frontHelp).toEqual(zhHelp);
    expect(plan.updates[0].changedFields).not.toContain('translations');
    const sent: ImportCardInput[] = [];
    await runImport(1, plan.updates, { async importCards(input) { sent.push(...input.cards); return ok({ created: 0, updated: 1, unchanged: 0 }); } });
    expect(sent[0]).not.toHaveProperty('frontHelp');
    expect(sent[0].translations).toEqual(plan.updates[0].card.translations);
  });

  it('preserves omitted help on re-import, sends explicit clearing, and compares help edits', async () => {
    const stored = existing({ frontHelp: help });
    expect(planImport(parseDeckMarkdown(base), [stored]).unchanged).toHaveLength(1);
    const edited = parseDeckMarkdown(base.replace('Time until', 'The time until'));
    const plan = planImport(edited, [stored]);
    const sent: ImportCardInput[] = [];
    const writer: ImportBatchWriter = { async importCards(input) { sent.push(...input.cards); return ok({ created: 0, updated: input.cards.length, unchanged: 0 }); } };
    await runImport(1, plan.updates, writer);
    expect(sent[0]).not.toHaveProperty('frontHelp');
    const clear = planImport(parseDeckMarkdown(`${base}HELP:\n[]\n`), [stored]);
    expect(clear.updates[0].changedFields).toContain('frontHelp');
    await runImport(1, clear.updates, writer);
    expect(sent[1].frontHelp).toEqual([]);
    const same = planImport(parseDeckMarkdown(`${base}HELP:\n${JSON.stringify(help)}\n`), [stored]);
    expect(same.unchanged).toHaveLength(1);
  });
});

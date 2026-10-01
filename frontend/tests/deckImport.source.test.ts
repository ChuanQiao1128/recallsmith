import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  parseDeckMarkdown,
  planImport,
  serializeDeckMarkdown,
  type ParsedCard,
} from '../src/lib/deckImport';
import { runImport, type ImportBatchWriter } from '../src/lib/deckImportRunner';
import { normalizeSourceForCompare } from '../src/lib/sourceRules';
import type { ImportCardInput, ImportCardsBatchResult } from '../src/api/authoring';
import type { ApiResult } from '../src/types/api';
import type { Card } from '../src/types/card';

function doc(lines: string[]): string {
  return lines.join('\n');
}

// FORMAT.md §3.2, the card every test here decorates with a SOURCE: line.
const CARD_LINES = [
  '## sample-qa-topic-02 | d1',
  'TOPIC: 4.1 Cost-optimized storage',
  'Q:',
  'Nightly database dumps of about 200 GB each must be kept for 90 days and are restored perhaps twice a year, always within a few hours of the request. Which S3 storage class keeps cost lowest without breaking the restore expectation?',
  'A:',
  'S3 Glacier Flexible Retrieval: it is priced for data read once or twice a year and its standard retrieval finishes in 3 to 5 hours, inside the "few hours" window.',
  'USAGE:',
  'Pick the coldest class whose restore time still fits the recovery-time objective you actually promised.',
];

// A second plain card, so a dropped first card still leaves something parsed.
const OTHER_CARD_LINES = [
  '## sample-other-03 | d2',
  'Q:',
  'What does S3 Versioning keep?',
  'A:',
  'Prior copies of every object.',
];

const SRC_URL = 'https://example.com/s3/restoring-objects';

function deckWith(sourceLines: string[], extra: string[] = []): string {
  return doc(['# deck: lint-sample', '', ...CARD_LINES, ...sourceLines, '', ...extra]);
}

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
    mcq: null,
    source: card.source ?? null,
    revision: 1,
    version: 1,
    isDeleted: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function ok(): ApiResult<ImportCardsBatchResult> {
  return { success: true, data: { created: 0, updated: 0, unchanged: 0 }, error: null, traceId: 't' };
}

function recorder(): { writer: ImportBatchWriter; batches: ImportCardInput[][] } {
  const batches: ImportCardInput[][] = [];
  const writer: ImportBatchWriter = {
    async importCards(params) {
      batches.push(params.cards);
      return ok();
    },
  };
  return { writer, batches };
}

describe('deckImport SOURCE:', () => {
  it('parses SOURCE: into source with the quote from the lines below it', () => {
    const parsed = parseDeckMarkdown(
      deckWith([`SOURCE:   ${SRC_URL}  `, 'First quoted line.', 'Second quoted line.']),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].source).toEqual({ url: SRC_URL, quote: 'First quoted line.\nSecond quoted line.' });
    // The quote never leaks into the USAGE: section above it.
    expect(parsed.cards[0].realWorldUsage).toBe(
      'Pick the coldest class whose restore time still fits the recovery-time objective you actually promised.',
    );
  });

  it('leaves source absent, not null, on a card without SOURCE:', () => {
    const parsed = parseDeckMarkdown(deckWith([]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(parsed.cards[0], 'source')).toBe(false);
  });

  it('stores an empty quote as null', () => {
    const parsed = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[0].source).toEqual({ url: SRC_URL, quote: null });
  });

  it('drops a card whose SOURCE: url is not https and reports BAD_SOURCE_URL', () => {
    const text = deckWith(['SOURCE: http://example.com/plain', 'A quote line.'], OTHER_CARD_LINES);
    const parsed = parseDeckMarkdown(text);
    expect(parsed.cards.map((c) => c.stableUid)).toEqual(['sample-other-03']);
    const sourceLine = text.split('\n').indexOf('SOURCE: http://example.com/plain') + 1;
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({
      code: 'BAD_SOURCE_URL',
      line: sourceLine,
      stableUid: 'sample-qa-topic-02',
    });
    expect(parsed.errors[0].message).toContain('sample-qa-topic-02');
    expect(parsed.errors[0].message).toContain('https://');
    // The quote line is the section body, not stray text.
    expect(parsed.errors.some((e) => e.code === 'TEXT_BEFORE_SECTION')).toBe(false);
  });

  it('drops a card whose SOURCE: url is empty or longer than 2048 characters', () => {
    const exact = `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`;
    expect(exact).toHaveLength(2048);

    const accepted = parseDeckMarkdown(deckWith([`SOURCE: ${exact}`]));
    expect(accepted.errors).toEqual([]);
    expect(accepted.cards[0].source?.url).toBe(exact);

    for (const payload of ['', '   ', `${exact}a`, 'https://example.com/with space']) {
      const parsed = parseDeckMarkdown(deckWith([`SOURCE:${payload === '' ? '' : ' '}${payload}`], OTHER_CARD_LINES));
      expect(parsed.cards.map((c) => c.stableUid)).toEqual(['sample-other-03']);
      expect(parsed.errors.map((e) => e.code)).toEqual(['BAD_SOURCE_URL']);
    }
  });

  it('blocks a quote longer than 1000 characters with SOURCE_QUOTE_TOO_LONG', () => {
    const exact = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`, 'q'.repeat(1000)]));
    expect(exact.errors).toEqual([]);
    expect(exact.cards[0].source?.quote).toHaveLength(1000);

    const long = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`, 'q'.repeat(1001)]));
    expect(long.errors).toEqual([
      expect.objectContaining({ code: 'SOURCE_QUOTE_TOO_LONG', line: 3, stableUid: 'sample-qa-topic-02' }),
    ]);
    // The validator blocks rather than drops: planImport turns it into a conflict.
    const plan = planImport(long, []);
    expect(plan.creates).toEqual([]);
    expect(plan.conflicts.map((c) => c.reason)).toEqual(['INVALID_CARD']);
  });

  it('keeps the first SOURCE: and reports DUPLICATE_SECTION for the second', () => {
    const text = deckWith([
      `SOURCE: ${SRC_URL}`,
      'The first quote.',
      'SOURCE: http://not-evaluated.example.com',
      'The second quote.',
    ]);
    const parsed = parseDeckMarkdown(text);
    const repeatLine = text.split('\n').indexOf('SOURCE: http://not-evaluated.example.com') + 1;
    expect(parsed.errors).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_SECTION', line: repeatLine, stableUid: 'sample-qa-topic-02' }),
    ]);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].source).toEqual({ url: SRC_URL, quote: 'The first quote.' });
  });

  it('serializes SOURCE: after USAGE: and round-trips through parseDeckMarkdown', () => {
    const parsed = parseDeckMarkdown(
      deckWith([`SOURCE: ${SRC_URL}`, 'Line one of the quote.', 'Line two.'], [...OTHER_CARD_LINES, `SOURCE: ${SRC_URL}/2`]),
    );
    expect(parsed.errors).toEqual([]);
    const text = serializeDeckMarkdown('lint-sample', parsed.cards);
    const lines = text.split('\n');
    const usageAt = lines.indexOf('USAGE:');
    expect(lines[usageAt + 2]).toBe(`SOURCE: ${SRC_URL}`);
    expect(lines[usageAt + 3]).toBe('Line one of the quote.');
    expect(lines).toContain(`SOURCE: ${SRC_URL}/2`);

    const again = parseDeckMarkdown(text);
    expect(again.errors).toEqual([]);
    expect(again.cards.map((c) => c.source)).toEqual([
      { url: SRC_URL, quote: 'Line one of the quote.\nLine two.' },
      { url: `${SRC_URL}/2`, quote: null },
    ]);
  });

  it('plans an update when only the source changed', () => {
    const parsed = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`, 'New quote.']));
    const card = parsed.cards[0];
    const existing = serverCard(card, { id: 1, source: { url: SRC_URL, quote: 'Old quote.' } });
    const plan = planImport(parsed, [existing]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].changedFields).toEqual(['source']);

    // A server source against a file without SOURCE: is a change too.
    const bare = parseDeckMarkdown(deckWith([]));
    const cleared = planImport(bare, [serverCard(bare.cards[0], { id: 1, source: { url: SRC_URL, quote: null } })]);
    expect(cleared.updates.map((u) => u.changedFields)).toEqual([['source']]);
  });

  it('plans unchanged when the server source matches after trimming', () => {
    const parsed = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`, 'A quote.']));
    const card = parsed.cards[0];
    const plan = planImport(parsed, [
      serverCard(card, { id: 1, source: { url: `  ${SRC_URL} `, quote: ' A quote.\n' } }),
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toHaveLength(1);

    // No SOURCE: in the file matches a server null and an older server's missing key.
    const bare = parseDeckMarkdown(deckWith([]));
    const withNull = serverCard(bare.cards[0], { id: 1, source: null });
    const withoutKey: Card = { ...withNull };
    delete withoutKey.source;
    expect(planImport(bare, [withNull]).unchanged).toHaveLength(1);
    expect(planImport(bare, [withoutKey]).unchanged).toHaveLength(1);

    // A blank quote on the server equals a null quote in the file.
    const noQuote = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`]));
    expect(
      planImport(noQuote, [serverCard(noQuote.cards[0], { id: 1, source: { url: SRC_URL, quote: '  ' } })]).unchanged,
    ).toHaveLength(1);
  });

  it('sends source in the import body, and null when the card has none', async () => {
    const parsed = parseDeckMarkdown(deckWith([`SOURCE: ${SRC_URL}`, 'A quote.'], OTHER_CARD_LINES));
    expect(parsed.errors).toEqual([]);
    const plan = planImport(parsed, []);
    const rec = recorder();
    const result = await runImport(7, [...plan.creates, ...plan.updates], rec.writer, { sleep: async () => {} });
    expect(result.failures).toEqual([]);
    expect(rec.batches).toHaveLength(1);
    const [withSource, without] = rec.batches[0];
    expect(withSource.source).toEqual({ url: SRC_URL, quote: 'A quote.' });
    expect(Object.prototype.hasOwnProperty.call(without, 'source')).toBe(true);
    expect(without.source).toBeNull();
  });

  it('normalizeSourceForCompare maps null and absent to the empty string', () => {
    expect(normalizeSourceForCompare(null)).toBe('');
    expect(normalizeSourceForCompare(undefined)).toBe('');
    expect(normalizeSourceForCompare({ url: ` ${SRC_URL} `, quote: '  ' })).toBe(JSON.stringify([SRC_URL, null]));
    expect(normalizeSourceForCompare({ url: SRC_URL, quote: ' q ' })).toBe(JSON.stringify([SRC_URL, 'q']));
  });

  it('parses both project deck files with every card and no issues', () => {
    for (const name of ['aws-saa-c03.md', 'claude-ccdv-f.md']) {
      const text = readFileSync(new URL(`../../content/decks/${name}`, import.meta.url), 'utf8');
      const headers = text.match(/^## /gm) ?? [];
      const parsed = parseDeckMarkdown(text);
      expect(headers.length).toBeGreaterThan(0);
      expect(parsed.cards.length).toBe(headers.length);
      expect(parsed.errors).toEqual([]);
      // The decks carry reviewed SOURCE lines (R20 citation backfill); each one must be well formed.
      for (const c of parsed.cards) {
        if (!c.source) continue;
        expect(c.source.url, c.stableUid).toMatch(/^https:\/\/\S+$/);
        expect((c.source.quote ?? '').length, c.stableUid).toBeGreaterThan(0);
        expect((c.source.quote ?? '').length, c.stableUid).toBeLessThanOrEqual(1000);
      }
    }
  });
});

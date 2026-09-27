import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { lintDraftCard, parseTopicVocabulary, type LintResult } from '../src/lint';
import { callTool, connect, makeTestEnv, MCQ_CHUNK, SAMPLE_CHUNK, sampleCard, sampleMcqCard, type TestEnv } from './helpers';

const formatMd = readFileSync(new URL('../../../content/decks/FORMAT.md', import.meta.url), 'utf8');
const vocabulary = parseTopicVocabulary(formatMd);

function codes(items: Array<{ code: string }>): string[] {
  return items.map((item) => item.code);
}

describe('lint_card', () => {
  let env: TestEnv;
  let client: Client;
  beforeAll(async () => {
    env = makeTestEnv();
    client = await connect(env.config);
  });
  afterAll(async () => {
    await client.close();
    env.cleanup();
  });

  async function lint(args: Record<string, unknown>): Promise<LintResult> {
    const result = await callTool(client, 'lint_card', args);
    expect(result.isError).toBe(false);
    return JSON.parse(result.text) as LintResult;
  }

  it('accepts a sourced card built from the FORMAT.md sample', async () => {
    const result = await lint({ deckSlug: 'aws-saa-c03', card: sampleCard(), sourceChunkText: SAMPLE_CHUNK });
    expect(result).toEqual({ ok: true, issues: [], warnings: [] });

    const mcq = await lint({ deckSlug: 'aws-saa-c03', card: sampleMcqCard(), sourceChunkText: MCQ_CHUNK });
    expect(mcq.ok).toBe(true);
    expect(mcq.issues).toEqual([]);
  });

  it('reports SOURCE_REQUIRED when the source or its quote is missing', async () => {
    const { source: _omitted, ...unsourced } = sampleCard();
    const missing = await lint({ deckSlug: 'aws-saa-c03', card: unsourced });
    expect(missing.ok).toBe(false);
    expect(codes(missing.issues)).toEqual(['SOURCE_REQUIRED']);

    const blankQuote = await lint({
      deckSlug: 'aws-saa-c03',
      card: { ...sampleCard(), source: { url: 'https://example.com/s3/retrieval-options', quote: '   ' } },
    });
    expect(codes(blankQuote.issues)).toEqual(['SOURCE_REQUIRED']);

    const blankUrl = await lint({ deckSlug: 'aws-saa-c03', card: { ...sampleCard(), source: { url: ' ', quote: 'standard retrieval' } } });
    expect(codes(blankUrl.issues)).toContain('SOURCE_REQUIRED');
  });

  it('reports SOURCE_QUOTE_NOT_IN_CHUNK when the quote is not in the chunk text', async () => {
    const result = await lint({
      deckSlug: 'aws-saa-c03',
      card: { ...sampleCard(), source: { url: 'https://example.com/s3/retrieval-options', quote: 'Standard retrieval finishes in 3 to 5 hours' } },
      sourceChunkText: SAMPLE_CHUNK,
    });
    expect(result.ok).toBe(false);
    expect(codes(result.issues)).toEqual(['SOURCE_QUOTE_NOT_IN_CHUNK']);

    // Without chunk text the quote is not checked.
    const unchecked = await lint({ deckSlug: 'aws-saa-c03', card: sampleCard() });
    expect(unchecked.ok).toBe(true);
  });

  it('matches the quote against the chunk after normalising whitespace', async () => {
    // The quote spans the chunk's line break; it is long enough for SOURCE_QUOTE_TOO_SHORT (ai-agent-24).
    const card = { ...sampleCard(), source: { url: 'https://example.com/s3/retrieval-options', quote: ' read once or twice a year.  Its standard\tretrieval finishes ' } };
    const result = await lint({ deckSlug: 'aws-saa-c03', card, sourceChunkText: SAMPLE_CHUNK });
    expect(result.ok).toBe(true);
  });

  it('reports SOURCE_QUOTE_TOO_SHORT for a quote under 40 characters or 6 words (ai-agent-24)', async () => {
    const withQuote = (quote: string) => ({ ...sampleCard(), source: { url: 'https://example.com/s3/retrieval-options', quote } });
    // A two-word quote occurs on almost any page; it is refused even when it is in the chunk.
    const twoWords = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('S3 Glacier'), sourceChunkText: SAMPLE_CHUNK });
    expect(twoWords.ok).toBe(false);
    expect(codes(twoWords.issues)).toEqual(['SOURCE_QUOTE_TOO_SHORT']);
    expect(twoWords.issues[0]?.message).toContain('10 characters and 2 words');

    // Long enough in characters but too few words (a single long identifier).
    const fewWords = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('arn:aws:s3:::example-bucket-for-archived-dumps/nightly') });
    expect(codes(fewWords.issues)).toEqual(['SOURCE_QUOTE_TOO_SHORT']);

    // Six words but under 40 characters once whitespace is collapsed.
    const fewChars = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('It   is priced for  archives   read') });
    expect(codes(fewChars.issues)).toEqual(['SOURCE_QUOTE_TOO_SHORT']);

    // 39 characters is one short; exactly 40 characters and 6 words passes.
    const oneShort = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('Its standard retrieval finishes in 3 to'), sourceChunkText: SAMPLE_CHUNK });
    expect(codes(oneShort.issues)).toEqual(['SOURCE_QUOTE_TOO_SHORT']);
    const atLimit = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('year. Its standard retrieval finishes in'), sourceChunkText: SAMPLE_CHUNK });
    expect(atLimit).toEqual({ ok: true, issues: [], warnings: [] });

    // The check runs without sourceChunkText too.
    const unchecked = await lint({ deckSlug: 'aws-saa-c03', card: withQuote('Its standard retrieval') });
    expect(codes(unchecked.issues)).toEqual(['SOURCE_QUOTE_TOO_SHORT']);
  });

  it('warns TOPIC_NOT_IN_VOCABULARY for a topic outside the deck vocabulary', async () => {
    const result = await lint({ deckSlug: 'aws-saa-c03', card: { ...sampleCard(), topic: '4.1 cost-optimized storage' } });
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toEqual(['TOPIC_NOT_IN_VOCABULARY']);
    expect(result.warnings[0]?.message).toContain('aws-saa-c03');
    expect(result.warnings[0]?.message).toContain('content/decks/FORMAT.md §5');

    const noTopic = await lint({ deckSlug: 'aws-saa-c03', card: { ...sampleCard(), topic: null } });
    expect(codes(noTopic.warnings)).toEqual(['TOPIC_NOT_IN_VOCABULARY']);

    // A deck without a vocabulary is not checked.
    const other = await lint({ deckSlug: 'some-other-deck', card: { ...sampleCard(), topic: 'Anything' } });
    expect(other.warnings).toEqual([]);
  });

  it('reports BAD_SOURCE_URL for a non-https source url', async () => {
    const result = await lint({
      deckSlug: 'aws-saa-c03',
      card: { ...sampleCard(), source: { url: 'http://example.com/s3/retrieval-options', quote: 'standard retrieval finishes in 3 to 5 hours' } },
    });
    expect(result.ok).toBe(false);
    expect(codes(result.issues)).toContain('BAD_SOURCE_URL');
  });

  it('reports MCQ_OPTION_TOO_LONG for an option over 600 characters', async () => {
    const card = sampleMcqCard();
    const mcq = card.mcq;
    if (!mcq) throw new Error('fixture has no mcq');
    const long = `${mcq.options[1]?.text ?? ''} ${'x'.repeat(600)}`;
    const options = mcq.options.map((option) => (option.key === 'b' ? { ...option, text: long } : option));
    const result = await lint({ deckSlug: 'aws-saa-c03', card: { ...card, mcq: { ...mcq, options } } });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'MCQ_OPTION_TOO_LONG');
    expect(issue?.message).toBe(
      `Option "b" of card "sample-mcq-choose-two-03" is ${long.trim().length} characters; the server allows at most 600.`,
    );
  });

  it('surfaces console importer errors such as a bad uid and a blank question', () => {
    const result = lintDraftCard({ deckSlug: 'aws-saa-c03', card: { ...sampleCard(), stableUid: 'Bad UID' } }, vocabulary);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    const blank = lintDraftCard({ deckSlug: 'aws-saa-c03', card: { ...sampleCard(), question: '  ' } }, vocabulary);
    expect(codes(blank.issues)).toContain('MISSING_QUESTION');
  });

  it('reads the topic vocabulary of both project decks from FORMAT.md', () => {
    const aws = vocabulary.get('aws-saa-c03') ?? [];
    const claude = vocabulary.get('claude-ccdv-f') ?? [];
    expect(aws).toContain('4.1 Cost-optimized storage');
    expect(claude).toContain('D8 Tools & MCP');
    expect(aws.length).toBeGreaterThanOrEqual(8);
    expect(claude.length).toBeGreaterThanOrEqual(8);
    expect(aws).not.toContain('`TOPIC:` label');
    expect(aws).not.toContain('TOPIC:');
    expect([...vocabulary.keys()].sort()).toEqual(['aws-saa-c03', 'claude-ccdv-f']);
  });
});

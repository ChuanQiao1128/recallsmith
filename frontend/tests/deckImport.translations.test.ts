// The zh-CN `_ZH` sections of the deck Markdown (card translations contract
// §3, content/decks/FORMAT.md §1.7 and §3.4): lexing, completeness, the
// round trip through serializeDeckMarkdown, the planner's canonical compare,
// the TRANSLATIONS_WOULD_BE_CLEARED guard in the plan and in the runner, and
// the promise that every English-only deck file behaves exactly as before.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parseDeckMarkdown,
  planImport,
  serializeDeckMarkdown,
  translationPlanWarnings,
  type ParsedCard,
} from '../src/lib/deckImport';
import {
  runImport,
  TRANSLATIONS_WOULD_BE_CLEARED,
  type ImportAction,
  type ImportBatchWriter,
} from '../src/lib/deckImportRunner';
import type { ImportCardInput } from '../src/api/authoring';
import type { Card } from '../src/types/card';
import { ok } from './support/apiResult';

const DECKS_DIR = fileURLToPath(new URL('../../content/decks/', import.meta.url));
const FORMAT_MD = readFileSync(join(DECKS_DIR, 'FORMAT.md'), 'utf8');

/** The fenced example under FORMAT.md §3.4, so the documented card is the tested card. */
function formatExample(): string {
  const section = FORMAT_MD.slice(FORMAT_MD.indexOf('### 3.4'));
  const body = section.split('```markdown\n')[1]?.split('\n```')[0];
  if (!body) throw new Error('FORMAT.md §3.4 has no markdown example');
  return body;
}

const EXAMPLE = formatExample();
const DOC = `# deck: lint-sample\n\n${EXAMPLE}\n`;
const UID = 'sample-mcq-zh-04';

/** DOC with one line removed (with the body line after it, when `withBody`). */
function without(marker: string, withBody = true): string {
  const lines = DOC.split('\n');
  const at = lines.findIndex((line) => line === marker);
  if (at < 0) throw new Error(`no ${marker} line`);
  lines.splice(at, withBody ? 2 : 1);
  return lines.join('\n');
}

/** DOC with `extra` lines inserted right before the first line equal to `before`. */
function insertBefore(before: string, extra: string[]): string {
  const lines = DOC.split('\n');
  const at = lines.findIndex((line) => line === before);
  if (at < 0) throw new Error(`no ${before} line`);
  lines.splice(at, 0, ...extra);
  return lines.join('\n');
}

function codesOf(text: string): string[] {
  return parseDeckMarkdown(text).errors.map((issue) => issue.code);
}

function contentOf(cards: readonly ParsedCard[]): Partial<ParsedCard>[] {
  return cards.map((card) => {
    const content: Partial<ParsedCard> = { ...card };
    delete content.sourceLine;
    return content;
  });
}

/** The same cards with every translation removed: what an English-only export of the deck holds. */
function englishOnlyOf(cards: readonly ParsedCard[]): ParsedCard[] {
  return cards.map((card) => {
    const copy: ParsedCard = { ...card };
    delete copy.translations;
    return copy;
  });
}

function serverCard(parsed: ParsedCard, over: Partial<Card> = {}): Card {
  return {
    id: 41,
    deckId: 7,
    stableUid: parsed.stableUid,
    question: parsed.question,
    explanation: parsed.explanation,
    realWorldUsage: parsed.realWorldUsage,
    codeSnippet: parsed.codeSnippet,
    codeLanguage: parsed.codeLanguage,
    topic: parsed.topic ?? null,
    mcq: parsed.mcq ?? null,
    source: parsed.source ?? null,
    translations: parsed.translations ?? null,
    difficulty: parsed.difficulty,
    orderInDeck: parsed.orderInDeck,
    version: 3,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

describe('the FORMAT.md §3.4 example', () => {
  it('parses with no issues into one card carrying a zh-CN translation keyed by the English options', () => {
    const parsed = parseDeckMarkdown(DOC);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toHaveLength(1);
    const card = parsed.cards[0];
    const zh = card.translations?.['zh-CN'];
    expect(zh?.v).toBe(1);
    expect(zh?.question).toContain('（选择两项。）');
    expect(zh?.question).toContain('Amazon S3');
    expect(zh?.mcq?.qualifier).toBe('最安全');
    expect(Object.keys(zh?.mcq?.options ?? {})).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(zh?.mcq?.options.a).toEqual({ text: expect.stringContaining('AWS KMS'), why: null });
    expect(zh?.mcq?.options.b.why).toContain('SSE-S3');
    expect(zh?.realWorldUsage).toBeTruthy();
    // The correct marks live on the English mcq only.
    expect(card.mcq?.options.filter((o) => o.correct).map((o) => o.key)).toEqual(['a', 'c']);
    expect(JSON.stringify(zh)).not.toContain('correct');
    expect(card.source).toBeUndefined();
  });

  it('carries the two longest-answer hints, one per language, and nothing else', () => {
    expect(parseDeckMarkdown(DOC).warnings.map((w) => w.code)).toEqual(['MCQ_WARN_CORRECT_LONGEST', 'ZH_WARN_CORRECT_LONGEST']);
  });

  it('round trips through serializeDeckMarkdown in canonical order, byte stable on the second pass', () => {
    const parsed = parseDeckMarkdown(DOC);
    const text = serializeDeckMarkdown('lint-sample', parsed.cards);
    const again = parseDeckMarkdown(text);
    expect(again.errors).toEqual([]);
    expect(contentOf(again.cards)).toEqual(contentOf(parsed.cards));
    expect(serializeDeckMarkdown('lint-sample', again.cards)).toBe(text);

    const markers = text.split('\n').filter((line) => /^[A-Z_]+:/.test(line)).map((line) => line.split(':')[0]);
    expect(markers).toEqual([
      'TOPIC', 'QUALIFIER', 'QUALIFIER_ZH', 'Q', 'Q_ZH',
      'OPT', 'OPT_ZH',
      'OPT', 'OPT_ZH', 'WHY', 'WHY_ZH',
      'OPT', 'OPT_ZH',
      'OPT', 'OPT_ZH', 'WHY', 'WHY_ZH',
      'OPT', 'OPT_ZH', 'WHY', 'WHY_ZH',
      'A', 'A_ZH', 'USAGE', 'USAGE_ZH',
    ]);
    // The documented example is already canonical: serializing it reproduces it.
    expect(text).toBe(`# deck: lint-sample\n\n${EXAMPLE}\n`);
  });
});

describe('a Q/A card with a translation', () => {
  const QA = [
    '# deck: lint-sample',
    '',
    '## sample-qa-zh-05 | d1',
    'Q:',
    'Which S3 storage class keeps nightly dumps cheapest while restoring within hours?',
    'Q_ZH: 哪种 S3 存储类别最便宜，同时能在几小时内恢复每晚的转储？',
    'A:',
    'S3 Glacier Flexible Retrieval.',
    'A_ZH: S3 Glacier Flexible Retrieval。',
    'CODE: bash',
    'aws s3 cp dump.sql s3://bucket/ --storage-class GLACIER',
    '',
  ].join('\n');

  it('has no mcq in the translation and keeps the code English only', () => {
    const parsed = parseDeckMarkdown(QA);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[0].translations).toEqual({
      'zh-CN': {
        v: 1,
        question: '哪种 S3 存储类别最便宜，同时能在几小时内恢复每晚的转储？',
        explanation: 'S3 Glacier Flexible Retrieval。',
      },
    });
    expect(parsed.cards[0].codeSnippet).toContain('--storage-class');
    const text = serializeDeckMarkdown('lint-sample', parsed.cards);
    expect(contentOf(parseDeckMarkdown(text).cards)).toEqual(contentOf(parsed.cards));
  });

  it('refuses an extra USAGE_ZH: when the English card has no USAGE:', () => {
    const parsed = parseDeckMarkdown(`${QA}USAGE_ZH:\n多出来的用法。\n`);
    expect(parsed.errors.map((issue) => issue.code)).toEqual(['TRANSLATION_FIELD_EXTRA']);
    expect(planImport(parsed, []).conflicts.map((c) => c.reason)).toEqual(['INVALID_CARD']);
  });
});

describe('_ZH lexing rules', () => {
  it('ZH_MISSING_FIELD names every missing twin and drops the card', () => {
    const cases: Array<[string, string]> = [
      ['QUALIFIER_ZH: 最安全', 'QUALIFIER_ZH:'],
      ['Q_ZH:', 'Q_ZH:'],
      ['A_ZH:', 'A_ZH:'],
      ['USAGE_ZH:', 'USAGE_ZH:'],
    ];
    for (const [line, name] of cases) {
      const parsed = parseDeckMarkdown(without(line, line.endsWith(':')));
      expect(parsed.errors.map((issue) => issue.code), name).toEqual(['ZH_MISSING_FIELD']);
      expect(parsed.errors[0].message, name).toContain(name);
      expect(parsed.errors[0].stableUid).toBe(UID);
      expect(parsed.cards, name).toEqual([]);
    }

    // OPT_ZH:/WHY_ZH: are per option: drop option b's twins.
    const lines = DOC.split('\n');
    const optB = lines.indexOf('OPT: b');
    expect(lines[optB + 2]).toBe('OPT_ZH:');
    lines.splice(optB + 2, 2);
    const whyZh = lines.indexOf('WHY_ZH:', optB);
    lines.splice(whyZh, 2);
    const parsed = parseDeckMarkdown(lines.join('\n'));
    expect(parsed.errors.map((issue) => issue.message)).toEqual([
      expect.stringContaining('OPT_ZH: for option "b"'),
      expect.stringContaining('WHY_ZH: for option "b"'),
    ]);
    expect(parsed.cards).toEqual([]);
  });

  it('ZH_UNSUPPORTED_FIELD refuses SOURCE_ZH:/CODE_ZH:/TOPIC_ZH: and never glues their body to the section above', () => {
    for (const marker of ['SOURCE_ZH:', 'CODE_ZH: bash', 'TOPIC_ZH: 数据安全']) {
      const parsed = parseDeckMarkdown(insertBefore('A:', [marker, '这一行不能粘到上一节里。']));
      expect(parsed.errors.map((issue) => issue.code), marker).toEqual(['ZH_UNSUPPORTED_FIELD']);
      const zhWhyE = parsed.cards[0].translations?.['zh-CN']?.mcq?.options.e.why ?? '';
      expect(zhWhyE).not.toContain('这一行');
      expect(parsed.cards[0].mcq?.options[4].why).not.toContain('这一行');
    }
  });

  it('OPT_ZH: never carries a star (TRANSLATION_CORRECT_MARK) or any other payload (ZH_BAD_OPT_LINE)', () => {
    const star = parseDeckMarkdown(DOC.replace('OPT: b\nEnable SSE-S3 default encryption on the bucket.\nOPT_ZH:', 'OPT: b\nEnable SSE-S3 default encryption on the bucket.\nOPT_ZH: *'));
    expect(star.errors.map((issue) => issue.code)).toEqual(['TRANSLATION_CORRECT_MARK']);
    expect(star.cards).toEqual([]);

    const keyed = parseDeckMarkdown(DOC.replace('OPT: b\nEnable SSE-S3 default encryption on the bucket.\nOPT_ZH:', 'OPT: b\nEnable SSE-S3 default encryption on the bucket.\nOPT_ZH: b'));
    expect(keyed.errors.map((issue) => issue.code)).toEqual(['ZH_BAD_OPT_LINE']);
    expect(keyed.cards).toEqual([]);
  });

  it('ZH_WITHOUT_OPTION: OPT_ZH:/WHY_ZH: before the first OPT:', () => {
    expect(codesOf(insertBefore('OPT: a *', ['OPT_ZH:', '孤立的选项。']))).toContain('ZH_WITHOUT_OPTION');
    expect(codesOf(insertBefore('OPT: a *', ['WHY_ZH:', '孤立的理由。']))).toContain('ZH_WITHOUT_OPTION');
  });

  it('DUPLICATE_SECTION for a repeated Q_ZH: or QUALIFIER_ZH:, first one wins', () => {
    const repeatedQ = parseDeckMarkdown(insertBefore('OPT: a *', ['Q_ZH:', '第二份题干。']));
    expect(repeatedQ.errors.map((issue) => issue.code)).toEqual(['DUPLICATE_SECTION']);
    expect(repeatedQ.errors[0].message).toContain('Q_ZH:');
    expect(repeatedQ.cards[0].translations?.['zh-CN']?.question).not.toContain('第二份');

    const repeatedQualifier = parseDeckMarkdown(insertBefore('Q:', ['QUALIFIER_ZH: 最便宜']));
    expect(repeatedQualifier.errors.map((issue) => issue.code)).toEqual(['DUPLICATE_SECTION']);
    expect(repeatedQualifier.cards[0].translations?.['zh-CN']?.mcq?.qualifier).toBe('最安全');
  });

  it('EN_FIELD_HAS_CJK: a translated card whose English text contains Chinese', () => {
    const parsed = parseDeckMarkdown(DOC.replace('A:\nUse a customer managed KMS key', 'A:\n使用 Use a customer managed KMS key'));
    expect(parsed.errors.map((issue) => issue.code)).toEqual(['EN_FIELD_HAS_CJK']);
    expect(parsed.errors[0].message).toContain('A:');
    expect(planImport(parsed, []).conflicts.map((c) => c.reason)).toEqual(['INVALID_CARD']);
  });

  it('an English-only card written in Chinese (the aws-saa-fundamentals deck) is not an EN_FIELD_HAS_CJK', () => {
    const parsed = parseDeckMarkdown('# deck: aws-saa-fundamentals\n\n## fund-net-001 | d1\nQ:\n什么是 VPC？\nA:\n答：一个隔离的虚拟网络。\n');
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards[0].translations).toBeUndefined();
  });

  it('validateTranslation codes surface on the card and become INVALID_CARD conflicts', () => {
    const notInStem = parseDeckMarkdown(DOC.replace('QUALIFIER_ZH: 最安全', 'QUALIFIER_ZH: 最便宜'));
    expect(notInStem.errors.map((issue) => issue.code)).toEqual(['TRANSLATION_QUALIFIER_NOT_IN_STEM']);
    expect(planImport(notInStem, []).conflicts.map((c) => c.reason)).toEqual(['INVALID_CARD']);

    expect(codesOf(DOC.replace('最安全方式？（选择两项。）', '最安全方式？'))).toEqual(['TRANSLATION_CHOOSE_N_MISMATCH']);
    // A WHY_ZH: on the correct option a, whose English has no WHY:.
    expect(codesOf(insertBefore('OPT: b', ['WHY_ZH:', '正确选项不需要理由。']))).toEqual(['TRANSLATION_WHY_MISMATCH']);
  });

  it('a translation into the deck locale itself is refused when the plan knows the locale', () => {
    const parsed = parseDeckMarkdown(DOC);
    expect(planImport(parsed, [], { deckLocale: 'zh-CN' }).conflicts.map((c) => c.message)).toEqual([
      expect.stringContaining('already zh-CN'),
    ]);
    expect(planImport(parsed, [], { deckLocale: 'en-US' }).creates).toHaveLength(1);
  });
});

describe('planImport with translations', () => {
  const parsed = parseDeckMarkdown(DOC);
  const card = parsed.cards[0];

  it('is unchanged against the same translation in the server jsonb key order', () => {
    const zh = card.translations!['zh-CN']!;
    const pgOrder = {
      'zh-CN': {
        v: 1,
        mcq: {
          options: Object.fromEntries(Object.entries(zh.mcq!.options).map(([key, o]) => [key, { why: o.why, text: o.text }])),
          qualifier: zh.mcq!.qualifier,
        },
        question: zh.question,
        explanation: zh.explanation,
        realWorldUsage: zh.realWorldUsage,
      },
    };
    const plan = planImport(parsed, [serverCard(card, { translations: pgOrder as Card['translations'] })]);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.updates).toEqual([]);
  });

  it('plans an update of just translations when only the Chinese changed', () => {
    const edited = parseDeckMarkdown(DOC.replace('在存储桶上启用 MFA Delete。', '为存储桶启用 MFA Delete。'));
    const plan = planImport(edited, [serverCard(card)]);
    expect(plan.updates.map((u) => u.changedFields)).toEqual([['translations']]);
    expect(plan.updates[0].clearsTranslations).toBeUndefined();
  });

  it('an English-only card against a server without translations is unchanged (null and an absent key alike)', () => {
    const english = parseDeckMarkdown('# deck: d\n\n## c-1 | d1\nQ:\nq\nA:\na\n');
    const base = serverCard(english.cards[0]);
    expect(planImport(english, [{ ...base, translations: null }]).unchanged).toHaveLength(1);
    const oldServer: Card = { ...base };
    delete oldServer.translations;
    expect(planImport(english, [oldServer]).unchanged).toHaveLength(1);
  });

  it('TRANSLATIONS_WOULD_BE_CLEARED: an English-only file over translated server cards, even with no English change', () => {
    const englishOnly = parseDeckMarkdown(serializeDeckMarkdown('lint-sample', englishOnlyOf(parsed.cards)));
    expect(englishOnly.errors).toEqual([]);
    const plan = planImport(englishOnly, [serverCard(card)]);
    expect(plan.conflicts.map((c) => c.reason)).toEqual(['TRANSLATIONS_WOULD_BE_CLEARED']);
    expect(plan.updates).toEqual([]);

    const optedIn = planImport(englishOnly, [serverCard(card)], { allowClearTranslations: true });
    expect(optedIn.conflicts).toEqual([]);
    expect(optedIn.updates).toHaveLength(1);
    expect(optedIn.updates[0].changedFields).toEqual(['translations']);
    expect(optedIn.updates[0].clearsTranslations).toBe(true);
  });

  it('ZH_WARN_MAYBE_STALE when the English changed and the _ZH sections did not', () => {
    const englishEdit = parseDeckMarkdown(DOC.replace('Enable MFA Delete on the bucket.', 'Turn on MFA Delete for the bucket.'));
    const plan = planImport(englishEdit, [serverCard(card)]);
    expect(plan.updates.map((u) => u.changedFields)).toEqual([['mcq']]);
    expect(translationPlanWarnings(plan).map((w) => [w.code, w.stableUid])).toEqual([['ZH_WARN_MAYBE_STALE', UID]]);

    const both = parseDeckMarkdown(
      DOC.replace('Enable MFA Delete on the bucket.', 'Turn on MFA Delete for the bucket.').replace('在存储桶上启用 MFA Delete。', '为存储桶启用 MFA Delete。'),
    );
    expect(translationPlanWarnings(planImport(both, [serverCard(card)]))).toEqual([]);
  });
});

describe('the runner and translations', () => {
  function recorder(): { writer: ImportBatchWriter; batches: ImportCardInput[][] } {
    const batches: ImportCardInput[][] = [];
    return {
      batches,
      writer: {
        async importCards({ cards }) {
          batches.push(cards);
          return ok({ created: 0, updated: cards.length, unchanged: 0 });
        },
      },
    };
  }
  const parsed = parseDeckMarkdown(DOC);
  const englishOnly = parseDeckMarkdown(serializeDeckMarkdown('lint-sample', englishOnlyOf(parsed.cards)));

  it('sends the parsed translations, and null on a card without _ZH sections', async () => {
    const rec = recorder();
    const plan = planImport({ cards: [...parsed.cards, { ...englishOnly.cards[0], stableUid: 'plain-01', orderInDeck: 10 }] }, []);
    await runImport(7, plan.creates, rec.writer, { sleep: async () => {} });
    const [translated, plain] = rec.batches[0];
    expect(translated.translations).toEqual(parsed.cards[0].translations);
    expect(Object.hasOwn(plain, 'translations')).toBe(true);
    expect(plain.translations).toBeNull();
  });

  it('refuses, without sending, an update that would clear a translation without the opt-in', async () => {
    const rec = recorder();
    const sneaky: ImportAction = {
      kind: 'update',
      card: englishOnly.cards[0],
      existingId: 41,
      expectedVersion: 3,
      changedFields: ['translations'],
    };
    const result = await runImport(7, [sneaky], rec.writer, { sleep: async () => {} });
    expect(rec.batches).toEqual([]);
    expect(result.failures.map((f) => f.code)).toEqual([TRANSLATIONS_WOULD_BE_CLEARED]);
    expect(result.notRun).toBe(0);
  });

  it('sends translations: null once the plan carries the opt-in', async () => {
    const rec = recorder();
    const plan = planImport(englishOnly, [serverCard(parsed.cards[0])], { allowClearTranslations: true });
    const result = await runImport(7, plan.updates, rec.writer, { sleep: async () => {} });
    expect(result.failures).toEqual([]);
    expect(rec.batches[0][0].translations).toBeNull();
  });
});

describe('every deck file in content/decks is untouched by the _ZH support', () => {
  function deckFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...deckFiles(path));
      else if (name.endsWith('.md') && name !== 'FORMAT.md' && !name.endsWith('.REPORT.md')) out.push(path);
    }
    return out;
  }

  const files = deckFiles(DECKS_DIR);

  it('finds the deck files', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.some((f) => f.endsWith('claude-ccdv-f.md'))).toBe(true);
  });

  it.each(files.map((f) => [f.slice(DECKS_DIR.length), f]))('%s parses, carries no translation, and round trips unchanged', (_name, path) => {
    const parsed = parseDeckMarkdown(readFileSync(path, 'utf8'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cards.some((c) => Object.hasOwn(c, 'translations'))).toBe(false);
    expect(parsed.warnings.some((w) => w.code.startsWith('ZH_'))).toBe(false);

    const text = serializeDeckMarkdown(parsed.deckSlug ?? 'deck', parsed.cards);
    expect(/^[A-Z]+_ZH:/m.test(text)).toBe(false);
    const again = parseDeckMarkdown(text);
    expect(again.errors).toEqual([]);
    expect(contentOf(again.cards)).toEqual(contentOf(parsed.cards));
    expect(serializeDeckMarkdown(again.deckSlug ?? 'deck', again.cards)).toBe(text);
    // Importing the file over its own server state is still a no-op.
    const server = parsed.cards.map((c, i) => serverCard(c, { id: i + 1, translations: null }));
    const plan = planImport(parsed, server);
    expect(plan.updates).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

// evals/scripts/deck-lib.mts
//
// The one copy of the console-parser loader the eval scripts share (export-cards.mts,
// parse-deck.mts): frontend/src/lib/deckImport.ts parseDeckMarkdown, plus exportCard, the
// QaCard-shaped export of one parsed card.
//
// The parser is loaded like frontend/scripts/lint-deck.mts: esbuild bundles the library in
// memory and the bundle is imported from a data: URL. esbuild lives in frontend/node_modules,
// and Node resolves bare imports relative to the importing file, so it is resolved through a
// require anchored at frontend/package.json.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../..');

export interface ParsedDeckLike {
  deckSlug: string | null;
  cards: Array<Record<string, unknown>>;
  errors: Array<{ line: number; code: string; message: string }>;
}

export interface DeckLib {
  parseDeckMarkdown(text: string): ParsedDeckLike;
}

export async function loadDeckLib(): Promise<DeckLib> {
  const frontendRequire = createRequire(resolve(repo, 'frontend/package.json'));
  const { build } = frontendRequire('esbuild') as typeof import('esbuild');
  const libDir = resolve(repo, 'frontend/src/lib');
  const entry = resolve(libDir, 'deckImport.ts');
  const result = await build({
    stdin: {
      contents: `export { parseDeckMarkdown } from ${JSON.stringify(entry)};`,
      resolveDir: libDir,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return (await import(url)) as DeckLib;
}

/** One exported card, keys in the contract order (a QaCard without cardId/contentSha256). */
export function exportCard(deckSlug: string, card: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceUid: card.stableUid,
    deckSlug,
    stableUid: card.stableUid,
    difficulty: card.difficulty,
    topic: card.topic ?? null,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: card.codeSnippet ?? null,
    codeLanguage: card.codeLanguage ?? null,
    realWorldUsage: card.realWorldUsage ?? null,
    mcq: card.mcq ?? null,
    source: card.source ?? null,
  };
}

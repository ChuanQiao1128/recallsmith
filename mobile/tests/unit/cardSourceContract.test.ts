import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * K03 — the installed deck reader (installedDeckIndex.ts, which serves card sources and card
 * translations) mirrors private rules of the frozen deck repository (meta key prefix, deck folder
 * and file name, user-key sanitising) instead of importing them. If the repository ever changes
 * one of them, this fails loudly.
 */
describe('installed deck reader contract with deckRepository', () => {
  it('the frozen deck repository still uses the meta key, folder and user-key rule the reader mirrors', () => {
    const repo = readFileSync(resolve(__dirname, '../../src/content/deckRepository.ts'), 'utf8');
    const mirror = readFileSync(resolve(__dirname, '../../src/content/installedDeckIndex.ts'), 'utf8');

    for (const literal of [
      "'devcards:content:deckmeta:v2:'",
      'devcards-decks-v2/',
      ".replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)",
    ]) {
      expect(repo).toContain(literal);
    }
    expect(repo).toContain('return `${DECK_META_PREFIX}${u}:${slug}`;');
    expect(repo).toContain('session?.userSub ??');
    // The deck file's path in this launch's container (currentDeckFileUri).
    expect(repo).toContain('const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;');
    expect(repo).toContain('return `${base}devcards-decks-v2/${u}/`;');
    expect(repo).toContain("return slug.replace(/[^a-zA-Z0-9._-]+/g, '_');");
    expect(repo).toContain('return `${getDeckDirForUser(userKey)}${slugToFileName(slug)}.json`;');

    expect(mirror).toContain("'devcards:content:deckmeta:v2:'");
    expect(mirror).toContain(".replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)");
    expect(mirror).toContain('const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;');
    expect(mirror).toContain("devcards-decks-v2/${sanitizeUserKey(userKey)}/${slug.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json");
    expect(mirror).toContain('session?.userSub ??');
  });

  it('cardSource reads through the shared reader instead of keeping a second copy of the rules', () => {
    const cardSource = readFileSync(resolve(__dirname, '../../src/content/cardSource.ts'), 'utf8');
    expect(cardSource).toContain("from './installedDeckIndex'");
    expect(cardSource).not.toContain('devcards:content:deckmeta');
    expect(cardSource).not.toContain('readAsStringAsync');
  });
});

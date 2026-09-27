import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * K03 — cardSource.ts mirrors private rules of the frozen deck repository
 * (meta key prefix, deck folder, user-key sanitising) instead of importing
 * them. If the repository ever changes one of them, this fails loudly.
 */
describe('cardSource contract with deckRepository', () => {
  it('the frozen deck repository still uses the meta key, folder and user-key rule cardSource mirrors', () => {
    const repo = readFileSync(resolve(__dirname, '../../src/content/deckRepository.ts'), 'utf8');
    const mirror = readFileSync(resolve(__dirname, '../../src/content/cardSource.ts'), 'utf8');

    for (const literal of [
      "'devcards:content:deckmeta:v2:'",
      'devcards-decks-v2/',
      ".replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)",
    ]) {
      expect(repo).toContain(literal);
    }
    expect(repo).toContain('return `${DECK_META_PREFIX}${u}:${slug}`;');
    expect(repo).toContain('session?.userSub ??');

    expect(mirror).toContain("'devcards:content:deckmeta:v2:'");
    expect(mirror).toContain(".replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)");
  });
});

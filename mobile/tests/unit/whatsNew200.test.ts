import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R24B R01: the 2.0.0 (24) App Store texts. Plain words (contract §1), only facts from contract §4 and both
// disclaimers of §2. The length limits are the ones asc-release.cjs enforces.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(HERE, '../../scripts/release');
const read = (f: string) => fs.readFileSync(path.join(RELEASE_DIR, f), 'utf8').trim();
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JARGON = /\b(pulls?|pity|gacha|readiness)\b/i;
const NOT_OFFICIAL = 'Not official exam material and not an exam simulator.';
const TRADEMARKS =
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. .NET and C# are trademarks of Microsoft Corporation. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon, Anthropic or Microsoft.';
// Contract §4 "Never" list plus the old offline headline and the old "checked by me" claim.
const NEVER = /readiness|pass probability|exam simulator(?! *\.)|offline, no account needed|no account needed|thousands of cards|android|checked by me|verified by|%/i;

describe('2.0.0 store texts', () => {
  it.each([
    ['description-2.0.0.txt', 4000],
    ['keywords-2.0.0.txt', 100],
    ['promo-2.0.0.txt', 170],
    ['subtitle-2.0.0.txt', 30],
    ['review-notes-2.0.0.txt', 4000],
    ['whats-new-2.0.0.txt', 4000],
  ] as const)('%s is non-empty, within %i characters and has no email address', (file, limit) => {
    const text = read(file);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(limit);
    expect(text).not.toMatch(EMAIL);
  });

  it('the description and the promo text use plain words only', () => {
    for (const file of ['description-2.0.0.txt', 'promo-2.0.0.txt']) {
      expect(read(file), file).not.toMatch(JARGON);
    }
    const promo = read('promo-2.0.0.txt');
    expect(promo).not.toMatch(/\b(pull|rip|dupe)/i);
  });

  it('the description has the five sections, the disclaimers and no claim from the never list', () => {
    const text = read('description-2.0.0.txt');
    for (const heading of ["WHAT'S INSIDE", 'HOW DRAWS WORK', 'HOW STUDY WORKS', 'OFFLINE AND ACCOUNT', 'FROM ONE DEVELOPER']) {
      expect(text).toContain(`\n${heading}\n`);
    }
    expect(text).toContain(NOT_OFFICIAL);
    expect(text).toContain(TRADEMARKS);
    expect(text).not.toMatch(NEVER);
    // The body (everything before the Premium block) leaves room for Premium, links and disclaimers.
    expect(text.indexOf('PREMIUM SUBSCRIPTION')).toBeLessThanOrEqual(3150);
  });

  it('the description states the 2.0.0 facts', () => {
    const text = read('description-2.0.0.txt');
    for (const fact of [
      '.NET & C# Interview',
      '217 cards',
      '.NET 8 / C# 12',
      'Microsoft Learn',
      '371 cards',
      'SAA-C03',
      '441 cards',
      '3 draws',
      'Never a duplicate',
      'never sold',
      'Open 1 or Open 10',
      'Forgot',
      'Remembered',
      'Show options',
      'FSRS',
      'Mistake Book',
      'Progress by domain',
      'first lesson works with no connection',
      'Report a card',
    ]) {
      expect(text, fact).toContain(fact);
    }
  });

  it('copies the Premium block and the Terms/Privacy lines verbatim from 1.9.0', () => {
    const d9 = read('description-1.9.0.txt');
    const d2 = read('description-2.0.0.txt');
    const block = d9.slice(d9.indexOf('PREMIUM SUBSCRIPTION'), d9.indexOf('\n\nAWS is a trademark'));
    expect(block).toContain('Privacy Policy: ');
    expect(d2).toContain(block);
  });

  it('keywords are comma-separated without spaces, carry fsrs and flashcards, and no gacha or trademark', () => {
    const text = read('keywords-2.0.0.txt');
    expect(text).not.toMatch(/\s/);
    const words = text.split(',');
    expect(words.every((w) => w.length > 0)).toBe(true);
    expect(words).toEqual(expect.arrayContaining(['fsrs', 'flashcards']));
    expect(text).not.toMatch(/gacha|aws|claude|microsoft|anthropic/i);
  });

  it('the subtitle fits interview and exam decks', () => {
    const text = read('subtitle-2.0.0.txt');
    expect(text).toMatch(/interview/i);
    expect(text).toMatch(/exam/i);
  });

  it("What's New names the 2.0.0 changes in plain words and calls only the usage counts anonymous", () => {
    const text = read('whats-new-2.0.0.txt');
    expect(text).not.toMatch(JARGON);
    for (const fact of ['.NET 8 / C# 12', 'multiple-choice', 'first lesson', 'offline', 'Progress by domain', 'FSRS', 'Settings › Privacy']) {
      expect(text, fact).toContain(fact);
    }
    expect(text).toMatch(/turn (it|this|them) off/i);
    // Crash and diagnostic data are declared as linked in App Privacy (see whatsNew190.test.ts): the only
    // "anonymous" in the text is the usage-count setting.
    expect(text.replace(/anonymous usage counts/gi, '')).not.toMatch(/anonymous/i);
    expect(text).not.toMatch(/crash/i);
  });

  it('the review notes drop the free pulls, say the first launch works offline and give both Report paths', () => {
    const r2 = read('review-notes-2.0.0.txt');
    const r9 = read('review-notes-1.9.0.txt');
    expect(r2).not.toMatch(/\bpulls?\b/i);
    expect(r2).toContain('3 draws');
    expect(r2).toMatch(/first launch works offline/i);
    expect(r2).toContain('Report a problem');
    expect(r2).toMatch(/recall check/i);
    // The demo-account wording stays byte-identical to 1.9.0.
    const DEMO = 'The demo account above is needed only for cloud sync and to buy or restore Premium.';
    expect(r9).toContain(DEMO);
    expect(r2).toContain(DEMO);
    expect(r2).toContain('sign in with the demo account');
  });
});

describe('release README', () => {
  it('the typical run is 2.0.0 (24) with the 2.0.0 text files', () => {
    const readme = fs.readFileSync(path.join(RELEASE_DIR, 'README.md'), 'utf8');
    expect(readme).toContain('Typical run for 2.0.0 (24)');
    expect(readme).toContain('--version 2.0.0 --build 24');
    for (const f of ['whats-new', 'description', 'keywords', 'promo', 'subtitle', 'review-notes']) {
      expect(readme).toContain(`scripts/release/${f}-2.0.0.txt`);
    }
    expect(readme).not.toContain('--version 1.9.0');
  });
});

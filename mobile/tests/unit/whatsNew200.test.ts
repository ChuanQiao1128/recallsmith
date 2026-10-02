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
// Contract §1 words a learner must not see (plus gacha), checked on all six 2.0.0 files.
const JARGON = /\b(pulls?|pity|gacha|readiness|wallet|reserve|runs?|boss|elite|full clear|ceremony|route|momentum)\b/i;
const NOT_OFFICIAL = 'Not official exam material and not an exam simulator.';
const TRADEMARKS =
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. .NET and C# are trademarks of Microsoft Corporation. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon, Anthropic or Microsoft.';
// Contract §4 "Never" list plus the old offline headline and the old "checked by me" claim. The §2
// disclaimer is the only allowed "exam simulator": withoutDisclaimer removes exactly that sentence first.
const NEVER = /readiness|pass probability|exam simulator|offline, no account needed|no account needed|thousands of cards|android|checked by me|verified by|%/i;
const withoutDisclaimer = (text: string) => text.split(NOT_OFFICIAL).join('');
const ALL_FILES = [
  'description-2.0.0.txt',
  'keywords-2.0.0.txt',
  'promo-2.0.0.txt',
  'subtitle-2.0.0.txt',
  'review-notes-2.0.0.txt',
  'whats-new-2.0.0.txt',
] as const;

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

  it.each(ALL_FILES)('%s uses plain words only and has no claim from the never list', (file) => {
    const text = read(file);
    expect(text, file).not.toMatch(JARGON);
    expect(withoutDisclaimer(text), file).not.toMatch(NEVER);
  });

  it('the guards catch a claim or a jargon word that ends a sentence', () => {
    for (const bad of ['DeveloperCards 2.0 works like a real exam simulator.', 'Use DeveloperCards as your exam simulator.']) {
      expect(withoutDisclaimer(`${bad}\n${NOT_OFFICIAL}`)).toMatch(NEVER);
    }
    expect(withoutDisclaimer(NOT_OFFICIAL)).not.toMatch(NEVER);
    expect('Thousands of cards, also on Android.').toMatch(NEVER);
    for (const bad of ['Your draw wallet holds 60 draws.', 'Draws in reserve.', 'Finish the run.', 'Beat the boss.', 'A full clear.']) {
      expect(bad).toMatch(JARGON);
    }
  });

  it('the promo text has no pull, rip or dupe and says draws never repeat', () => {
    const promo = read('promo-2.0.0.txt');
    expect(promo).not.toMatch(/\b(pull|rip|dupe)/i);
    expect(promo).toContain('No repeat draws, never sold.');
    expect(promo).not.toMatch(/duplicate/i);
  });

  it('the description has the five sections, the disclaimers and no claim from the never list', () => {
    const text = read('description-2.0.0.txt');
    for (const heading of ["WHAT'S INSIDE", 'HOW DRAWS WORK', 'HOW STUDY WORKS', 'OFFLINE AND ACCOUNT', 'FROM ONE DEVELOPER']) {
      expect(text).toContain(`\n${heading}\n`);
    }
    expect(text).toContain(NOT_OFFICIAL);
    expect(text).toContain(TRADEMARKS);
    expect(withoutDisclaimer(text)).not.toMatch(NEVER);
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
      'No repeat draws: a card you have drawn never comes up again.',
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
      'If a card looks wrong, sign in and tap Report a problem under its answer.',
    ]) {
      expect(text, fact).toContain(fact);
    }
    expect(text.split('\n')[0]).toContain(
      'DeveloperCards 2.0 turns the prep into a card collection: studying earns most of the draws that fill it.',
    );
    expect(text).not.toMatch(/duplicate|spot-checked/i);
  });

  it('the starter pack reads as 3 draws in total, not 3 + 3 (starterGate / DECK_BOOTSTRAP_GRANT)', () => {
    const text = read('description-2.0.0.txt');
    expect(text).toContain('The lesson ends with 3 draws for that pack.');
    expect(text).toContain('Every other pack gives 3 draws the first time you open it.');
    expect(text).not.toContain('Every pack gives');
    expect(text.match(/3 draws/g)).toHaveLength(2);
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
    expect(text).toContain('Rebuilt .NET & C# Interview deck (it replaces the old C# / .NET deck): ');
    expect(text).not.toContain('New .NET & C# Interview deck');
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
    // 2.0.0 adds card reports to what the demo account is for; 1.9.0 keeps its own sentence.
    expect(r9).toContain('The demo account above is needed only for cloud sync and to buy or restore Premium.');
    expect(r2).toContain(
      'The demo account above is needed only for cloud sync, for reporting a problem with a card (and Me > My reports), and to buy or restore Premium.',
    );
    expect(r2).toContain('sign in with the demo account');
  });

  it('the review notes describe the rebuilt deck, the report path, Sentry and the usage counts as shipped', () => {
    const r2 = read('review-notes-2.0.0.txt');
    for (const fact of [
      '2.0.0 comes with the rebuilt .NET & C# Interview deck (it replaces the earlier C# / .NET deck and is served from our content server), and the first cards of each deck now ship inside the app',
      'open a card you own in the Library, tap Show answer, and use "Report a problem" under the answer, or start a review and tap "Report" under the card on a recall check after you reveal the answer',
      'They contain no account data or email address; native crash reports carry a random ID that Sentry creates for the app install.',
      'lets the app send a one-time record of early milestones (finishing setup, opening a first pack, starting or finishing sign-up, opening the app again a day or a week later), each with its dates, the deck, the platform and the app version. No account, email address, device or install ID is sent, and turning the switch off stops sending.',
    ]) {
      expect(r2, fact).toContain(fact);
    }
    expect(r2).not.toContain('2.0.0 adds the .NET & C# Interview deck');
    expect(r2).not.toMatch(/email address or other identifiers/);
    expect(r2).not.toMatch(/at the end of the card's page/);
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

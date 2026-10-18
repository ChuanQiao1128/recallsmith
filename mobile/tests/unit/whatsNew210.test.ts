import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 2.1.0 (25) App Store texts. Same rules as 2.0.0 (whatsNew200.test.ts): plain words, only facts the app
// ships, both disclaimers, and the limits asc-release.cjs enforces. The .NET & C# deck is gone from the app
// (hiddenDecks.ts), so it and Microsoft leave the facts and the trademark line.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(HERE, '../../scripts/release');
const read = (f: string) => fs.readFileSync(path.join(RELEASE_DIR, f), 'utf8').trim();
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JARGON = /\b(pulls?|pity|gacha|readiness|wallet|reserve|runs?|boss|elite|full clear|ceremony|route|momentum)\b/i;
const NOT_OFFICIAL = 'Not official exam material and not an exam simulator.';
const TRADEMARKS =
  'AWS is a trademark of Amazon.com, Inc. Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Amazon or Anthropic.';
const NEVER = /readiness|pass probability|exam simulator|offline, no account needed|no account needed|thousands of cards|android|checked by me|verified by|%/i;
const withoutDisclaimer = (text: string) => text.split(NOT_OFFICIAL).join('');
const ALL_FILES = [
  'description-2.1.0.txt',
  'keywords-2.1.0.txt',
  'promo-2.1.0.txt',
  'subtitle-2.1.0.txt',
  'review-notes-2.1.0.txt',
  'whats-new-2.1.0.txt',
] as const;

describe('2.1.0 store texts', () => {
  it.each([
    ['description-2.1.0.txt', 4000],
    ['keywords-2.1.0.txt', 100],
    ['promo-2.1.0.txt', 170],
    ['subtitle-2.1.0.txt', 30],
    ['review-notes-2.1.0.txt', 4000],
    ['whats-new-2.1.0.txt', 4000],
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

  it.each(ALL_FILES.filter((f) => f !== 'review-notes-2.1.0.txt'))('%s no longer offers the retired .NET & C# deck', (file) => {
    const text = read(file);
    if (file === 'whats-new-2.1.0.txt') {
      expect(text).toContain('The .NET & C# Interview deck is no longer in the app.');
      return;
    }
    expect(text, file).not.toMatch(/\.NET|C#|csharp|dotnet|interview|Microsoft/i);
  });

  it('the description has the five sections, the company byline, the disclaimers and the links', () => {
    const text = read('description-2.1.0.txt');
    for (const heading of ["WHAT'S INSIDE", 'HOW DRAWS WORK', 'HOW STUDY WORKS', 'OFFLINE AND ACCOUNT', 'FROM TIME AWAKE', 'LINKS']) {
      expect(text).toContain(`\n${heading}\n`);
    }
    expect(text).toContain('DeveloperCards is made by Time Awake in Auckland.');
    expect(text).not.toMatch(/one developer|indie project/i);
    expect(text).toContain(NOT_OFFICIAL);
    expect(text).toContain(TRADEMARKS);
    expect(text).not.toMatch(/Premium|subscription/i);
  });

  it('the description states the 2.1.0 facts', () => {
    const text = read('description-2.1.0.txt');
    for (const fact of [
      'AWS Architect Basics: 41 short foundation cards in Chinese',
      '371 cards in English for the SAA-C03, including 165 multiple-choice cards',
      '465 cards in English across all 8 exam domains, including 149 multiple-choice cards',
      'Each pack gets a one-time grant of 5 draws',
      'Open up to 5 packs at once, or Open 1.',
      'Each pack saves up to 60 draws, plus 5 extra draws waiting.',
      'After 10 Commons in a row, a rare card is guaranteed',
      'No repeat draws: a card you have drawn never comes up again.',
      'Draws are earned, never sold.',
      'Swipe left or right on the Home cover to switch packs.',
      'tap Show answer, read it, then Got it',
      'Forgot and Remembered',
      'Show options',
      'FSRS',
      'Mistake Book',
      'Progress by domain',
      'If a card looks wrong, sign in and tap Report a problem under its answer.',
    ]) {
      expect(text, fact).toContain(fact);
    }
    // The bundled starter packs cover the AWS Associate Architect and Claude decks only (starter/index.ts).
    expect(text).toContain('The first cards of the AWS Associate Architect and Claude decks ship inside the app');
    expect(text).not.toMatch(/\b3 draws\b|Open 10/);
  });

  it('copies the Terms/Privacy lines verbatim from 2.0.0', () => {
    const d2 = read('description-2.0.0.txt');
    const d21 = read('description-2.1.0.txt');
    for (const line of d2.split('\n').filter((l) => l.startsWith('Terms of Use (EULA): ') || l.startsWith('Privacy Policy: '))) {
      expect(d21).toContain(line);
    }
  });

  it('keywords are comma-separated without spaces, carry fsrs and flashcards, and no gacha or trademark', () => {
    const text = read('keywords-2.1.0.txt');
    expect(text).not.toMatch(/\s/);
    const words = text.split(',');
    expect(words.every((w) => w.length > 0)).toBe(true);
    expect(words).toEqual(expect.arrayContaining(['fsrs', 'flashcards']));
    expect(text).not.toMatch(/gacha|aws|claude|microsoft|anthropic|csharp|dotnet/i);
  });

  it('the promo text keeps the no-repeat promise without pull, rip or dupe', () => {
    const promo = read('promo-2.1.0.txt');
    expect(promo).toContain('No repeat draws, never sold.');
    expect(promo).not.toMatch(/\b(pull|rip|dupe)|duplicate/i);
  });

  it("What's New names the 2.1.0 changes and does not advertise Chinese cards no deck ships yet", () => {
    const text = read('whats-new-2.1.0.txt');
    for (const fact of ['Swipe left or right on the Home cover', 'AWS Architect Basics', 'Open up to 5 packs at once', '5 draws']) {
      expect(text, fact).toContain(fact);
    }
    expect(text).not.toMatch(/translation|Card language|中文/i);
  });

  it('the review notes explain the Card language setting has no visible effect yet and name the delete path', () => {
    const notes = read('review-notes-2.1.0.txt');
    expect(notes).toContain('Settings > Study > Card language');
    expect(notes).toContain('no deck ships a translation yet');
    expect(notes).toContain('Me > Settings > Account > Delete account');
    expect(notes).toContain('Report a problem');
    expect(notes).not.toMatch(/\b3 draws\b/);
  });
});

describe('release README', () => {
  it('the typical run is 2.1.0 (25) with the 2.1.0 text files', () => {
    const readme = fs.readFileSync(path.join(RELEASE_DIR, 'README.md'), 'utf8');
    expect(readme).toContain('Typical run for 2.1.0 (25)');
    expect(readme).toContain('--version 2.1.0 --build 25');
    for (const f of ['whats-new', 'description', 'keywords', 'promo', 'subtitle', 'review-notes']) {
      expect(readme).toContain(`scripts/release/${f}-2.1.0.txt`);
    }
    expect(readme).not.toContain('--version 2.0.0');
  });
});

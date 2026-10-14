// 2026-10-14 three decks: the Help FAQ names the decks the app shows, in the app's order (AWS
// fundamentals, SAA-C03, Claude), never the hidden C# deck, and promises an offline first lesson
// only for the decks that ship starter cards.
import { describe, expect, it } from 'vitest';

import { FAQ_DISCLAIMER, FAQ_LIST } from '../../src/content/faq';
import { DECK_ORDER, HIDDEN_DECK_SLUGS } from '../../src/content/hiddenDecks';
import { STARTER_PACKS } from '../../src/content/starter';
import { GOAL_CHOICES } from '../../src/features/gacha/audience/goalChoices';

// How each shown deck is named in the two answers that list decks.
const STUDY_NAME: Record<string, string> = {
  'aws-saa-fundamentals': 'AWS fundamentals',
  'aws-saa-c03': 'AWS Associate Architect',
  'claude-ccdv-f': 'Claude Developer Foundations',
};
const OFFLINE_NAME: Record<string, string> = {
  'aws-saa-fundamentals': 'AWS fundamentals',
  'aws-saa-c03': 'SAA-C03',
  'claude-ccdv-f': 'Claude',
};

function answer(q: string): string {
  const entry = FAQ_LIST.find((e) => e.q === q);
  expect(entry, q).toBeDefined();
  return entry!.a;
}

describe('Help FAQ, 2026-10-14 three decks', () => {
  it('never names the hidden C# deck, its sources or its trademark owner', () => {
    expect(HIDDEN_DECK_SLUGS).toContain('csharp-basics');
    const copy = [...FAQ_LIST.flatMap((e) => [e.q, e.a]), ...FAQ_DISCLAIMER].join('\n');
    expect(copy).not.toMatch(/C#|\.NET|csharp|Microsoft/i);
  });

  it('"What do I study?" names the three decks in the app order: fundamentals, SAA-C03, Claude', () => {
    expect(GOAL_CHOICES.map((c) => c.deckSlug)).toEqual([...DECK_ORDER]);
    const a = answer('What do I study?');
    expect(a.startsWith('Three free decks:')).toBe(true);
    const positions = DECK_ORDER.map((slug) => a.indexOf(STUDY_NAME[slug]));
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(a).toContain('AWS fundamentals (the basics behind SAA-C03, in Chinese)');
  });

  it('promises an offline first lesson only for the decks that ship starter cards', () => {
    const a = answer('Does it work offline? Do I need an account?');
    const [offlineClause] = a.split(';');
    const withPack = GOAL_CHOICES.filter((c) => c.deckSlug in STARTER_PACKS).map((c) => c.deckSlug);
    const withoutPack = GOAL_CHOICES.filter((c) => !(c.deckSlug in STARTER_PACKS)).map((c) => c.deckSlug);
    // Today: SAA-C03 and Claude ship a pack, fundamentals does not.
    expect(withPack).toEqual(['aws-saa-c03', 'claude-ccdv-f']);
    expect(withoutPack).toEqual(['aws-saa-fundamentals']);

    expect(offlineClause).toContain('works offline');
    for (const slug of withPack) expect(offlineClause).toContain(OFFLINE_NAME[slug]);
    for (const slug of withoutPack) {
      expect(offlineClause).not.toContain(OFFLINE_NAME[slug]);
      expect(a).toContain(`${OFFLINE_NAME[slug]} downloads the first time your phone is online`);
    }
    // A deck without a pack makes "each deck" untrue.
    expect(a).not.toMatch(/each deck|every deck/i);
  });
});

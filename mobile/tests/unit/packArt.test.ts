import { describe, expect, it } from 'vitest';

import {
  cardBackImageForSlug,
  cardFrameForRarity,
  DEFAULT_CARD_BACK,
  packImageForSlug,
  packPaletteFromSlug,
} from '../../src/theme/packArt';

describe('packArt — cardBackImageForSlug', () => {
  it('returns a defined image for the canonical csharp slug', () => {
    expect(cardBackImageForSlug('csharp')).toBeDefined();
  });

  it('resolves C# variants (cs-dotnet, c-sharp, c#) to the csharp card back', () => {
    const canonical = cardBackImageForSlug('csharp');
    expect(cardBackImageForSlug('cs-dotnet')).toBe(canonical);
    expect(cardBackImageForSlug('c-sharp')).toBe(canonical);
    expect(cardBackImageForSlug('c#')).toBe(canonical);
    // Case-insensitive too — backend may upper-case the slug.
    expect(cardBackImageForSlug('CSHARP')).toBe(canonical);
  });

  it('returns undefined for slugs that have no registered card back', () => {
    // Unregistered slugs fall through to the procedural card back.
    expect(cardBackImageForSlug('totally-unknown-deck')).toBeUndefined();
  });

  it('returns undefined for null / empty / whitespace slug', () => {
    expect(cardBackImageForSlug(null)).toBeUndefined();
    expect(cardBackImageForSlug(undefined)).toBeUndefined();
    expect(cardBackImageForSlug('')).toBeUndefined();
    expect(cardBackImageForSlug('   ')).toBeUndefined();
  });

  // Sanity check on the existing pack image helper — ensures the test file
  // doesn't drift if packArt.ts is reorganized later.
  it('packImageForSlug still resolves csharp to a defined image', () => {
    expect(packImageForSlug('csharp')).toBeDefined();
  });
});

describe('packArt — aws and stage assets', () => {
  it('routes aws-saa-c03 to the aws cover, not the cloud cover', () => {
    expect(packImageForSlug('aws-saa-c03')).toBe(packImageForSlug('aws'));
    expect(packImageForSlug('aws-saa-c03')).not.toBe(packImageForSlug('cloud'));
    expect(packImageForSlug('AWS-SAA-C03')).toBe(packImageForSlug('aws'));
    expect(packImageForSlug('AWS-SAA-C03')).not.toBe(packImageForSlug('cloud'));
  });

  it('gives aws-saa-c03 the aws card back and palette', () => {
    expect(cardBackImageForSlug('aws-saa-c03')).toBe(cardBackImageForSlug('aws'));
    expect(cardBackImageForSlug('aws-saa-c03')).toBeDefined();
    expect(packPaletteFromSlug('aws-saa-c03')).toEqual(packPaletteFromSlug('aws'));
    expect(packPaletteFromSlug('aws-saa-c03')).not.toEqual(packPaletteFromSlug('cloud'));
  });

  it('registers a card back for every shipped deck and a separate default', () => {
    expect(cardBackImageForSlug('aws-basics')).toBeDefined();
    expect(cardBackImageForSlug('ai')).toBeDefined();
    expect(cardBackImageForSlug('cloud')).toBeDefined();
    expect(cardBackImageForSlug('premium-deck')).toBeDefined();
    expect(DEFAULT_CARD_BACK).toBeDefined();
    expect(cardBackImageForSlug('default')).toBeUndefined();
  });

  it('exposes a frame for every rarity', () => {
    const com = cardFrameForRarity('COM');
    const rar = cardFrameForRarity('RAR');
    const leg = cardFrameForRarity('LEG');
    expect(com).toBeDefined();
    expect(rar).toBeDefined();
    expect(leg).toBeDefined();
    expect(com).not.toBe(rar);
    expect(rar).not.toBe(leg);
    expect(com).not.toBe(leg);
  });
});

describe('packArt — claude deck (claude-ccdv-f)', () => {
  it('routes claude-ccdv-f to its own cover, not the default Wild Pack', () => {
    const claude = packImageForSlug('claude');
    expect(claude).toBeDefined();
    expect(packImageForSlug('claude-ccdv-f')).toBe(claude);
    expect(packImageForSlug('CLAUDE-CCDV-F')).toBe(claude);
    expect(claude).not.toBe(packImageForSlug('default'));
    expect(claude).not.toBe(packImageForSlug('aws'));
    expect(claude).not.toBe(packImageForSlug('cloud'));
    expect(claude).not.toBe(packImageForSlug('csharp'));
  });

  it('gives claude-ccdv-f the claude card back and the coral/plum palette', () => {
    expect(cardBackImageForSlug('claude-ccdv-f')).toBeDefined();
    expect(cardBackImageForSlug('claude-ccdv-f')).toBe(cardBackImageForSlug('claude'));
    const palette = packPaletteFromSlug('claude-ccdv-f');
    expect(palette).toEqual(packPaletteFromSlug('claude'));
    // Coral glow stop sampled from claude.png — proves index 5 is wired, not a
    // hash-fallback collision with one of the older palettes.
    expect(palette.cover[2]).toBe('#F0864A');
    for (const other of ['csharp', 'aws', 'aws-basics', 'cloud', 'ai', 'premium-deck', 'default']) {
      expect(palette).not.toEqual(packPaletteFromSlug(other));
    }
  });

  it('does not let the claude rule swallow cloud / cs- slugs', () => {
    expect(packImageForSlug('cloud')).toBe(packImageForSlug('cloud-basics'));
    expect(packImageForSlug('cloud')).not.toBe(packImageForSlug('claude'));
    expect(packPaletteFromSlug('cloud-basics')).toEqual(packPaletteFromSlug('cloud'));
    expect(packImageForSlug('cs-dotnet')).toBe(packImageForSlug('csharp'));
  });

  it('keeps the PNG and the palette in agreement for every fuzzy slug', () => {
    // One canonicalizer feeds both lookups; this is the drift guard that was
    // missing when aws-saa-c03 got the aws PNG but the cloud palette.
    const pairs: Array<[string, string]> = [
      ['claude-ccdv-f', 'claude'],
      ['aws-saa-c03', 'aws'],
      ['aws-saa-fundamentals', 'aws-basics'],
      ['AWS-SAA-FUNDAMENTALS', 'aws-basics'],
      ['cs-dotnet', 'csharp'],
      ['c#', 'csharp'],
      ['ai-fundamentals', 'ai'],
      ['gcp-ace', 'cloud'],
    ];
    for (const [fuzzy, canonical] of pairs) {
      expect(packImageForSlug(fuzzy)).toBe(packImageForSlug(canonical));
      expect(packPaletteFromSlug(fuzzy)).toEqual(packPaletteFromSlug(canonical));
      expect(cardBackImageForSlug(fuzzy)).toBe(cardBackImageForSlug(canonical));
    }
  });
});

// 2026-10-18 AWS Basics cover: aws-saa-fundamentals is shown as "AWS Basics" and
// sits next to aws-saa-c03 in the Home carousel, so it must not share the SAA-C03 art.
describe('packArt — AWS Basics deck (aws-saa-fundamentals)', () => {
  it('routes aws-saa-fundamentals (any case) to its own cover', () => {
    const basics = packImageForSlug('aws-basics');
    expect(basics).toBeDefined();
    expect(packImageForSlug('aws-saa-fundamentals')).toBe(basics);
    expect(packImageForSlug('AWS-SAA-FUNDAMENTALS')).toBe(basics);
    expect(packImageForSlug('  Aws-Saa-Fundamentals  ')).toBe(basics);
    for (const other of ['aws', 'aws-saa-c03', 'default', 'cloud', 'csharp', 'claude', 'ai']) {
      expect(basics).not.toBe(packImageForSlug(other));
    }
  });

  it('gives aws-saa-fundamentals its own card back', () => {
    const back = cardBackImageForSlug('aws-basics');
    expect(back).toBeDefined();
    expect(cardBackImageForSlug('aws-saa-fundamentals')).toBe(back);
    expect(cardBackImageForSlug('AWS-SAA-FUNDAMENTALS')).toBe(back);
    expect(back).not.toBe(cardBackImageForSlug('aws'));
    expect(back).not.toBe(cardBackImageForSlug('cloud'));
    expect(back).not.toBe(DEFAULT_CARD_BACK);
  });

  it('gives aws-saa-fundamentals the blush-pink palette sampled from its cover', () => {
    const palette = packPaletteFromSlug('aws-saa-fundamentals');
    expect(palette).toEqual(packPaletteFromSlug('aws-basics'));
    expect(packPaletteFromSlug('AWS-SAA-FUNDAMENTALS')).toEqual(palette);
    // Blush glow stop sampled from aws-basics.png — proves index 6 is wired, not a
    // hash-fallback collision with one of the older palettes.
    expect(palette.cover[2]).toBe('#E5B3AB');
    for (const other of ['aws', 'aws-saa-c03', 'default', 'cloud', 'csharp', 'claude', 'ai', 'premium-deck']) {
      expect(palette).not.toEqual(packPaletteFromSlug(other));
    }
  });

  it('leaves aws-saa-c03 on the aws art and ai-fundamentals on ai', () => {
    expect(packImageForSlug('aws-saa-c03')).toBe(packImageForSlug('aws'));
    expect(cardBackImageForSlug('aws-saa-c03')).toBe(cardBackImageForSlug('aws'));
    expect(packPaletteFromSlug('aws-saa-c03')).toEqual(packPaletteFromSlug('aws'));
    // The rule is exact: other aws-* decks keep folding onto aws.
    expect(packImageForSlug('aws-dva-c02')).toBe(packImageForSlug('aws'));
    expect(packImageForSlug('ai-fundamentals')).toBe(packImageForSlug('ai'));
    expect(packPaletteFromSlug('ai-fundamentals')).toEqual(packPaletteFromSlug('ai'));
    expect(cardBackImageForSlug('ai-fundamentals')).toBe(cardBackImageForSlug('ai'));
  });
});

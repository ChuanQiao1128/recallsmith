import { describe, expect, it } from 'vitest';

import { cardBackImageForSlug, packImageForSlug } from '../../src/theme/packArt';

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
    // ai/cloud have pack PNGs but (deliberately) no back PNG yet — fall through to procedural.
    expect(cardBackImageForSlug('ai')).toBeUndefined();
    expect(cardBackImageForSlug('cloud')).toBeUndefined();
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

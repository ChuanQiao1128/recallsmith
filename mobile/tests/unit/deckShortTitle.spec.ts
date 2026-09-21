import { describe, expect, it } from 'vitest';
import { deckShortTitle } from '../../src/content/deckShortTitle';

describe('deckShortTitle', () => {
  it('maps the three live decks to the names that fit a 60–72pt tile', () => {
    expect(deckShortTitle('aws-saa-c03', 'AWS Associate Architect')).toBe('AWS SAA-C03');
    expect(deckShortTitle('claude-ccdv-f', 'Claude Developer Foundations (CCDV-F)')).toBe('Claude CCDV-F');
    expect(deckShortTitle('csharp-basics', 'C# / .NET')).toBe('C# / .NET');
  });

  it('is keyed by the exact slug, case-insensitively, and never by the pack-art family', () => {
    expect(deckShortTitle('AWS-SAA-C03', 'AWS Associate Architect')).toBe('AWS SAA-C03');
    // A second Claude deck shares the cover family but not the name.
    expect(deckShortTitle('claude-ccdv-a', 'Claude Developer Advanced')).toBe('Claude Developer Advanced');
    expect(deckShortTitle('aws', 'AWS Core')).toBe('AWS Core');
  });

  it('falls back to the title, then to the slug, for anything unknown', () => {
    expect(deckShortTitle('js-core-basics', 'JavaScript Core Basics')).toBe('JavaScript Core Basics');
    expect(deckShortTitle('js-core-basics', '')).toBe('js-core-basics');
    expect(deckShortTitle(null, 'Your first pack')).toBe('Your first pack');
    expect(deckShortTitle(undefined, undefined)).toBe('');
  });
});

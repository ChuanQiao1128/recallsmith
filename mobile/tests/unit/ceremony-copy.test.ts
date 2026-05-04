import { describe, expect, it } from 'vitest';
import { CEREMONY_COPY } from '../../src/features/gacha/draw/ceremonyCopy';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

describe('ceremonyCopy', () => {
  it('keeps ceremony copy plain and free of implementation jargon', () => {
    const textBlob = collectStrings(CEREMONY_COPY).join('\n');

    expect(textBlob).not.toMatch(/[:·]/);
    expect(textBlob).not.toMatch(/\b(axis|breach|drift|resonance|core|armed|unlocked)\b/i);
    expect(textBlob).not.toMatch(/Glyph field|recall\.draw|Tap to reveal/i);
  });
});

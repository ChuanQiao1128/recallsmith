import { describe, expect, it } from 'vitest';
import { CEREMONY_COPY, CEREMONY_COPY_V10, CEREMONY_COPY_V9 } from '../../src/features/gacha/draw/ceremonyCopy';

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

  it('keeps the swipe affordance on the phase copy and carries no table-state chip', () => {
    // The visible SwipeHint reuses the phase title so the a11y announcement and what a
    // sighted player reads are the same words.
    expect(CEREMONY_COPY_V9.swipe.title).toBe('Swipe to open');
    // "Not flipped" ×N on the result screen was ceremony-table state leaking into copy;
    // the V10 table no longer offers it, so nothing can render it.
    expect('unrevealedChip' in CEREMONY_COPY_V10).toBe(false);
    const v10Strings = Object.values(CEREMONY_COPY_V10).flatMap((v) =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: any[]) => string)(3, 10, 'Rare'))] : [],
    );
    expect(v10Strings.join('\n')).not.toMatch(/Not flipped|unflipped|unrevealed/i);
  });
});

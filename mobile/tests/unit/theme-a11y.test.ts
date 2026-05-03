import { describe, expect, it } from 'vitest';
import { colors } from '../../src/theme/colors';
import { spacing } from '../../src/theme/spacing';
import { typography } from '../../src/theme/typography';
import { a11y } from '../../src/theme/a11y';

describe('theme and a11y tokens', () => {
  it('exposes parchment and cosmic palettes', () => {
    expect(colors.parchmentBg).toBe('#FAF3E0');
    expect(colors.cosmicBgDeep).toBe('#070A1F');
    expect(colors.gold).toBe('#C8883A');
  });

  it('keeps baseline spacing and minimum touch targets consistent', () => {
    expect(spacing.screenPadding).toBeGreaterThanOrEqual(16);
    expect(typography.title1).toBeGreaterThan(typography.title2);
    expect(a11y.minTouch).toBeGreaterThanOrEqual(44);
  });
});

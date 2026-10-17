import { describe, expect, it } from 'vitest';

import { CEREMONY_STAGE_WIDTH, tableOverlayFrame } from '../../src/components/ceremony/tableOverlayFrame';
import { summaryGridLayout } from '../../src/features/gacha/draw/spotlightQueue';

// 2026-10-17 batch open: the five-card table and summary grid are wider than the 280-pt stage.
describe('ceremony table frame', () => {
  it('spans the window and is centred on the stage', () => {
    for (const windowWidth of [375, 390, 402, 430]) {
      const frame = tableOverlayFrame(windowWidth);
      expect(frame.width).toBe(windowWidth);
      // The stage is centred on the window, so the frame's left edge lands on the window's left edge.
      const stageLeft = (windowWidth - CEREMONY_STAGE_WIDTH) / 2;
      expect(stageLeft + frame.marginHorizontal).toBe(0);
    }
  });

  it('never shrinks below the stage', () => {
    expect(tableOverlayFrame(200)).toEqual({ width: CEREMONY_STAGE_WIDTH, marginHorizontal: 0 });
  });

  it('fits a five-column summary grid inside the frame on the narrowest supported phone', () => {
    const windowWidth = 375;
    const frame = tableOverlayFrame(windowWidth);
    const grid = summaryGridLayout(5, windowWidth - 32);
    const gridWidth = grid.columns * grid.cellWidth + (grid.columns - 1) * grid.gap;
    expect(gridWidth).toBeLessThanOrEqual(frame.width - 32);
    expect(gridWidth).toBeGreaterThan(CEREMONY_STAGE_WIDTH); // why the frame exists
  });
});

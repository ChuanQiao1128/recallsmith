// MCORE-16 — the Library grid now supplies getItemLayout instead of guessing a
// row height, and converts an item index into a row index before scrolling a
// multi-column list. These are the two pure helpers behind that.
import { describe, it, expect } from 'vitest';

import {
  getLibraryItemLayout,
  libraryRowHeight,
  libraryRowIndexForItem,
  LIBRARY_TILE_HEIGHT,
} from '../../src/features/gacha/library/libraryGridLayout';

describe('libraryGridLayout', () => {
  it('getLibraryItemLayout offsets rows by the list head offset', () => {
    const head = 200; // list padding + measured header
    const rowHeight = libraryRowHeight();
    expect(rowHeight).toBeGreaterThan(LIBRARY_TILE_HEIGHT);

    const row0 = getLibraryItemLayout(head, 0);
    expect(row0).toEqual({ length: rowHeight, offset: head, index: 0 });

    const row3 = getLibraryItemLayout(head, 3);
    expect(row3).toEqual({ length: rowHeight, offset: head + rowHeight * 3, index: 3 });
  });

  it('libraryRowIndexForItem maps an item index to its row', () => {
    // item 7 in a 3-column grid → row 2 (rows 0:[0,1,2] 1:[3,4,5] 2:[6,7,8]).
    expect(libraryRowIndexForItem(7, 3)).toBe(2);
    expect(libraryRowIndexForItem(0, 3)).toBe(0);
    expect(libraryRowIndexForItem(5, 2)).toBe(2);
    // numColumns 0 is treated as 1 so the row index equals the item index.
    expect(libraryRowIndexForItem(4, 0)).toBe(4);
  });
});

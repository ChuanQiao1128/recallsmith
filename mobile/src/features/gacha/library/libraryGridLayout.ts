import { spacing } from '../../../theme/spacing';

// Fixed tile height for the Library grid. Keeping it constant is what lets the
// list supply getItemLayout (no per-row measurement) and scroll to a freshly
// drawn card's row without guessing.
export const LIBRARY_TILE_HEIGHT = 154;

// The vertical gap between rows — the columnWrap marginBottom — and the list's
// top padding. Both feed the offset math in getItemLayout, so they live next to
// the height they measure against.
export const LIBRARY_ROW_GAP = spacing.xs;
export const LIBRARY_LIST_PADDING_TOP = spacing.screenPadding;

// Tile text is capped at this Dynamic Type multiplier so content stays inside
// the fixed tile height at the largest non-AX text size.
export const LIBRARY_TILE_MAX_FONT_SCALE = 1.3;

export function libraryRowHeight(): number {
  return LIBRARY_TILE_HEIGHT + LIBRARY_ROW_GAP;
}

/**
 * getItemLayout for a multi-column Library FlatList. `rowIndex` is a *row*
 * index (the FlatList counts rows when numColumns > 1), and `listHeadOffset` is
 * everything above the first row — the list's top padding plus the measured
 * header height.
 */
export function getLibraryItemLayout(
  listHeadOffset: number,
  rowIndex: number,
): { length: number; offset: number; index: number } {
  return {
    length: libraryRowHeight(),
    offset: listHeadOffset + libraryRowHeight() * rowIndex,
    index: rowIndex,
  };
}

/** Convert a flat item index into the grid row it lands on. */
export function libraryRowIndexForItem(itemIndex: number, numColumns: number): number {
  return Math.floor(itemIndex / Math.max(1, numColumns));
}

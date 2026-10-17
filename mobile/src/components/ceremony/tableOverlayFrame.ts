// 2026-10-17 batch open: geometry of the ceremony's card table. Pure, no imports.
//
// The ceremony stage (pack, spotlight) is CEREMONY_STAGE_WIDTH wide and centred on the window. A row of
// five cards and the five-column summary grid need more than that: inside the narrow stage the row
// overflowed off-centre and clipped the first card on a 402-pt phone. The table layer therefore spans
// the window, pulled back over the stage's side margins so it stays centred.

/** Width of the ceremony stage, in pt (ceremonyStyles.stage). */
export const CEREMONY_STAGE_WIDTH = 280;

/** The table layer's frame: the window's width (never less than the stage), centred on the stage. */
export function tableOverlayFrame(windowWidth: number): { width: number; marginHorizontal: number } {
  const width = Math.max(CEREMONY_STAGE_WIDTH, Math.round(windowWidth));
  return { width, marginHorizontal: (CEREMONY_STAGE_WIDTH - width) / 2 };
}

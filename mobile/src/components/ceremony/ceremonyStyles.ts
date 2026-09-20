// ceremonyStyles — the ceremony's shared StyleSheet. B08 seeds it with the
// tap-to-flip table subset copied verbatim from CeremonyLottie (which B11 later
// deletes); B09 appends the screen-level entries and B11 trims the leftovers.
import { StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

export const ceremonyStyles = StyleSheet.create({
  // ─── Tap-to-flip table layout ─────────────────────────────────────────
  // Container — full width, centered content. Inner rows handle the actual arc.
  tapTable: {
    width: '100%',
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  // One arc row of up to 5 cards
  tapRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // Two-row stack for 6-10 cards
  tapTwoRows: {
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: 18,
  },
  tapCardSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -2, // tiny overlap so cards feel like a physical hand
  },
  tapCardSide: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  // Card back — refined monogram look, no cartoon diamond / "POCKET" text.
  // Deep navy gradient + thin gold border + subtle "R" emblem in the middle.
  tapCardBack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(218,180,90,0.55)', // thin gold edge
    borderRadius: 10,
    overflow: 'hidden',
  },
  tapCardBackInnerRing: {
    position: 'absolute',
    width: '70%',
    height: '70%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(218,180,90,0.30)',
  },
  // Per-deck PNG card back fills the entire tapCardBack area. resizeMode
  // is 'cover' so the gold filigree pattern reaches the edges instead of
  // showing a procedural background behind a letterboxed image.
  tapCardBackImage: {
    width: '100%',
    height: '100%',
  },
  tapCardBackMonogram: {
    color: 'rgba(218,180,90,0.85)',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
    fontStyle: 'italic',
  },
  tapCardFace: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 4,
    paddingVertical: 6,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    overflow: 'hidden',
  },
  tapCardChip: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 999,
  },
  tapCardChipText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  tapCardQuestion: {
    color: colors.inkSoft,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
  },
  tapCardHoloOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.18,
  },
  tapCardBurst: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 999,
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.9,
    shadowRadius: 14,
  },
  // Stays visible after the flip — soft accent-colored radial that gives
  // RAR/LEG cards continuous radiance. Sized w+28 × h+28 so it bleeds out
  // beyond the card edges. Low opacity keeps it ambient, not loud.
  tapCardPersistentHalo: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.22,
  },

  pressed: { opacity: 0.9 },

  // B08: rarity frame PNG over the face (B12 asset, 9-slice inset 40) and the focus lift layer.
  tapCardFrame: { ...StyleSheet.absoluteFillObject },
  tapCardFocusLayer: { ...StyleSheet.absoluteFillObject, borderRadius: 10, overflow: 'hidden' },
  tapCardStreak: { position: 'absolute', top: -20, bottom: -20, width: 18, backgroundColor: 'rgba(255,255,255,0.85)', opacity: 0 },
  tapCardShadow: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
});

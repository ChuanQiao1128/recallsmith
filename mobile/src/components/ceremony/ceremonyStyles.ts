// ceremonyStyles — the ceremony's shared StyleSheet. B08 seeds it with the
// tap-to-flip table subset from the old ceremony tree; B09 appends the
// screen-level entries and B11 trims the leftovers.
import { StyleSheet } from 'react-native';
import { a11y } from '../../theme/a11y';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';

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
  // width/height are explicit on purpose: RN gives a bundled (require'd) image its intrinsic
  // 400×560 size when the style names neither, and that beats the absolute insets — the frame
  // then renders at natural size clipped to the card's top-left corner (seen 2026-09-20).
  tapCardFrame: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  // Frame-window layout (percentages of CARD_FRAME_SIZE 400×560: art window 28,64 → 344×296;
  // text slab starts at y≈380). Used only when a frameImage is supplied.
  tapCardArtWindow: { position: 'absolute', left: '7%', top: '11.4%', width: '86%', height: '52.9%', overflow: 'hidden', borderRadius: 3 },
  tapCardArtGradient: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  tapCardChipInWindow: { position: 'absolute', left: 4, top: 4 },
  tapCardSlab: { position: 'absolute', left: '9%', top: '69%', width: '82%', height: '25%', justifyContent: 'center' },
  tapCardFocusLayer: { ...StyleSheet.absoluteFillObject, borderRadius: 10, overflow: 'hidden' },
  tapCardStreak: { position: 'absolute', top: -20, bottom: -20, width: 18, backgroundColor: 'rgba(255,255,255,0.85)', opacity: 0 },
  tapCardShadow: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 4 },

  // ─── Screen-level entries (B09) — copied from the old ceremony tree, one-line
  // comments, shadowRadius clamped to 8 (B00 §7.4). Nothing above this changes.
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  // Soft wash over the page gradient.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.18)' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  // Full-screen LEG dim (opacity driven by timeline.dim; 0 for COM/RAR).
  dimOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#08041A' },
  // The 280×360 stage that hosts the renderer.
  stage: { marginTop: spacing.md, width: 280, height: 360, alignItems: 'center', justifyContent: 'center' },
  swipePack: { width: 260, minHeight: 360, alignItems: 'center', justifyContent: 'center' },
  swipePackInner: {
    width: 240, minHeight: 336, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.md, overflow: 'hidden', shadowColor: 'rgba(58,35,5,0.4)', shadowOpacity: 0.7,
    shadowRadius: 8, shadowOffset: { width: 0, height: 14 }, elevation: 10,
  },
  // Invisible 1×1 marker for the hold beat.
  holdMarker: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  stageCard: {
    width: 240, minHeight: 336, borderRadius: 22, borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: colors.softMist, alignItems: 'center', justifyContent: 'center', padding: spacing.md,
    shadowColor: 'rgba(58,35,5,0.4)', shadowOpacity: 0.65, shadowRadius: 8, shadowOffset: { width: 0, height: 12 },
    elevation: 8, overflow: 'hidden',
  },
  stageCardTear: { transform: [{ rotate: '8deg' }] },
  flipBackGradient: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  flipFront: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  flipCard: {
    width: 200, minHeight: 280, borderRadius: 22, borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: colors.softMist, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.32)', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 12 }, elevation: 8,
  },
  flipCardRevealed: {
    backgroundColor: colors.softMist, borderWidth: 4, shadowColor: 'rgba(58,35,5,0.4)', shadowOpacity: 0.6,
    shadowRadius: 8, shadowOffset: { width: 0, height: 14 }, elevation: 10,
  },
  cardBackText: { color: colors.shine, fontSize: typography.bodySmall, fontWeight: '800' },
  cardRarityChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  cardRarity: { color: colors.shine, fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.6 },
  cardQuestion: { marginTop: spacing.sm, color: colors.inkSoft, fontSize: typography.title3, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  footerRarity: { marginTop: spacing.md, color: colors.inkMuted, fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' },
  footerRarityHidden: { opacity: 0, height: 0, marginTop: 0 },
  // Phase title/body kept in tree for tests but visually 0×0.
  phaseCopyHidden: { fontSize: 0, lineHeight: 0, height: 0, opacity: 0 },
  skipButton: {
    marginTop: spacing.md, minHeight: a11y.minTouch, minWidth: 140, borderRadius: 999, paddingHorizontal: spacing.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.softMist, borderWidth: 2, borderColor: colors.pokeBlueFaint,
    shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  skipText: { color: colors.pokeBlueDeep, fontSize: typography.bodySmall, fontWeight: '900' },
  flash: { ...StyleSheet.absoluteFillObject },
  // The tear × control (repeat-user fast-forward).
  ceremonySkipX: {
    position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center', zIndex: 50, shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  ceremonySkipXText: { color: colors.inkSoft, fontSize: 22, fontWeight: '300', marginTop: -2 },

  // ─── New B09 entries ──────────────────────────────────────────────────
  flashHiddenBehindCanvas: { opacity: 0 }, // skia renderer: the Canvas bloom is the flash
  leaveButton: { position: 'absolute', top: 8, left: 8, width: 1, height: 1, opacity: 0 }, // VoiceOver-only; never accessibilityElementsHidden
  fallbackStage: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fallbackRim: { position: 'absolute', left: -14, top: -14, right: -14, bottom: -14, opacity: 0.55 },
  fallbackRimImage: { width: '100%', height: '100%' },
  spillCard: { position: 'absolute', borderRadius: 10, borderWidth: 2, backgroundColor: '#10143A' },
  deckEdge: { position: 'absolute', width: 240, minHeight: 336, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(16,20,58,0.35)' },
  pitySeal: { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5C95E', borderWidth: 2, borderColor: '#FFF7EC' },
  tapTableFrom: { width: '100%', minHeight: 240, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, // the table container before 'cards-on-table' (no testID yet)
  // hold/tear-flip: the same centred geometry, out of flow (the pack still owns the flow) and invisible.
  tapTableWarm: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, opacity: 0 },
  spillSampler: { position: 'absolute', width: 1, height: 1, opacity: 0 }, // an invisible, non-interactive sampling leaf (VoiceOver still reads its live region)

  // ─── Swipe-phase affordance (SwipeHint) — hung just under the stage's bottom edge (the
  // fallback pack fills the stage to 12 px from it; the CTA row is empty during swipe), and
  // absolute so mounting/unmounting it never moves the centred stage. Decoration only; the
  // pack stays the accessible control.
  swipeHint: {
    position: 'absolute', bottom: -14, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    columnGap: 6,
  },
  swipeHintText: { color: colors.inkMuted, fontSize: typography.bodySmall, fontWeight: '800', letterSpacing: 0.3 },
  swipeHintChevron: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  swipeHintChevronText: { color: colors.pokeBlueDeep, fontSize: 22, lineHeight: 22, fontWeight: '900', marginTop: -3 },
});

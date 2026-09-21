import { StyleSheet } from 'react-native';

import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

export const drawResultStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  stateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
  },
  stateTitle: {
    color: colors.inkSoft,
    fontSize: typography.title2,
    lineHeight: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateBody: {
    marginTop: spacing.xs,
    color: colors.inkMuted,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    textAlign: 'center',
  },

  registerPill: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.softMist,
    borderRadius: 999,
    zIndex: 20,
    shadowColor: 'rgba(58,35,5,0.32)',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  registerIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.pokeBlueFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  registerIconText: {
    fontSize: 13,
  },
  registerText: {
    color: colors.inkSoft,
    fontSize: typography.bodySmall,
    fontWeight: '900',
  },

  header: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerTitleColumn: {
    alignItems: 'center',
  },
  // Gold uppercase eyebrow above the deck title — reinforces +N to
  // Pokedex persistently after the top toast fades.
  headerEyebrow: {
    color: colors.gold,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  headerTitle: {
    color: colors.inkSoft,
    fontSize: typography.title2,
    fontWeight: '900',
  },
  collectionBar: {
    marginTop: 6,
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.softMist,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  collectionText: {
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  featuredHaloWrap: {
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredHalo: {
    // Smaller, lower-opacity halo so it accents the card instead of dwarfing it
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 240,
    top: 20,
    opacity: 0.45,
  },
  // Card aspect → closer to real trading card 5:7. Constrained max-width so it
  // doesn't spread edge-to-edge on tall phones; centered.
  featured: {
    width: 260,
    aspectRatio: 5 / 7,
    alignSelf: 'center',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.4)',
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // Base layer under the rarity frame: fills the card (no padding — the face is laid out
  // absolutely at the frame's cut-outs, see DrawResultScreen FEATURED_FRAME_LAYOUT).
  featuredGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  newBadgeWrap: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  newBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.danger,
    shadowColor: 'rgba(209,75,75,0.6)',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  newBadgeText: {
    color: colors.softCream,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  featuredRarityChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 6,
  },
  featuredRarity: {
    color: colors.softCream,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Pack palette under the pack-art thumbnail in the frame's art window (the fallback
  // when the cover PNG cannot render).
  featuredArtGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  // Registry serial on the frame's title strip — reads as a registry mark, not a sticker.
  featuredSerial: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2.4,
    textAlign: 'right',
  },
  // The white question panel inside the frame's transparent slab (position comes from
  // FEATURED_FRAME_LAYOUT.slab). Six 14.5 px lines + padding fit the 27 % slab of a 364 px card.
  featuredQuestionSlab: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 8, // the frame cuts its slab with r=12 of 400 → ~8 px on the 260 px card
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  featuredQuestion: {
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 14.5,
    fontWeight: '800',
  },

  // Bigger, hollow chips with colored rarity dot — reads like a stat row, not
  // colored pills competing with the featured card.
  summaryStrip: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Colored dots (kept legacy chip class names for backward compat with screen)
  summaryChipLeg: { borderColor: colors.rarityLegendary },
  summaryChipRar: { borderColor: colors.rarityRare },
  summaryChipCom: { borderColor: colors.rarityCommon },
  summaryChipText: {
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  summaryChipDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  // Hidden chip strip — used for single-card draws where chips would only
  // show "1 RAR" with two zero counts (no information value).
  summaryStripHidden: { height: 0, opacity: 0, marginTop: 0, overflow: 'hidden' },

  sheetToggleButton: {
    marginTop: spacing.md,
    minHeight: a11y.minTouch,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.softMist,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  sheetToggleText: {
    color: colors.inkSoft,
    fontSize: typography.bodySmall,
    fontWeight: '800',
  },

  // ─── Always-on mini-strip (Pokemon-style row of card thumbnails) ────────
  miniStrip: {
    marginTop: spacing.md,
  },
  miniStripContent: {
    paddingHorizontal: 4,
    columnGap: 8,
  },
  miniCard: {
    width: 88,
    height: 124,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 8,
    paddingTop: 14, // leaves room for the rarity bar
    marginRight: 8,
    shadowColor: 'rgba(58,35,5,0.18)',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  miniCardRarityBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
  },
  miniCardSlot: {
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  miniCardQuestion: {
    marginTop: 4,
    color: colors.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    flex: 1,
  },
  // Gold rarity stars — top-right corner of mini card. Aligns visually
  // with the Library tile's rarity star convention. textShadow for depth.
  miniCardStars: {
    position: 'absolute',
    top: 6,
    right: 8,
    color: colors.gold,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(58,35,5,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  miniCardChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  miniCardChipText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  sheetWrap: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    backgroundColor: colors.softMist,
    padding: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  gridCard: {
    width: '48%',
    minHeight: 120,
    borderRadius: 14,
    backgroundColor: colors.softCream,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  gridSlotNumber: {
    position: 'absolute',
    top: 6,
    left: 8,
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  // Gold rarity stars on grid card — sits between slot # (top-left)
  // and rarity dot (top-right). Mirrors Library tile language.
  gridStars: {
    position: 'absolute',
    top: 6,
    left: 36,
    color: colors.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(58,35,5,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  gridRarityDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  gridRarityDotText: {
    color: colors.softCream,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  gridBody: {
    marginTop: 22,
  },
  gridTag: {
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: 4,
  },
  gridQuestion: {
    color: colors.inkSoft,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    fontWeight: '700',
  },
  gridNewRibbon: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gridNewRibbonText: {
    color: colors.softCream,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  footer: {
    marginTop: spacing.md,
  },
  primaryCta: {
    minHeight: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.pokeBlue,
    shadowColor: 'rgba(44,156,192,0.5)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryCtaText: {
    color: colors.softCream,
    fontSize: typography.button,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  doneLink: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: colors.inkMuted,
    fontSize: typography.bodySmall,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  // Secondary "Earn more pulls →" pill — only renders when wallet hit
  // zero. Gold accent so it reads as a reward path, not a generic link.
  earnPullsPill: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,184,90,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(232,184,90,0.45)',
  },
  earnPullsText: {
    color: colors.gold,
    fontSize: typography.bodySmall,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  confetti: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.06,
    backgroundColor: colors.glowGold,
  },

  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: '100%',
    borderRadius: spacing.cardRadius,
    backgroundColor: colors.softMist,
    padding: spacing.md,
    shadowColor: 'rgba(0,0,0,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modalRarityChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modalRarity: {
    color: colors.softCream,
    fontSize: typography.caption,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modalTitle: {
    marginTop: spacing.sm,
    color: colors.inkSoft,
    fontSize: typography.title3,
    lineHeight: 24,
    fontWeight: '900',
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.9 },
});

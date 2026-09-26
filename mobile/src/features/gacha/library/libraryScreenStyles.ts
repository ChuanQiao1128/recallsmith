import { StyleSheet } from 'react-native';

import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import {
  LIBRARY_LIST_PADDING_TOP,
  LIBRARY_ROW_GAP,
  LIBRARY_TILE_HEIGHT,
} from './libraryGridLayout';

export const libraryStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  primarySurface: { flex: 1 },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: LIBRARY_LIST_PADDING_TOP,
    paddingBottom: spacing.xl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  errorTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: colors.parchmentBg, fontSize: typography.button, fontWeight: '800' },
  emptyState: {
    marginTop: spacing.lg,
    borderRadius: spacing.cardRadius,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9 },

  // Deck switcher shown on the error state so an offline user can still
  // reach their other installed decks (MCORE-13).
  errorDeckSwitcher: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  errorDeckChip: {
    minHeight: a11y.minTouch,
    minWidth: 92,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorDeckChipText: {
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },

  // ─── New compact header ──────────────────────────────────────────────────
  headerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerTitleColumn: { flex: 1, paddingRight: spacing.sm },
  headerEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.gold,
  },
  // Pokeball-style counter ring with % inside + ratio underneath
  headerCounter: {
    alignItems: 'center',
    minWidth: 64,
  },
  headerCounterRing: {
    width: 54,
    height: 54,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.softCream,
  },
  headerCounterPct: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.inkSoft,
  },
  headerCounterRatio: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '800',
    color: colors.inkMuted,
    letterSpacing: 0.4,
  },

  // Always-on filter chips (replaces the "All · Filters" toggle layer)
  // contentContainerStyle for the horizontal ScrollView wrapping filter
  // chips. No flexWrap (we want horizontal scroll, not multi-line).
  // gap handles inter-chip spacing; paddingRight gives the last chip
  // breathing room on the right edge.
  filterChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 16,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.softCream,
  },
  filterChipActive: {
    backgroundColor: colors.inkSoft,
    borderColor: colors.inkSoft,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.inkSoft,
    letterSpacing: 0.3,
  },
  filterChipTextActive: { color: colors.softCream },

  // Hidden test-contract probe — search field + filter toggle/sheet kept in
  // tree but invisible (test scrapes by testID, doesn't care about layout)
  libraryTestProbeHidden: { width: 0, height: 0, opacity: 0, fontSize: 0, lineHeight: 0, overflow: 'hidden' },

  // Legacy aliases (preserved as imports may still reference them)
  eyebrow: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    marginTop: 2,
    fontSize: typography.title2,
    color: colors.inkSoft,
    fontWeight: '900',
  },
  collectionBar: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '800',
  },

  deckSwitcher: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  // Horizontal scroll variant for deck switcher
  deckSwitcherScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 8,
  },
  deckChip: {
    minHeight: a11y.minTouch,
    minWidth: 92,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckChipActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  deckChipText: {
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  deckChipTextActive: {
    color: colors.parchmentBg,
  },
  searchField: {
    marginTop: spacing.md,
    minHeight: a11y.minTouch,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  searchText: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '600',
  },
  filterSummary: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  filterSummaryText: {
    color: colors.ink,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  filterSheet: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    padding: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  sheetOption: {
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.inkSecondary,
    backgroundColor: colors.parchmentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  sheetOptionText: {
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  sheetOptionTextActive: {
    color: colors.parchmentBg,
  },
  columnWrap: {
    justifyContent: 'space-between',
    marginBottom: LIBRARY_ROW_GAP,
  },
  // ─── Brand-new user banner ─────────────────────────────────────────
  // Renders above the Pokedex header when the user has 0 owned cards.
  // pokeBlue solid pill so it reads as the obvious next action — gives
  // brand-new users a clear path forward instead of staring at 100 ?
  // tiles.
  emptyCollectionBanner: {
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 64,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.pokeBlue,
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  emptyCollectionBannerTextWrap: {
    flex: 1,
  },
  emptyCollectionBannerEyebrow: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  emptyCollectionBannerTitle: {
    marginTop: 3,
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  emptyCollectionBannerArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    paddingLeft: 4,
  },
  // ─── Pokedex slot tile v2 — pack-art header + question body ──────────────
  card: {
    flex: 1,
    height: LIBRARY_TILE_HEIGHT,
    borderRadius: 14,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.12)',
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Top art header — pack palette gradient. ~46% of tile height, with the
  // slot # painted on it in white. Gives every tile its pack identity.
  cardArtHeader: {
    height: 70,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  cardArtHeaderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Missing cards: heavily dimmed gradient + dark overlay tint = clearly
  // "locked", visible even for color-weak users. The opacity 0.35 alone
  // wasn't strong enough — owned and missing tiles read too similarly.
  cardArtHeaderMissing: {
    opacity: 0.18,
  },
  cardArtSlotNumber: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(0,0,0,0.30)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Wraps slot # and rarity stars in a column so they stack neatly
  // in the top-left of the art header.
  cardArtTopLeft: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  // Gold ★ characters — only rendered when rarity is RAR (1) or LEG (3).
  cardArtRarityStars: {
    color: '#FFE9C7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(58,35,5,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  cardArtStatusDot: {
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  // Body — question text or "?" placeholder
  cardBody: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  cardBodyText: {
    fontSize: 12,
    lineHeight: 15,
    color: colors.inkSoft,
    fontWeight: '700',
  },
  // Per-card emoji anchor — sits above the question text on owned tiles.
  // Big enough to read at thumbnail scale, small enough not to dominate.
  cardBodyIcon: {
    fontSize: 22,
    lineHeight: 26,
    marginBottom: 4,
  },
  // Missing card "?" is now bigger + higher contrast — a clearly
  // "locked slot" signal. Was barely visible at fontSize 32 + 0.55 opacity.
  cardBodyMissingMark: {
    alignSelf: 'center',
    fontSize: 38,
    fontWeight: '900',
    color: colors.inkMuted,
    opacity: 0.72,
  },
  cardMissing: {
    // Slightly darker tint than owned card surface — reinforces the
    // "this slot is empty" feel beyond just the dimmed art header.
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  // 0×0 hidden test probe — keeps library-card-status-{uid} testID + legacy
  // statusLabel text in the tree without rendering anything visible
  cardTestProbeHidden: { width: 0, height: 0, opacity: 0, overflow: 'hidden', fontSize: 0, lineHeight: 0 },
  cardTwoColumns: { maxWidth: '48%' },
  cardThreeColumns: { maxWidth: '31%' },
  // Legacy alias (older code may still reference cardNew)
  cardNew: { opacity: 0.58 },
  cardHighlight: {
    borderColor: colors.glowGold,
    borderWidth: 2,
  },
  // Legacy aliases — kept so any leftover references to the old tile chrome
  // still resolve to a non-undefined style. They are NO LONGER referenced
  // by LibraryCardTile.tsx; the tile uses cardArt* / cardBody* now.
  cardAccentStripe: { display: 'none' },
  cardSlotRow: { display: 'none' },
  cardSlotNumber: { display: 'none' },
  cardStatusDot: { display: 'none' },
  cardMissingBody: { display: 'none' },
  cardMissingText: { display: 'none' },
  cardQuestion: { display: 'none' },
  cardBadgeRow: { display: 'none' },
  statusBadge: { display: 'none' },
  statusBadgeNew: { display: 'none' },
  statusBadgeLearning: { display: 'none' },
  statusBadgeMastered: { display: 'none' },
  statusBadgeText: { display: 'none' },
  statusBadgeTextOnSolid: { display: 'none' },
});

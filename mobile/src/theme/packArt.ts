// Pack art palettes inspired by the Pokemon TCG Pocket pack covers
// (purple "最強的基因", orange "波導奏動", pastel "超級異彩").
// Picked deterministically from a pack slug or index so the same pack
// always renders with the same colors across screens.

import type { ImageSourcePropType } from 'react-native';
import { colors } from './colors';

export type PackPalette = {
  // 4-stop gradient used for the front of the pack
  cover: readonly [string, string, string, string];
  // soft glow halo placed behind the pack on the light page background
  halo: string;
  // accent ring around the pack edge
  ring: string;
  // strong tint for the text title baked onto the pack
  titleInk: string;
  // accent for the small chip that holds the pack code (A1, B3, B2b)
  badgeBg: string;
  badgeInk: string;
};

const PALETTES: readonly PackPalette[] = [
  // 0 — purple "最強的基因" feel
  {
    cover: ['#5C3DA0', '#7A4DC4', '#A77FE0', '#5C3DA0'] as const,
    halo: 'rgba(167,127,224,0.28)',
    ring: 'rgba(255,255,255,0.55)',
    titleInk: '#FFFFFF',
    badgeBg: '#1B1235',
    badgeInk: '#FFE9C7',
  },
  // 1 — orange/red "波導奏動" feel
  {
    cover: ['#D14B2A', '#E96A36', '#F2A65A', '#B33718'] as const,
    halo: 'rgba(233,106,54,0.30)',
    ring: 'rgba(255,236,196,0.55)',
    titleInk: '#FFFFFF',
    badgeBg: '#28110A',
    badgeInk: '#FFE9C7',
  },
  // 2 — pastel rainbow "超級異彩" feel
  {
    cover: ['#F8C9DD', '#C7E6F5', '#D7C5F0', '#FBD9C4'] as const,
    halo: 'rgba(199,230,245,0.40)',
    ring: 'rgba(255,255,255,0.75)',
    titleInk: '#3A2C1F',
    badgeBg: '#FFFFFF',
    badgeInk: '#3A2C1F',
  },
  // 3 — mint/teal accent
  {
    cover: ['#2E8C7C', '#3FB29B', '#A8E2D3', '#1F5F55'] as const,
    halo: 'rgba(63,178,155,0.28)',
    ring: 'rgba(255,255,255,0.55)',
    titleInk: '#FFFFFF',
    badgeBg: '#0F2A24',
    badgeInk: '#E6FBF3',
  },
  // 4 — gold/legendary accent
  {
    cover: ['#C18B2B', '#E8B85A', '#F5DA8A', '#8E5E10'] as const,
    halo: 'rgba(232,184,90,0.30)',
    ring: 'rgba(255,255,255,0.55)',
    titleInk: '#3A2305',
    badgeBg: '#3A2305',
    badgeInk: '#FFE9C7',
  },
  // 5 — coral starburst over plum dusk (Claude deck). Stops are the
  // dominant colours sampled from assets/packs/claude.png so the procedural
  // fallbacks (LibraryCardTile, CardDetail, Challenge chip) match the cover.
  {
    cover: ['#3E2539', '#793950', '#F0864A', '#251628'] as const,
    halo: 'rgba(240,134,74,0.30)',
    ring: 'rgba(255,214,158,0.55)',
    titleInk: '#FFFFFF',
    badgeBg: '#251628',
    badgeInk: '#FFD6A0',
  },
];

// Stable slug → palette index map for the canonical pack slugs we ship.
// Ensures csharp always gets purple, ai always gets mint, cloud always
// gets pastel — regardless of the upstream slug naming. Anything not in
// this map falls back to hash-based pseudo-random pick.
const CANONICAL_PALETTE_INDEX: Record<string, number> = {
  csharp: 0, // purple
  ai: 3, // mint
  cloud: 2, // pastel rainbow
  aws: 1, // orange
  claude: 5, // coral / violet
  'premium-deck': 4, // gold
  default: 0,
};

// Fuzzy slug → canonical pack key. Real backend manifest slugs differ from
// the registered PNG keys ('cs-dotnet' / 'c-sharp' → csharp, 'aws-saa-c03'
// → aws, 'claude-ccdv-f' → claude). ONE function feeds both the palette
// and the PNG lookups so they can never disagree again — the previous
// inline duplicate is how aws-saa-c03 once got the aws PNG but the cloud
// palette. Order matters: aws is tested before cloud because the cloud rule
// also matches anything containing 'aws'.
function canonicalPackSlug(slug: string): string {
  const s = slug.toLowerCase().trim();
  if (
    s === 'c#'
    || s === 'cs'
    || s === 'c-sharp'
    || s.includes('csharp')
    || s.startsWith('cs-')
    || s.startsWith('c-sharp')
  ) {
    return 'csharp';
  }
  if (s === 'ai' || s.startsWith('ai-') || s.endsWith('-ai')) return 'ai';
  // aws-saa-c03 is a live deck with its own cover, docs/aws-saa-demo-deck-plan-2026-09-16.md
  if (s === 'aws' || s.startsWith('aws-')) return 'aws';
  // claude-ccdv-f is a live deck (Claude Code developer cert); any future
  // claude-* deck shares the same coral/violet identity.
  if (s.startsWith('claude')) return 'claude';
  if (
    s === 'cloud'
    || s.startsWith('cloud-')
    || s.includes('aws')
    || s.includes('gcp')
    || s.includes('azure')
  ) {
    return 'cloud';
  }
  return s;
}

export function packPaletteFromSlug(slug: string | null | undefined, fallbackIndex = 0): PackPalette {
  const safe = String(slug ?? '');
  if (!safe) return PALETTES[fallbackIndex % PALETTES.length];
  const canonical = canonicalPackSlug(safe);
  if (CANONICAL_PALETTE_INDEX[canonical] !== undefined) {
    return PALETTES[CANONICAL_PALETTE_INDEX[canonical]];
  }
  // Hash fallback for unknown slugs (deterministic per slug)
  let acc = 0;
  for (let i = 0; i < safe.length; i += 1) {
    acc = (acc * 31 + safe.charCodeAt(i)) >>> 0;
  }
  return PALETTES[acc % PALETTES.length];
}

export function packPaletteFromIndex(index: number): PackPalette {
  const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return PALETTES[safe % PALETTES.length];
}

// Page-level gradients (top → bottom) for the 3 redesigned screens.
// Light, airy, Pokemon-TCG-Pocket style.
export const PAGE_GRADIENT_LIGHT = [
  colors.softCream,
  colors.softPeach,
  colors.softLavender,
] as const;

// Pokemon TCG Pocket's ceremony bg is near-white with a faint cool tint at the
// bottom. The brightness is what lets the gold flash + pack carry the eye.
export const PAGE_GRADIENT_CEREMONY = [
  '#FFFFFF',
  '#F4F1FA',
  // design §3.1 S0: darkened bottom stop so the seam light reads against it.
  '#D9D2E6',
] as const;

// Rarity glow tints used during the ceremony reveal.
export function rarityHaloColor(rarity: 'COM' | 'RAR' | 'LEG'): string {
  if (rarity === 'LEG') return 'rgba(245,201,94,0.55)';
  if (rarity === 'RAR') return 'rgba(167,139,216,0.50)';
  return 'rgba(201,165,108,0.40)';
}

export function rarityAccentColor(rarity: 'COM' | 'RAR' | 'LEG'): string {
  if (rarity === 'LEG') return colors.rarityLegendary;
  if (rarity === 'RAR') return colors.rarityRare;
  return colors.rarityCommon;
}

// ─── Pack-art PNG registry ─────────────────────────────────────────────────
// Drop PNGs into mobile/assets/packs/ and add a line here to swap the
// View+gradient pack for a real illustration. The 'default' entry is used as
// a fallback for any slug that isn't explicitly registered.
//
// ai/cloud/premium-deck/default: scripts/gen_packs.py placeholders.
// csharp/aws/claude: illustrated covers, see assets/packs/README.md.

import csharpPack from '../../assets/packs/csharp.png';
import aiPack from '../../assets/packs/ai.png';
import cloudPack from '../../assets/packs/cloud.png';
import awsPack from '../../assets/packs/aws.png';
import claudePack from '../../assets/packs/claude.png';
import premiumPack from '../../assets/packs/premium-deck.png';
import defaultPack from '../../assets/packs/default.png';

// Per-deck card back PNGs. These overlay (or replace) the procedural
// gold-ring + R-monogram card back during the gacha tap-to-flip phase
// in DrawCeremonyScreen. When a deck has its own back PNG, players
// see "this card came from the C# pack" the moment cards land on the
// table — building visual identity and collection feeling. Every
// shipped deck now has a back; unregistered slugs still return
// undefined so the procedural back stays canonical for un-themed decks.
import csharpCardBack from '../../assets/packs/csharp-back.png';
import aiCardBack from '../../assets/packs/ai-back.png';
import cloudCardBack from '../../assets/packs/cloud-back.png';
import awsCardBack from '../../assets/packs/aws-back.png';
import claudeCardBack from '../../assets/packs/claude-back.png';
import premiumCardBack from '../../assets/packs/premium-deck-back.png';
// Generic back for callers that want one (exported as DEFAULT_CARD_BACK); it
// is deliberately NOT a key of CARD_BACK_IMAGES so unregistered slugs miss.
import defaultCardBack from '../../assets/packs/default-back.png';

// Stage assets for the Seam of Light ceremony (B00 §6 contract names).
// Rarity frames + foil LUT: scripts/gen_card_frames.py. Particle sheet +
// glow 9-slice: scripts/gen_particles.py. Card backs: scripts/gen_card_back.py.
import type { Rarity } from '../features/gacha/draw/cardRarity';
import frameCom from '../../assets/ui/frame-com.png';
import frameRar from '../../assets/ui/frame-rar.png';
import frameLeg from '../../assets/ui/frame-leg.png';
import foilLut from '../../assets/ui/foil-lut.png';
import particleSheet from '../../assets/ui/particles.png';
import glowNineSlice from '../../assets/ui/glow-9slice.png';

const PACK_IMAGES: Record<string, ImageSourcePropType> = {
  // Live decks with illustrated covers (csharp, aws-saa-c03, claude-ccdv-f)
  csharp: csharpPack,
  aws: awsPack,
  claude: claudePack,
  // Placeholder covers (gen_packs.py) — still registered so the slugs resolve
  ai: aiPack,
  cloud: cloudPack,
  'premium-deck': premiumPack,
  default: defaultPack,
};

// Card-back PNG registry. UNLIKE PACK_IMAGES, there's no `default` entry —
// missing slugs return undefined, signaling the caller to render the
// procedural fallback (or DEFAULT_CARD_BACK if they want a generic one).
// Every shipped deck has a back; un-themed decks still miss on purpose.
const CARD_BACK_IMAGES: Record<string, ImageSourcePropType> = {
  csharp: csharpCardBack,
  aws: awsCardBack,
  claude: claudeCardBack,
  ai: aiCardBack,
  cloud: cloudCardBack,
  'premium-deck': premiumCardBack,
};

// ─── Ceremony stage asset registry (B00 §6 contract names) ─────────────────
// Consumed by B05 StageCanvas (PARTICLE_SHEET, GLOW_9SLICE), B08 TapCard /
// FoilLayer (cardFrameForRarity, FOIL_LUT), B09 FallbackStage (DEFAULT_CARD_BACK)
// and B10 DrawResult (cardFrameForRarity, GLOW_9SLICE, GLOW_9SLICE_INSET).
export const DEFAULT_CARD_BACK: ImageSourcePropType = defaultCardBack;
export const CARD_FRAME_SIZE = { width: 400, height: 560 } as const;
export const CARD_FRAME_ART_WINDOW = { x: 28, y: 64, width: 344, height: 296 } as const;
// The frame's other cut-outs (scripts/gen_card_frames.py SLAB and the flat title strip above
// the art window), in the same 400×560 space, so a card face can lay its text where the PNG
// is transparent / flat instead of guessing percentages.
export const CARD_FRAME_SLAB = { x: 28, y: 384, width: 344, height: 152 } as const;
export const CARD_FRAME_TITLE_STRIP = { x: 28, y: 24, width: 344, height: 36 } as const;
export const CARD_FRAME_NINE_SLICE_INSET = 40;
export const CARD_FRAME_IMAGES: Record<Rarity, ImageSourcePropType> = { COM: frameCom, RAR: frameRar, LEG: frameLeg };
export function cardFrameForRarity(rarity: Rarity): ImageSourcePropType {
  return CARD_FRAME_IMAGES[rarity] ?? CARD_FRAME_IMAGES.COM;
}
export const FOIL_LUT: ImageSourcePropType = foilLut;
export const PARTICLE_SHEET: ImageSourcePropType = particleSheet;
export const PARTICLE_SPRITE_SIZE = 64;
export const PARTICLE_SPRITES = { dot: 0, star: 64, fleck: 128, shard: 192 } as const;
export const GLOW_9SLICE: ImageSourcePropType = glowNineSlice;
export const GLOW_9SLICE_INSET = 32;

// PNG-registry lookup key for a manifest slug. An exact registered key wins
// (so 'default' / 'premium-deck' never get re-mapped); everything else goes
// through the same canonicalizer the palette uses.
function normalizeSlugForPack(slug: string): string {
  const s = slug.toLowerCase().trim();
  if (PACK_IMAGES[s]) return s;
  return canonicalPackSlug(s);
}

export function packImageForSlug(slug: string | null | undefined): ImageSourcePropType | undefined {
  const safe = String(slug ?? '').trim();
  if (!safe) return PACK_IMAGES.default;
  const normalized = normalizeSlugForPack(safe);
  return PACK_IMAGES[normalized] ?? PACK_IMAGES.default;
}

/**
 * Resolve a per-deck card back PNG. Returns undefined when no PNG is
 * registered for the slug — caller should fall back to the procedural
 * card back (gold ring + monogram). Slug normalization mirrors
 * packImageForSlug so cs-dotnet / c-sharp / c# all resolve to csharp.
 *
 * Why undefined-on-miss (instead of a default card-back PNG): we want
 * the procedural fallback to remain canonical for un-themed decks
 * rather than baking in a single "generic" back that would compete
 * visually with the themed ones.
 */
export function cardBackImageForSlug(slug: string | null | undefined): ImageSourcePropType | undefined {
  const safe = String(slug ?? '').trim();
  if (!safe) return undefined;
  const normalized = normalizeSlugForPack(safe);
  return CARD_BACK_IMAGES[normalized];
}
export const SEAM_BAND_RATIO = 0.18;

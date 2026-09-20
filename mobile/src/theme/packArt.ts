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
  'premium-deck': 4, // gold
  default: 0,
};

export function packPaletteFromSlug(slug: string | null | undefined, fallbackIndex = 0): PackPalette {
  const safe = String(slug ?? '');
  if (!safe) return PALETTES[fallbackIndex % PALETTES.length];
  // Normalize fuzzy slugs (e.g. 'cs-dotnet' → 'csharp') so the palette
  // and PNG always agree. Defined inline since the helper lives lower
  // in the file — duplicates a tiny check rather than reordering.
  const lower = safe.toLowerCase().trim();
  let canonical = lower;
  if (
    lower === 'c#' || lower === 'cs' || lower === 'c-sharp'
    || lower.includes('csharp') || lower.startsWith('cs-')
  ) {
    canonical = 'csharp';
  } else if (lower === 'ai' || lower.startsWith('ai-') || lower.endsWith('-ai')) {
    canonical = 'ai';
  } else if (
    lower === 'cloud' || lower.startsWith('cloud-')
    || lower.includes('aws') || lower.includes('gcp') || lower.includes('azure')
  ) {
    canonical = 'cloud';
  }
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
  '#E8E2F2',
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
// Generated by scripts/gen_packs.py — re-run that to refresh.

import csharpPack from '../../assets/packs/csharp.png';
import aiPack from '../../assets/packs/ai.png';
import cloudPack from '../../assets/packs/cloud.png';
import awsPack from '../../assets/packs/aws.png';
import premiumPack from '../../assets/packs/premium-deck.png';
import defaultPack from '../../assets/packs/default.png';

// Per-deck card back PNGs. These overlay (or replace) the procedural
// gold-ring + R-monogram card back during the gacha tap-to-flip phase
// in DrawCeremonyScreen. When a deck has its own back PNG, players
// see "this card came from the C# pack" the moment cards land on the
// table — building visual identity and collection feeling. Decks
// without a registered back fall back to the procedural card back,
// so this is purely additive.
import csharpCardBack from '../../assets/packs/csharp-back.png';

const PACK_IMAGES: Record<string, ImageSourcePropType> = {
  // Active deck slugs (mocked for Home until real decks land)
  csharp: csharpPack,
  ai: aiPack,
  cloud: cloudPack,
  // Legacy / fallback
  aws: awsPack,
  'premium-deck': premiumPack,
  default: defaultPack,
};

// Card-back PNG registry. UNLIKE PACK_IMAGES, there's no `default` entry —
// missing slugs return undefined, signaling the caller to render the
// procedural fallback. This keeps the rollout incremental: ship one
// deck's card back at a time without touching the others.
const CARD_BACK_IMAGES: Record<string, ImageSourcePropType> = {
  csharp: csharpCardBack,
};

// Fuzzy slug normalization for pack-art lookup. Real backend manifest
// slugs may differ from the registered PNG keys (e.g. 'cs-dotnet' /
// 'csharp-net' / 'c-sharp' all should resolve to the csharp pack).
// Without this, a user with C# / .NET installed sees the default pack
// PNG instead of the intended purple csharp art, AND the palette hash
// gives them a random gradient color.
function normalizeSlugForPack(slug: string): string {
  const s = slug.toLowerCase().trim();
  if (PACK_IMAGES[s]) return s;
  // C# variants — manifest may name it cs-dotnet, csharp-net, c-sharp, etc.
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
  // AI variants
  if (s === 'ai' || s.startsWith('ai-') || s.endsWith('-ai')) return 'ai';
  // Cloud variants — covers aws/gcp/azure too
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

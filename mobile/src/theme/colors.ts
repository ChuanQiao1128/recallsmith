export const colors = {
  parchmentBg: '#FAF3E0',
  parchmentBgDeep: '#F3E8C8',
  ink: '#2A2218',
  inkSecondary: '#5A4B38',
  cosmicBg: '#0B1030',
  cosmicBgDeep: '#070A1F',
  cosmicInk: '#F5ECC4',
  glowGold: '#E8B85A',
  gold: '#C8883A',
  mint: '#7E9D5E',
  danger: '#AA3636',

  // ─── Pokemon-style light palette (additive; safe for new screens) ───
  // Soft pastel surfaces — used as page background gradient stops.
  softCream: '#FCF5EA',
  softPeach: '#FCE4D2',
  softLavender: '#ECE0F2',
  softMist: '#F5F2FA',
  // Inks tuned for the light surface (high enough contrast, less harsh than near-black).
  inkSoft: '#3A2C1F',
  inkMuted: '#8A7B6A',
  // Primary CTA blue (Pokemon TCG Pocket "開封" button).
  pokeBlue: '#3FB7DB',
  pokeBlueDeep: '#2C9CC0',
  pokeBlueFaint: '#BFE6F1',
  // Rarity accents reused across pack art / featured cards / glow halos.
  rarityCommon: '#C9A56C',
  rarityRare: '#A78BD8',
  rarityLegendary: '#F5C95E',
  // Soft drop shadow tone for cards on light bg.
  shadowSoft: 'rgba(67,42,18,0.10)',
  // Subtle dividing lines on light surface.
  hairline: 'rgba(67,42,18,0.12)',
  // Translucent gold for sparkle dots / shine sweeps.
  shine: 'rgba(255,255,255,0.88)',
} as const;

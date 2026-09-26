// ============================================
// DeveloperCards rarity configuration
// ============================================
//
// `label` used to be Chinese with a parallel `labelEn` beside it, and `label`
// is the one that reaches the screen -- RarityBadge and RarityDistribution both
// read it, so all three tiers rendered as Chinese inside two otherwise English
// panels. Now that the console is English-only the two fields would be the same
// string twice, which is the shape where one of them gets edited and the other
// does not, so `labelEn` is gone rather than left as a synonym. Nothing read it:
// `as const` puts these members in the type, so a surviving reader would be a
// TS2339 under `tsc -b`, which is what was used to check.
export const RARITY_MAP = {
  1: {
    key: 'common' as const,
    label: 'Common',
    stars: '⭐',
    starCount: 1,
    // blues
    color: '#3B82F6',
    colorLight: '#60A5FA',
    colorDark: '#2563EB',
    gradient: ['#DBEAFE', '#3B82F6'],
    glowColor: 'rgba(59, 130, 246, 0.4)',
    dropRate: 0.70,
    borderWidth: 1,
  },
  2: {
    key: 'rare' as const,
    label: 'Rare',
    stars: '⭐⭐',
    starCount: 2,
    // purples
    color: '#8B5CF6',
    colorLight: '#A78BFA',
    colorDark: '#7C3AED',
    gradient: ['#EDE9FE', '#8B5CF6'],
    glowColor: 'rgba(139, 92, 246, 0.5)',
    dropRate: 0.25,
    borderWidth: 2,
  },
  3: {
    key: 'epic' as const,
    label: 'Epic',
    stars: '⭐⭐⭐',
    starCount: 3,
    // golds
    color: '#F59E0B',
    colorLight: '#FBBF24',
    colorDark: '#D97706',
    gradient: ['#FEF3C7', '#F59E0B'],
    glowColor: 'rgba(245, 158, 11, 0.6)',
    dropRate: 0.05,
    borderWidth: 3,
    specialEffect: 'shimmer',
  },
} as const;

export type CardRarityKey = typeof RARITY_MAP[1 | 2 | 3]['key'];
export type CardRarityConfig = typeof RARITY_MAP[1 | 2 | 3];

export function mapDifficultyToRarity(difficulty: number): CardRarityConfig {
  return RARITY_MAP[(difficulty as 1 | 2 | 3) || 1];
}

export function getRarityByKey(key: CardRarityKey): CardRarityConfig {
  const entry = Object.values(RARITY_MAP).find(r => r.key === key);
  return entry || RARITY_MAP[1];
}

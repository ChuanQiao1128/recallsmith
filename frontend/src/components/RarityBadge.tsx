import { mapDifficultyToRarity } from '../gacha/rarityConfig';

interface RarityBadgeProps {
  difficulty: number;
  showLabel?: boolean;
}

export function RarityBadge({ difficulty, showLabel = true }: RarityBadgeProps) {
  const rarity = mapDifficultyToRarity(difficulty);

  const baseClasses =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border';

  const colorClasses = {
    common: 'bg-blue-50 text-blue-700 border-blue-200',
    rare: 'bg-purple-50 text-purple-700 border-purple-200',
    epic: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <span className={`${baseClasses} ${colorClasses[rarity.key]}`}>
      <span>{rarity.stars}</span>
      {showLabel && <span>{rarity.label}</span>}
    </span>
  );
}

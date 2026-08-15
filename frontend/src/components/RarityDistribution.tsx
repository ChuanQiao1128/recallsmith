import { useMemo } from 'react';
import { mapDifficultyToRarity } from '../gacha/rarityConfig';

interface RarityDistributionProps {
  // Only difficulty is read, so the prop asks for exactly that. The import
  // preview shows the distribution of cards that do not exist server side yet
  // and therefore have no id, version or timestamps to invent.
  cards: readonly { difficulty: number }[];
}

export function RarityDistribution({ cards }: RarityDistributionProps) {
  const stats = useMemo(() => {
    const total = cards.length;
    const groups = {
      1: cards.filter((c) => c.difficulty === 1).length,
      2: cards.filter((c) => c.difficulty === 2).length,
      3: cards.filter((c) => c.difficulty === 3).length,
    };

    return {
      total,
      common: {
        count: groups[1],
        pct: total ? Math.round((groups[1] / total) * 100) : 0,
      },
      rare: {
        count: groups[2],
        pct: total ? Math.round((groups[2] / total) * 100) : 0,
      },
      epic: {
        count: groups[3],
        pct: total ? Math.round((groups[3] / total) * 100) : 0,
      },
    };
  }, [cards]);

  if (cards.length === 0) return null;

  const rarityConfig = {
    common: mapDifficultyToRarity(1),
    rare: mapDifficultyToRarity(2),
    epic: mapDifficultyToRarity(3),
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">
        Rarity Distribution
      </h3>
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: rarityConfig.common.color }}
          />
          <span className="text-slate-600">
            {rarityConfig.common.label}: {stats.common.count} ({stats.common.pct}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: rarityConfig.rare.color }}
          />
          <span className="text-slate-600">
            {rarityConfig.rare.label}: {stats.rare.count} ({stats.rare.pct}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: rarityConfig.epic.color }}
          />
          <span className="text-slate-600">
            {rarityConfig.epic.label}: {stats.epic.count} ({stats.epic.pct}%)
          </span>
        </div>
        <div className="ml-auto text-slate-500">Total: {stats.total} cards</div>
      </div>
    </div>
  );
}

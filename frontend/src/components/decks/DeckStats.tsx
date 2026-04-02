// src/components/decks/DeckStats.tsx
// Deck 统计面板组件

interface DeckStatsProps {
  published: number;
  needsPublish: number;
  unpublished: number;
  total: number;
}

export function DeckStats({ published, needsPublish, unpublished, total }: DeckStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <div className="text-xs text-slate-500">Total Decks</div>
        <div className="text-lg font-semibold text-slate-800">{total}</div>
      </div>
      <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
        <div className="text-xs text-emerald-600">Published</div>
        <div className="text-lg font-semibold text-emerald-700">{published}</div>
      </div>
      <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
        <div className="text-xs text-amber-600">Needs Publish</div>
        <div className="text-lg font-semibold text-amber-700">{needsPublish}</div>
      </div>
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
        <div className="text-xs text-slate-500">Unpublished</div>
        <div className="text-lg font-semibold text-slate-700">{unpublished}</div>
      </div>
    </div>
  );
}

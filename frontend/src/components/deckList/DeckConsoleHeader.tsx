// src/components/deckList/DeckConsoleHeader.tsx
//
// The page title, the Decks / Publish Jobs tab switcher, Refresh, and New Deck.
// Lifted from DeckListPage.tsx lines 607-694.
//
// RENAMES APPLIED (the complete list; anything else would show up as a hash
// mismatch in the provenance check, not as prose):
//   setActiveTab('decks')            -> onSelectTab('decks')
//   setActiveTab('publishJobs')      -> onSelectTab('publishJobs')
//   the decks Refresh onClick body   -> onRefreshDecks()
//   () => void loadPublishJobs()     -> onRefreshJobs()
//   navigate('/decks/new')           -> onNewDeck()
//
// WHY `publishJobs` ARRIVES WHOLE rather than as a pre-counted number. The two
// `publishJobs.filter(...).length` expressions are the only reason this prop
// exists, and passing the array keeps both of them byte-identical to the
// original. It is the ONE place in this split where byte-equality was chosen
// over the narrower prop, and it is called out here rather than left to be
// discovered.
//
// The two superAdmin reads here (the tab switcher and New Deck) are two of the
// four gates that moved during the split; the other two are in DeckRowsTable.
// The remaining ten stay on the page.
//
// PROVENANCE. The JSX below was moved out of src/pages/DeckListPage.tsx and is
// byte-identical to the original apart from the renames listed above. Its
// ORIGINAL INDENTATION IS PRESERVED ON PURPOSE, even though it looks over-deep
// for a file this small: re-indenting would destroy the only cheap proof that
// nothing else changed in the move. eslint has no indent rule here, so this
// costs nothing but the look of it.
//
// NO HOOKS, NO memo, NO useCallback. tests/deckListHookOrder.test.ts C2
// enforces this over the whole directory. The reason is C1: the page's recorded
// hook sequence only describes the rendered tree while the children add nothing
// to it. It is also exactly why the older src/components/decks/DeckTable.tsx
// could not be reused — it calls useNavigate() internally.

import type { PublishJob } from '../../api/authoring';

export interface DeckConsoleHeaderProps {
  activeTab: 'decks' | 'publishJobs';
  onSelectTab: (tab: 'decks' | 'publishJobs') => void;
  superAdmin: boolean;
  publishJobs: PublishJob[];
  onRefreshDecks: () => void;
  onRefreshJobs: () => void;
  onNewDeck: () => void;
}

export function DeckConsoleHeader({
  activeTab,
  onSelectTab,
  superAdmin,
  publishJobs,
  onRefreshDecks,
  onRefreshJobs,
  onNewDeck,
}: DeckConsoleHeaderProps) {
  return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {activeTab === 'decks' ? 'Decks' : 'Publish Jobs'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {activeTab === 'decks' 
                ? 'Manage your flashcard decks, edit content, and publish to mobile.' 
                : 'View and monitor deck publishing tasks.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Tab Switcher - 横向开关样式 */}
            {superAdmin && (
              <div className="flex items-center bg-white border border-slate-300 rounded-xl p-1 shadow-sm">
                <button
                  type="button"
                  className={`relative px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    activeTab === 'decks'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  onClick={() => onSelectTab('decks')}
                >
                  Decks
                </button>
                <button
                  type="button"
                  className={`relative px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    activeTab === 'publishJobs'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  onClick={() => onSelectTab('publishJobs')}
                >
                  Publish Jobs
                  {publishJobs.filter(j => j.status === 'PENDING' || j.status === 'PROCESSING').length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      activeTab === 'publishJobs' ? 'bg-white text-indigo-600' : 'bg-amber-500 text-white'
                    }`}>
                      {publishJobs.filter(j => j.status === 'PENDING' || j.status === 'PROCESSING').length}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Refresh 按钮 - 两个标签页都有 */}
            {activeTab === 'decks' ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 shadow-sm transition-all active:scale-95"
                onClick={() => onRefreshDecks()}
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 shadow-sm transition-all active:scale-95"
                onClick={() => onRefreshJobs()}
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
            {superAdmin ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow-sm transition-all active:scale-95"
                onClick={() => onNewDeck()}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Deck
              </button>
            ) : null}
          </div>
        </div>
  );
}

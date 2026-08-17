// src/components/deckList/PublishJobsPanel.tsx
//
// The Publish Jobs tab's table. Lifted from DeckListPage.tsx lines 775-823.
//
// RENAMES APPLIED:
//   () => void loadPublishJobs()  -> onRefresh()
//   publishJobs.length            -> jobs.length
//   publishJobs.map               -> jobs.map
//
// The `activeTab === 'publishJobs' && superAdmin` gate that decides whether this
// panel exists at all stays on the page. Pushing it in here would mean mounting
// a component so that it can return null.
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
import { safeDateTime } from '../../pages/deckListManifest';

export interface PublishJobsPanelProps {
  jobs: PublishJob[];
  onRefresh: () => void;
}

export function PublishJobsPanel({ jobs, onRefresh }: PublishJobsPanelProps) {
  return (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Recent Publish Jobs</h3>
              <button
                type="button"
                onClick={() => onRefresh()}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Refresh
              </button>
            </div>
            <div className="overflow-auto">
              {jobs.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">No publish jobs yet.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-medium">
                    <tr>
                      <th className="px-4 py-3 text-left">Job ID</th>
                      <th className="px-4 py-3 text-left">Deck</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Note</th>
                      <th className="px-4 py-3 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {jobs.map(job => (
                      <tr key={job.jobId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{job.jobId.slice(0, 8)}...</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{job.deckSlug}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${
                            job.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' :
                            job.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                            job.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">{job.note || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{safeDateTime(job.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
  );
}

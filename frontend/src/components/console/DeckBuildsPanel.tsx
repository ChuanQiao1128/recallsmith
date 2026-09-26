// src/components/console/DeckBuildsPanel.tsx
//
// The super-admin builds panel on DeckEditPage. It lists a deck's SUCCESS builds
// (fetched only when asked, so the page's characterization tests do not gain a
// mount-time network call), lets a super admin roll the live pointer back to an
// older build behind a typed confirmation, and exposes the two all-decks
// maintenance actions — rebuild manifest, reap stuck jobs — that until now only
// existed as a curl-with-a-JWT during an incident.

import { useState } from 'react';

import { useConfirm } from '../ui/ConfirmDialogContext';
import {
  fetchDeckBuilds,
  rollbackDeck,
  rebuildManifest,
  reapStuckPublishJobs,
  type DeckBuild,
  type DeckBuildsData,
  type DeckRollbackResult,
  type ManifestRebuildResult,
  type PublishReapResult,
} from '../../api/authoring';

type Feedback = { kind: 'ok' | 'err'; text: string };

export function DeckBuildsPanel({ deckId, deckSlug }: { deckId: number; deckSlug: string }) {
  // useConfirm falls back to window.confirm when no provider is above it, but the
  // real app (and this panel's tests) mount it inside ConfirmDialogProvider, so
  // the typed phrase below is actually enforced.
  const confirm = useConfirm();

  const [data, setData] = useState<DeckBuildsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // One in-flight action at a time per button. The rollback key is the build id
  // so only the row being rolled back is disabled, not every row.
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [reaping, setReaping] = useState(false);

  const loaded = data !== null;

  async function loadBuilds(): Promise<void> {
    setLoading(true);
    setListError(null);
    const res = await fetchDeckBuilds(deckId);
    setLoading(false);
    if (!res.success || !res.data) {
      setListError(res.error?.message ?? 'Failed to load builds.');
      return;
    }
    setData(res.data);
  }

  async function handleRollback(build: DeckBuild): Promise<void> {
    // This action spends a confirmPhrase — the friction reserved for the one bar
    // ConfirmDialogContext.ts draws around "other people's data" — because a
    // rollback changes what every app user downloads on their next manifest
    // check, not just a row this admin owns.
    const okToGo = await confirm({
      title: `Roll back ${deckSlug} to build ${build.buildId}?`,
      body: 'Every app user gets this build on their next manifest check. The current live build stays in this list, so you can roll forward again.',
      destructive: true,
      confirmLabel: 'Roll back',
      confirmPhrase: deckSlug,
    });
    if (!okToGo) return;

    setRollingBack(build.buildId);
    setFeedback(null);
    const res = await rollbackDeck(deckId, build.buildId);
    setRollingBack(null);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Rollback failed.' });
      return;
    }
    const result: DeckRollbackResult = res.data;
    setFeedback({ kind: 'ok', text: `Rolled back. Live build is now ${result.liveBuildId}.` });
    await loadBuilds();
  }

  async function handleRebuild(): Promise<void> {
    const okToGo = await confirm({
      title: 'Rebuild manifest.json now?',
      body: 'Regenerates the manifest every app reads, from the current database state.',
      confirmLabel: 'Rebuild',
    });
    if (!okToGo) return;

    setRebuilding(true);
    setFeedback(null);
    const res = await rebuildManifest();
    setRebuilding(false);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Manifest rebuild failed.' });
      return;
    }
    const result: ManifestRebuildResult = res.data;
    setFeedback({ kind: 'ok', text: `Manifest rebuilt: ${result.deckCount} decks.` });
  }

  async function handleReap(): Promise<void> {
    const okToGo = await confirm({
      title: 'Mark stuck publish jobs as failed?',
      body: 'Fails PENDING jobs older than 10 minutes and PROCESSING jobs idle for 30 minutes, so their decks can be published again.',
      confirmLabel: 'Reap',
    });
    if (!okToGo) return;

    setReaping(true);
    setFeedback(null);
    const res = await reapStuckPublishJobs();
    setReaping(false);
    if (!res.success || !res.data) {
      setFeedback({ kind: 'err', text: res.error?.message ?? 'Reap failed.' });
      return;
    }
    const result: PublishReapResult = res.data;
    const text =
      result.pending === 0 && result.processing === 0
        ? 'No stuck jobs found.'
        : `Reaped ${result.pending} pending and ${result.processing} processing jobs.`;
    setFeedback({ kind: 'ok', text });
  }

  const builds = data?.builds ?? [];

  return (
    <section
      aria-labelledby="deck-builds-heading"
      className="mt-6 bg-white border border-slate-200 rounded-lg shadow-sm p-4"
    >
      <h2 id="deck-builds-heading" className="text-lg font-semibold text-slate-900">
        Builds
      </h2>
      <p className="text-sm text-slate-600 mt-1">
        Every successful publish of this deck. Rolling back points the app at an older build and rebuilds the manifest.
      </p>

      <div className="mt-3">
        <button
          type="button"
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={() => void loadBuilds()}
        >
          {loaded ? 'Refresh builds' : 'Show builds'}
        </button>
      </div>

      {loading ? <div className="mt-3 text-sm text-slate-600">Loading builds…</div> : null}

      {listError ? (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{listError}</div>
      ) : null}

      {feedback ? (
        <div
          className={
            feedback.kind === 'ok'
              ? 'mt-3 bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm'
              : 'mt-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm'
          }
        >
          {feedback.text}
        </div>
      ) : null}

      {loaded && !loading ? (
        builds.length === 0 ? (
          <div className="mt-3 text-sm text-slate-600">No successful builds yet.</div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 border border-slate-100 rounded-md">
            {builds.map((build: DeckBuild) => (
              <li key={build.buildId} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-mono text-slate-900 truncate">{build.buildId}</div>
                  <div className="text-xs text-slate-500">{build.createdAt}</div>
                  {build.note ? <div className="text-xs text-slate-600 mt-0.5">{build.note}</div> : null}
                </div>

                {build.isLive ? (
                  <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 font-medium">Live</span>
                ) : (
                  <button
                    type="button"
                    disabled={rollingBack === build.buildId}
                    className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={() => void handleRollback(build)}
                  >
                    Roll back to this build
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}

      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Maintenance (all decks)</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={rebuilding}
            className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void handleRebuild()}
          >
            Rebuild manifest
          </button>
          <button
            type="button"
            disabled={reaping}
            className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void handleReap()}
          >
            Reap stuck jobs
          </button>
        </div>
      </div>
    </section>
  );
}

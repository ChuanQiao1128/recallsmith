// src/features/automation/WatchTab.tsx
//
// The Watch tab (A00 §8.6): the watched pages and feeds and their recent
// events. `?tab=watch&targetId=` (the source.changed webhook's link) marks the
// target's row. A super_admin may add a feed, toggle a target and edit its
// title pattern and interval. The pattern is a PostgreSQL regular expression,
// so only the server can say whether it compiles (WATCH_PATTERN_INVALID).
import { useEffect, useState } from 'react';

import { addWatchTarget, fetchWatch, updateWatchTarget, type WatchPage } from '../../api/automation';
import { fetchDecks } from '../../api/authoring';
import {
  CARD_CLASS,
  FIELD_ERROR_CLASS,
  H2_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  TD_CLASS,
  TH_CLASS,
} from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  FEED_FORMATS,
  automationErrorMessage,
  formatTimestamp,
  orDash,
  shortId,
  urlLabel,
  watchTargetProblems,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import type { Deck } from '../../types/deck';

const PAGE_SIZE = 50;
const DEFAULT_INTERVAL = '360';
const URL_ID = 'automation-watch-url';
const FORMAT_ID = 'automation-watch-format';
const DECK_ID = 'automation-watch-deck';
const PATTERN_ID = 'automation-watch-pattern';
const INTERVAL_ID = 'automation-watch-interval';
const PROBLEMS_ID = 'automation-watch-problems';

type WatchState = { forKey: string | null; error: string | null; data: WatchPage | null };
type EditState = { targetId: number; pattern: string; interval: string; problem: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

function editProblem(pattern: string, interval: number): string | null {
  if (pattern.length > 1000) return 'The title pattern must be at most 1000 characters.';
  if (!Number.isInteger(interval) || interval < 60 || interval > 43200) {
    return 'The check interval must be a whole number of minutes from 60 to 43200.';
  }
  return null;
}

export function WatchTab({
  superAdmin,
  targetId,
  announce,
}: {
  superAdmin: boolean;
  targetId: number | null;
  announce: (text: string) => void;
}) {
  const [nonce, setNonce] = useState(0);
  const [watch, setWatch] = useState<WatchState>({ forKey: null, error: null, data: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [url, setUrl] = useState('');
  const [feedFormat, setFeedFormat] = useState<string>(FEED_FORMATS[0]);
  const [deckId, setDeckId] = useState('');
  const [pattern, setPattern] = useState('');
  const [intervalText, setIntervalText] = useState(DEFAULT_INTERVAL);
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);

  const key = String(nonce);

  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    async function run() {
      const res = await fetchDecks();
      if (cancelled || !res.success || !res.data) return;
      setDecks(res.data);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [superAdmin]);

  useEffect(() => {
    let cancelled = false;
    const forKey = String(nonce);
    async function run() {
      const res = await fetchWatch({ limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setWatch({ forKey, error: errorText(res.error, 'Failed to load the watched sources.'), data: null });
        return;
      }
      setWatch({ forKey, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  async function onLoadMore() {
    const cursor = watch.data?.nextCursor;
    if (!cursor) return;
    setLoadingMore(true);
    const res = await fetchWatch({ limit: PAGE_SIZE, cursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'Failed to load more targets.'));
      return;
    }
    const page = res.data;
    setWatch(prev =>
      prev.data
        ? { ...prev, data: { ...prev.data, items: [...prev.data.items, ...page.items], nextCursor: page.nextCursor } }
        : prev,
    );
  }

  async function onAdd() {
    const deck = deckId ? Number(deckId) : null;
    const minutes = Number(intervalText);
    const found = watchTargetProblems({
      url,
      feedFormat,
      deckId: deck,
      itemTitlePattern: pattern,
      checkIntervalMinutes: minutes,
    });
    setProblems(found);
    setWriteError(null);
    if (found.length > 0 || deck === null) return;
    setBusy(true);
    const res = await addWatchTarget({
      url: url.trim(),
      feedFormat,
      deckId: deck,
      itemTitlePattern: pattern === '' ? null : pattern,
      checkIntervalMinutes: minutes,
    });
    setBusy(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'The feed could not be added.'));
      return;
    }
    setUrl('');
    setPattern('');
    setIntervalText(DEFAULT_INTERVAL);
    announce(`Feed ${res.data.targetId} added.`);
    setNonce(n => n + 1);
  }

  async function onToggle(id: number, active: boolean) {
    setWriteError(null);
    setBusy(true);
    const res = await updateWatchTarget(id, { active });
    setBusy(false);
    if (!res.success) {
      setWriteError(errorText(res.error, 'The target could not be changed.'));
      return;
    }
    announce(`Target ${id} ${active ? 'activated' : 'deactivated'}.`);
    setNonce(n => n + 1);
  }

  async function onSaveEdit() {
    if (!editing) return;
    const minutes = Number(editing.interval);
    const problem = editProblem(editing.pattern, minutes);
    if (problem) {
      setEditing({ ...editing, problem });
      return;
    }
    setWriteError(null);
    setBusy(true);
    const res = await updateWatchTarget(editing.targetId, {
      itemTitlePattern: editing.pattern === '' ? null : editing.pattern,
      checkIntervalMinutes: minutes,
    });
    setBusy(false);
    if (!res.success) {
      setWriteError(errorText(res.error, 'The target could not be changed.'));
      return;
    }
    announce(`Target ${editing.targetId} saved.`);
    setEditing(null);
    setNonce(n => n + 1);
  }

  const loading = watch.forKey !== key;
  const targets = watch.data?.items ?? [];
  const events = watch.data?.recentEvents ?? [];

  return (
    <div className="space-y-4">
      {superAdmin ? (
        <section className={CARD_CLASS} aria-label="Add a feed">
          <h2 className={H2_CLASS}>Add a feed</h2>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor={URL_ID} className={LABEL_CLASS}>
                Feed URL
              </label>
              <input
                id={URL_ID}
                type="url"
                className={INPUT_CLASS}
                value={url}
                onChange={e => setUrl(e.target.value)}
                aria-describedby={problems.length > 0 ? PROBLEMS_ID : undefined}
              />
            </div>
            <div>
              <label htmlFor={FORMAT_ID} className={LABEL_CLASS}>
                Feed format
              </label>
              <select
                id={FORMAT_ID}
                className={INPUT_CLASS}
                value={feedFormat}
                onChange={e => setFeedFormat(e.target.value)}
              >
                {FEED_FORMATS.map(f => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={DECK_ID} className={LABEL_CLASS}>
                Deck
              </label>
              <select id={DECK_ID} className={INPUT_CLASS} value={deckId} onChange={e => setDeckId(e.target.value)}>
                <option value="">Choose a deck</option>
                {decks.map(d => (
                  <option key={d.id} value={String(d.id)}>
                    {d.slug}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={PATTERN_ID} className={LABEL_CLASS}>
                Title pattern (PostgreSQL regex)
              </label>
              <input
                id={PATTERN_ID}
                className={`${INPUT_CLASS} font-mono`}
                value={pattern}
                onChange={e => setPattern(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={INTERVAL_ID} className={LABEL_CLASS}>
                Check interval (minutes)
              </label>
              <input
                id={INTERVAL_ID}
                type="number"
                min={60}
                max={43200}
                className={INPUT_CLASS}
                value={intervalText}
                onChange={e => setIntervalText(e.target.value)}
              />
            </div>
          </div>
          {problems.length > 0 ? (
            <div id={PROBLEMS_ID} className="mt-2">
              {problems.map(p => (
                <p key={p} className={FIELD_ERROR_CLASS} role="alert">
                  {p}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-2">
            <Button size="xs" disabled={busy} onClick={() => void onAdd()}>
              Add feed
            </Button>
          </div>
        </section>
      ) : null}

      {writeError ? (
        <Callout tone="danger" role="alert">
          {writeError}
        </Callout>
      ) : null}

      <section className={CARD_CLASS} aria-label="Watched sources">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Watched sources</h2>
          <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
            Refresh
          </Button>
        </div>

        {watch.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {watch.error}
            </Callout>
          </div>
        ) : null}
        {watch.data && targets.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">Nothing is watched yet.</p>
        ) : null}

        {targets.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Target</th>
                  <th className={TH_CLASS}>Kind</th>
                  <th className={TH_CLASS}>URL</th>
                  <th className={TH_CLASS}>Feed format</th>
                  <th className={TH_CLASS}>Deck</th>
                  <th className={TH_CLASS}>Active</th>
                  <th className={TH_CLASS}>Interval (min)</th>
                  <th className={TH_CLASS}>Last checked</th>
                  <th className={TH_CLASS}>Last status</th>
                  <th className={TH_CLASS}>HTTP</th>
                  <th className={TH_CLASS}>Failures</th>
                  <th className={TH_CLASS}>Citing cards</th>
                  {superAdmin ? <th className={TH_CLASS}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {targets.map(t => {
                  const marked = t.targetId === targetId;
                  const edit = editing && editing.targetId === t.targetId ? editing : null;
                  return (
                    <tr
                      key={t.targetId}
                      className={`border-t border-slate-100 align-top${marked ? ' bg-indigo-50' : ''}`}
                      aria-current={marked ? 'true' : undefined}
                      data-testid={`automation-watch-target-${t.targetId}`}
                    >
                      <td className={TD_CLASS}>{t.targetId}</td>
                      <td className={TD_CLASS}>{t.kind}</td>
                      <td className={TD_CLASS}>
                        <a href={t.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                          {urlLabel(t.url)}
                        </a>
                        {t.itemTitlePattern ? (
                          <div className="text-xs text-slate-500 font-mono break-all">{t.itemTitlePattern}</div>
                        ) : null}
                      </td>
                      <td className={TD_CLASS}>{orDash(t.feedFormat)}</td>
                      <td className={TD_CLASS}>{orDash(t.deckSlug)}</td>
                      <td className={TD_CLASS}>{t.active ? 'yes' : 'no'}</td>
                      <td className={TD_CLASS}>{t.checkIntervalMinutes}</td>
                      <td className={TD_CLASS}>{formatTimestamp(t.lastCheckedAt)}</td>
                      <td className={TD_CLASS}>{orDash(t.lastStatus)}</td>
                      <td className={TD_CLASS}>{orDash(t.lastHttpStatus)}</td>
                      <td className={TD_CLASS}>{t.consecutiveFailures}</td>
                      <td className={TD_CLASS}>{t.citingCards}</td>
                      {superAdmin ? (
                        <td className={TD_CLASS}>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={busy}
                              onClick={() => void onToggle(t.targetId, !t.active)}
                            >
                              {t.active ? 'Deactivate' : 'Activate'}
                            </Button>
                            {edit ? null : (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() =>
                                  setEditing({
                                    targetId: t.targetId,
                                    pattern: t.itemTitlePattern ?? '',
                                    interval: String(t.checkIntervalMinutes),
                                    problem: null,
                                  })
                                }
                              >
                                Edit
                              </Button>
                            )}
                          </div>
                          {edit ? (
                            <div className="mt-2 space-y-2 min-w-[16rem]">
                              <div>
                                <label htmlFor={`${PATTERN_ID}-${t.targetId}`} className={LABEL_CLASS}>
                                  Title pattern (PostgreSQL regex)
                                </label>
                                <input
                                  id={`${PATTERN_ID}-${t.targetId}`}
                                  className={`${INPUT_CLASS} font-mono`}
                                  value={edit.pattern}
                                  onChange={e => setEditing({ ...edit, pattern: e.target.value, problem: null })}
                                />
                              </div>
                              <div>
                                <label htmlFor={`${INTERVAL_ID}-${t.targetId}`} className={LABEL_CLASS}>
                                  Check interval (minutes)
                                </label>
                                <input
                                  id={`${INTERVAL_ID}-${t.targetId}`}
                                  type="number"
                                  min={60}
                                  max={43200}
                                  className={INPUT_CLASS}
                                  value={edit.interval}
                                  onChange={e => setEditing({ ...edit, interval: e.target.value, problem: null })}
                                />
                              </div>
                              {edit.problem ? (
                                <p className={FIELD_ERROR_CLASS} role="alert">
                                  {edit.problem}
                                </p>
                              ) : null}
                              <div className="flex gap-1">
                                <Button size="xs" disabled={busy} onClick={() => void onSaveEdit()}>
                                  Save
                                </Button>
                                <Button variant="ghost" size="xs" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {watch.data?.nextCursor ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      <section className={CARD_CLASS} aria-label="Recent watch events">
        <h2 className={H2_CLASS}>Recent events</h2>
        {watch.data && events.length === 0 ? <p className="text-sm text-slate-600 mt-2">No event yet.</p> : null}
        {events.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Kind</th>
                  <th className={TH_CLASS}>URL</th>
                  <th className={TH_CLASS}>Re-check</th>
                  <th className={TH_CLASS}>Re-check runs</th>
                  <th className={TH_CLASS}>Queue items</th>
                  <th className={TH_CLASS}>Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.eventId} className="border-t border-slate-100 align-top">
                    <td className={TD_CLASS}>{e.kind}</td>
                    <td className={TD_CLASS}>{urlLabel(e.url)}</td>
                    <td className={TD_CLASS}>{e.recheckState}</td>
                    <td className={`${TD_CLASS} font-mono`}>
                      {e.recheckRunIds.length === 0 ? '—' : e.recheckRunIds.map(shortId).join(', ')}
                    </td>
                    <td className={TD_CLASS}>{e.queueItemIds.length === 0 ? '—' : e.queueItemIds.join(', ')}</td>
                    <td className={TD_CLASS}>{formatTimestamp(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

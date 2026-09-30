// src/features/automation/WatchTab.tsx
//
// The Watch tab (A00 §8.6): the watched pages and feeds and their recent
// events. `?tab=watch&targetId=` (the source.changed webhook's link) marks the
// target's row. A super_admin may add a feed, toggle a target and edit its
// title pattern and interval. The pattern is a PostgreSQL regular expression,
// so only the server can say whether it compiles (WATCH_PATTERN_INVALID).
//
// The marked row scrolls into view once the list loads, and a target that is
// not on the loaded pages says so (C07 frontend-console-19). Edit moves focus
// into the editor, and Save or Cancel returns it to the row's Edit button
// (C07 frontend-console-18).
//
// Change impact (R20 V07/V10): an event may list its affected cards (the cards
// citing the changed page, each linked to the editor, with a "Quote missing"
// badge when the supporting quote left the page) and carry "Needs review" when
// the AI QA re-check was unavailable. "Recent release notes" lists new feed
// items with the cards they may touch. Every one of these is optional: a server
// that predates them sends none, and the tab looks as it did.
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  addWatchTarget,
  fetchWatch,
  updateWatchTarget,
  watchCardEditorHref,
  type WatchAffectedCard,
  type WatchFeedItem,
  type WatchPage,
} from '../../api/automation';
import {
  CARD_CLASS,
  FIELD_ERROR_CLASS,
  H2_CLASS,
  INPUT_CLASS,
  INPUT_INVALID_CLASS,
  LABEL_CLASS,
  TD_CLASS,
  TH_CLASS,
} from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  FEED_FORMATS,
  FEED_FORMAT_LABELS,
  RECHECK_STATE_LABELS,
  WATCH_EVENT_KIND_LABELS,
  WATCH_KIND_LABELS,
  WATCH_STATUS_LABELS,
  automationErrorMessage,
  codeLabel,
  formatTimestamp,
  orDash,
  shortId,
  urlLabel,
  watchEditProblem,
  watchTargetFieldProblems,
  type FieldProblem,
  type WatchField,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import { DeckSelect } from './DeckSelect';

const PAGE_SIZE = 50;
const DEFAULT_INTERVAL = '360';
const URL_ID = 'automation-watch-url';
const FORMAT_ID = 'automation-watch-format';
const DECK_ID = 'automation-watch-deck';
const PATTERN_ID = 'automation-watch-pattern';
const INTERVAL_ID = 'automation-watch-interval';
const PROBLEMS_ID = 'automation-watch-problems';
const EDIT_PROBLEM_ID = 'automation-watch-edit-problem';

const EVENT_COLUMNS = 6;

/** The card's question (or its stable uid) linked to the editor; plain text when its deck is unknown. */
function CardLink({ card }: { card: { cardId: number; deckId: number | null; question: string; stableUid: string } }) {
  const name = card.question || card.stableUid || `Card ${card.cardId}`;
  const href = watchCardEditorHref(card);
  return href ? (
    <Link to={href} className="text-indigo-700 underline" aria-label={`Open in editor: ${name}`}>
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}

function AffectedCardList({ eventId, cards }: { eventId: number; cards: WatchAffectedCard[] }) {
  return (
    <div data-testid={`automation-watch-affected-${eventId}`}>
      <div className="text-xs font-semibold text-slate-700">Affected cards ({cards.length})</div>
      <ul className="mt-1 space-y-1" aria-label={`Cards affected by event ${eventId}`}>
        {cards.map(c => (
          <li key={c.cardId} className="flex flex-wrap items-center gap-2">
            <CardLink card={c} />
            {c.deckSlug ? <span className="text-xs text-slate-500">{c.deckSlug}</span> : null}
            {c.quoteMissing ? <Badge tone="warning">Quote missing</Badge> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeedItemRow({ item }: { item: WatchFeedItem }) {
  return (
    <li className="border-t border-slate-100 pt-2" data-testid={`automation-watch-feed-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
            {item.title || urlLabel(item.url)}
          </a>
        ) : (
          <span>{item.title || `Item ${item.id}`}</span>
        )}
        <span className="text-xs text-slate-500">First seen {formatTimestamp(item.firstSeenAt)}</span>
      </div>
      {item.possiblyAffectedCards.length === 0 ? (
        <p className="text-xs text-slate-500 mt-1">No card matched this item.</p>
      ) : (
        <ul className="mt-1 ml-4 list-disc space-y-1" aria-label={`Cards possibly affected by ${item.title || `item ${item.id}`}`}>
          {item.possiblyAffectedCards.map(c => (
            <li key={c.cardId}>
              <CardLink card={c} />
              {c.deckSlug ? <span className="text-xs text-slate-500"> · {c.deckSlug}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Each problem's own id, so a field announces only its own message (D07 frontend-console-28). */
function problemId(field: WatchField): string {
  return `${PROBLEMS_ID}-${field}`;
}

type WatchState = { forKey: string | null; error: string | null; data: WatchPage | null };
type EditState = {
  targetId: number;
  pattern: string;
  interval: string;
  problem: FieldProblem<'itemTitlePattern' | 'checkIntervalMinutes'> | null;
};

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

/** DeckSelect's spelling of invalidProps. */
function deckInvalidProps(invalid: boolean) {
  return {
    className: invalid ? INPUT_INVALID_CLASS : INPUT_CLASS,
    invalid,
    describedBy: invalid ? problemId('deckId') : undefined,
  };
}

/** aria-invalid, the invalid look and the message link for a field that failed its check. */
function invalidProps(invalid: boolean, describedBy: string, extraClass = '') {
  const base = invalid ? INPUT_INVALID_CLASS : INPUT_CLASS;
  return {
    className: extraClass ? `${base} ${extraClass}` : base,
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': invalid ? describedBy : undefined,
  };
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
  // A Load more failure and busy state belong to the list they were asked for
  // (the Decisions pattern), so a filter change hides them (C07 frontend-console-20).
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{ forKey: string; text: string } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [url, setUrl] = useState('');
  const [feedFormat, setFeedFormat] = useState<string>(FEED_FORMATS[0]);
  const [deckId, setDeckId] = useState('');
  const [pattern, setPattern] = useState('');
  const [intervalText, setIntervalText] = useState(DEFAULT_INTERVAL);
  const [problems, setProblems] = useState<Array<FieldProblem<WatchField>>>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const tableSectionRef = useRef<HTMLElement>(null);
  const editedRef = useRef<number | null>(null);
  const scrolledToRef = useRef<number | null>(null);

  const key = String(nonce);
  const editingId = editing?.targetId ?? null;

  useEffect(() => {
    const closed = editedRef.current;
    editedRef.current = editingId;
    const section = tableSectionRef.current;
    if (!section) return;
    if (editingId !== null) {
      section.querySelector<HTMLElement>(`#${PATTERN_ID}-${editingId}`)?.focus();
    } else if (closed !== null) {
      section.querySelector<HTMLElement>(`button[aria-label="Edit target ${closed}"]`)?.focus();
    }
  }, [editingId]);

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

  const loading = watch.forKey !== key;

  async function onLoadMore() {
    const cursor = watch.data?.nextCursor;
    // The cursor belongs to the list on screen; while a refresh loads it may be stale.
    if (!cursor || loading) return;
    const startKey = key;
    setLoadingMoreKey(startKey);
    setMoreError(null);
    const res = await fetchWatch({ limit: PAGE_SIZE, cursor });
    setLoadingMoreKey(k => (k === startKey ? null : k));
    if (!res.success || !res.data) {
      setMoreError({ forKey: startKey, text: errorText(res.error, 'Failed to load more targets.') });
      return;
    }
    const page = res.data;
    setWatch(prev =>
      prev.data && prev.forKey === startKey
        ? { ...prev, data: { ...prev.data, items: [...prev.data.items, ...page.items], nextCursor: page.nextCursor } }
        : prev,
    );
  }

  async function onAdd() {
    const deck = deckId ? Number(deckId) : null;
    const minutes = Number(intervalText);
    const found = watchTargetFieldProblems({
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
      const text = errorText(res.error, 'The feed could not be added.');
      // Only PostgreSQL can compile the pattern, so its refusal belongs to that field.
      if (res.error?.code === 'WATCH_PATTERN_INVALID') setProblems([{ field: 'itemTitlePattern', message: text }]);
      else setWriteError(text);
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
    const problem = watchEditProblem(editing.pattern, minutes);
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
      const text = errorText(res.error, 'The target could not be changed.');
      if (res.error?.code === 'WATCH_PATTERN_INVALID') {
        setEditing({ ...editing, problem: { field: 'itemTitlePattern', message: text } });
      } else {
        setWriteError(text);
      }
      return;
    }
    announce(`Target ${editing.targetId} saved.`);
    setEditing(null);
    setNonce(n => n + 1);
  }

  const targets = watch.data?.items ?? [];
  const events = watch.data?.recentEvents ?? [];
  const feedItems = watch.data?.recentFeedItems;
  const markedLoaded = targetId !== null && targets.some(t => t.targetId === targetId);

  // Once per linked target: the row the source.changed link names, in view.
  useEffect(() => {
    if (targetId === null || !markedLoaded || scrolledToRef.current === targetId) return;
    scrolledToRef.current = targetId;
    tableSectionRef.current
      ?.querySelector(`[data-testid="automation-watch-target-${targetId}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [targetId, markedLoaded]);
  const failed = (field: WatchField) => problems.some(p => p.field === field);

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
                {...invalidProps(failed('url'), problemId('url'))}
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={FORMAT_ID} className={LABEL_CLASS}>
                Feed format
              </label>
              <select
                id={FORMAT_ID}
                {...invalidProps(failed('feedFormat'), problemId('feedFormat'))}
                value={feedFormat}
                onChange={e => setFeedFormat(e.target.value)}
              >
                {FEED_FORMATS.map(f => (
                  <option key={f} value={f}>
                    {codeLabel(FEED_FORMAT_LABELS, f)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={DECK_ID} className={LABEL_CLASS}>
                Deck
              </label>
              <DeckSelect
                id={DECK_ID}
                value={deckId}
                onChange={setDeckId}
                emptyLabel="Choose a deck"
                {...deckInvalidProps(failed('deckId'))}
              />
            </div>
            <div>
              <label htmlFor={PATTERN_ID} className={LABEL_CLASS}>
                Title pattern (PostgreSQL regex)
              </label>
              <input
                id={PATTERN_ID}
                {...invalidProps(failed('itemTitlePattern'), problemId('itemTitlePattern'), 'font-mono')}
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
                {...invalidProps(failed('checkIntervalMinutes'), problemId('checkIntervalMinutes'))}
                value={intervalText}
                onChange={e => setIntervalText(e.target.value)}
              />
            </div>
          </div>
          {problems.length > 0 ? (
            <div id={PROBLEMS_ID} className="mt-2">
              {problems.map(p => (
                <p key={p.field} id={problemId(p.field)} className={FIELD_ERROR_CLASS} role="alert">
                  {p.message}
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

      <section ref={tableSectionRef} className={CARD_CLASS} aria-label="Watched sources">
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
        {watch.data && !loading && targetId !== null && !markedLoaded ? (
          <p className="text-sm text-slate-700 mt-2" role="status" data-testid="automation-watch-target-missing">
            {watch.data.nextCursor
              ? `Target ${targetId} is not on the loaded pages. Load more to look further.`
              : `Target ${targetId} is not in the list.`}
          </p>
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
                      <td className={TD_CLASS}>{codeLabel(WATCH_KIND_LABELS, t.kind)}</td>
                      <td className={TD_CLASS}>
                        <a href={t.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                          {urlLabel(t.url)}
                        </a>
                        {t.itemTitlePattern ? (
                          <div className="text-xs text-slate-600 font-mono break-all">{t.itemTitlePattern}</div>
                        ) : null}
                      </td>
                      <td className={TD_CLASS}>{t.feedFormat ? codeLabel(FEED_FORMAT_LABELS, t.feedFormat) : '—'}</td>
                      <td className={TD_CLASS}>{orDash(t.deckSlug)}</td>
                      <td className={TD_CLASS}>{t.active ? 'yes' : 'no'}</td>
                      <td className={TD_CLASS}>{t.checkIntervalMinutes}</td>
                      <td className={TD_CLASS}>{formatTimestamp(t.lastCheckedAt)}</td>
                      <td className={TD_CLASS}>{codeLabel(WATCH_STATUS_LABELS, t.lastStatus)}</td>
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
                              aria-label={`${t.active ? 'Deactivate' : 'Activate'} target ${t.targetId}`}
                              onClick={() => void onToggle(t.targetId, !t.active)}
                            >
                              {t.active ? 'Deactivate' : 'Activate'}
                            </Button>
                            {edit ? null : (
                              <Button
                                variant="outline"
                                size="xs"
                                aria-label={`Edit target ${t.targetId}`}
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
                                  {...invalidProps(edit.problem?.field === 'itemTitlePattern', EDIT_PROBLEM_ID, 'font-mono')}
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
                                  {...invalidProps(edit.problem?.field === 'checkIntervalMinutes', EDIT_PROBLEM_ID)}
                                  value={edit.interval}
                                  onChange={e => setEditing({ ...edit, interval: e.target.value, problem: null })}
                                />
                              </div>
                              {edit.problem ? (
                                <p id={EDIT_PROBLEM_ID} className={FIELD_ERROR_CLASS} role="alert">
                                  {edit.problem.message}
                                </p>
                              ) : null}
                              <div className="flex gap-1">
                                <Button
                                  size="xs"
                                  disabled={busy}
                                  aria-label={`Save target ${t.targetId}`}
                                  onClick={() => void onSaveEdit()}
                                >
                                  Save
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  aria-label={`Cancel editing target ${t.targetId}`}
                                  onClick={() => setEditing(null)}
                                >
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

        {moreError && moreError.forKey === key ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {moreError.text}
            </Callout>
          </div>
        ) : null}
        {watch.data?.nextCursor && !loading ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMoreKey === key} onClick={() => void onLoadMore()}>
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
                  <Fragment key={e.eventId}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className={TD_CLASS}>
                        {codeLabel(WATCH_EVENT_KIND_LABELS, e.kind)}
                        {e.needsHumanReview === true ? (
                          <>
                            {' '}
                            <Badge tone="warning">Needs review</Badge>
                          </>
                        ) : null}
                      </td>
                      <td className={TD_CLASS}>{urlLabel(e.url)}</td>
                      <td className={TD_CLASS}>{codeLabel(RECHECK_STATE_LABELS, e.recheckState)}</td>
                      <td className={`${TD_CLASS} font-mono`}>
                        {e.recheckRunIds.length === 0 ? '—' : e.recheckRunIds.map(shortId).join(', ')}
                      </td>
                      <td className={TD_CLASS}>{e.queueItemIds.length === 0 ? '—' : e.queueItemIds.join(', ')}</td>
                      <td className={TD_CLASS}>{formatTimestamp(e.createdAt)}</td>
                    </tr>
                    {e.affectedCards && e.affectedCards.length > 0 ? (
                      <tr className="align-top">
                        <td className={TD_CLASS} colSpan={EVENT_COLUMNS}>
                          <AffectedCardList eventId={e.eventId} cards={e.affectedCards} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {feedItems ? (
        <section className={CARD_CLASS} aria-label="Recent release notes">
          <h2 className={H2_CLASS}>Recent release notes</h2>
          {feedItems.length === 0 ? (
            <p className="text-sm text-slate-600 mt-2">No release-notes item yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {feedItems.map(item => (
                <FeedItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

// src/features/automation/QueueTab.tsx
//
// The Queue tab (A00 §8.6): the authoring queue the local runner pulls. A
// super_admin may add a URL for a deck and skip a queued item.
import { useEffect, useState } from 'react';

import { addQueueItem, listQueueItems, skipQueueItem, type QueueItem } from '../../api/automation';
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
import { useConfirm } from '../../components/ui/ConfirmDialogContext';
import {
  QUEUE_ITEM_STATUSES,
  automationErrorMessage,
  formatTimestamp,
  orDash,
  queueItemProblems,
  shortId,
  urlLabel,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import type { Deck } from '../../types/deck';

const PAGE_SIZE = 50;
const STATUS_ID = 'automation-queue-status';
const URL_ID = 'automation-queue-url';
const DECK_ID = 'automation-queue-deck';
const TITLE_ID = 'automation-queue-title';
const NOTE_ID = 'automation-queue-note';
const PROBLEMS_ID = 'automation-queue-problems';

type ListState = { forKey: string | null; error: string | null; items: QueueItem[]; nextCursor: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

export function QueueTab({ superAdmin, announce }: { superAdmin: boolean; announce: (text: string) => void }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState('');
  const [nonce, setNonce] = useState(0);
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);

  const [url, setUrl] = useState('');
  const [deckId, setDeckId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = `${status}|${nonce}`;

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
    const forKey = `${status}|${nonce}`;
    async function run() {
      const res = await listQueueItems({ status: status || undefined, limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setList({ forKey, error: errorText(res.error, 'Failed to load the queue.'), items: [], nextCursor: null });
        return;
      }
      setList({ forKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [status, nonce]);

  async function onLoadMore() {
    if (!list.nextCursor) return;
    setLoadingMore(true);
    const res = await listQueueItems({ status: status || undefined, limit: PAGE_SIZE, cursor: list.nextCursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'Failed to load more queue items.'));
      return;
    }
    const page = res.data;
    setList(prev => ({ ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  async function onAdd() {
    const deck = deckId ? Number(deckId) : null;
    const found = queueItemProblems({ url, deckId: deck, title, note });
    setProblems(found);
    setWriteError(null);
    if (found.length > 0 || deck === null) return;
    setBusy(true);
    const res = await addQueueItem({ url: url.trim(), deckId: deck, title: title.trim(), note: note.trim() });
    setBusy(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'The URL could not be queued.'));
      return;
    }
    setUrl('');
    setTitle('');
    setNote('');
    announce(`Queue item ${res.data.itemId} added.`);
    setNonce(n => n + 1);
  }

  async function onSkip(itemId: number) {
    const yes = await confirm({ title: 'Skip this queue item?', confirmLabel: 'Skip this item' });
    if (!yes) return;
    setWriteError(null);
    setBusy(true);
    const res = await skipQueueItem(itemId);
    setBusy(false);
    if (!res.success) {
      setWriteError(errorText(res.error, 'The queue item could not be skipped.'));
      return;
    }
    announce(`Queue item ${itemId} skipped.`);
    setNonce(n => n + 1);
  }

  const loading = list.forKey !== key;

  return (
    <div className="space-y-4">
      {superAdmin ? (
        <section className={CARD_CLASS} aria-label="Add to queue">
          <h2 className={H2_CLASS}>Add a URL to the queue</h2>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor={URL_ID} className={LABEL_CLASS}>
                URL
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
              <label htmlFor={TITLE_ID} className={LABEL_CLASS}>
                Title
              </label>
              <input id={TITLE_ID} className={INPUT_CLASS} value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div>
              <label htmlFor={NOTE_ID} className={LABEL_CLASS}>
                Note
              </label>
              <input id={NOTE_ID} className={INPUT_CLASS} value={note} onChange={e => setNote(e.target.value)} />
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
              Add to queue
            </Button>
          </div>
        </section>
      ) : null}

      {writeError ? (
        <Callout tone="danger" role="alert">
          {writeError}
        </Callout>
      ) : null}

      <section className={CARD_CLASS} aria-label="Queue">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Queue</h2>
          <div>
            <label htmlFor={STATUS_ID} className={LABEL_CLASS}>
              Status
            </label>
            <select id={STATUS_ID} className={INPUT_CLASS} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option>
              {QUEUE_ITEM_STATUSES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
            Refresh
          </Button>
        </div>

        {list.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {list.error}
            </Callout>
          </div>
        ) : null}
        {!list.error && !loading && list.items.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">The queue is empty.</p>
        ) : null}

        {list.items.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Item</th>
                  <th className={TH_CLASS}>Kind</th>
                  <th className={TH_CLASS}>URL</th>
                  <th className={TH_CLASS}>Title / section</th>
                  <th className={TH_CLASS}>Deck</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Attempts</th>
                  <th className={TH_CLASS}>Not before</th>
                  <th className={TH_CLASS}>Claimed by</th>
                  <th className={TH_CLASS}>Lease expires</th>
                  <th className={TH_CLASS}>Last run</th>
                  <th className={TH_CLASS}>Last error</th>
                  <th className={TH_CLASS}>Created by</th>
                  <th className={TH_CLASS}>Created</th>
                  {superAdmin ? <th className={TH_CLASS}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.items.map(item => (
                  <tr key={item.itemId} className="border-t border-slate-100 align-top">
                    <td className={TD_CLASS}>{item.itemId}</td>
                    <td className={TD_CLASS}>{item.kind}</td>
                    <td className={TD_CLASS}>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                        {urlLabel(item.url)}
                      </a>
                    </td>
                    <td className={TD_CLASS}>
                      {orDash(item.title)}
                      {item.sectionHint ? <div className="text-xs text-slate-500">{item.sectionHint}</div> : null}
                    </td>
                    <td className={TD_CLASS}>{orDash(item.deckSlug)}</td>
                    <td className={TD_CLASS}>{item.status}</td>
                    <td className={TD_CLASS}>{item.attempts}</td>
                    <td className={TD_CLASS}>{formatTimestamp(item.notBefore)}</td>
                    <td className={TD_CLASS}>{orDash(item.claimedByRunner)}</td>
                    <td className={TD_CLASS}>{formatTimestamp(item.leaseExpiresAt)}</td>
                    <td className={`${TD_CLASS} font-mono`}>{shortId(item.lastRunId)}</td>
                    <td className={TD_CLASS}>{orDash(item.lastError)}</td>
                    <td className={TD_CLASS}>{item.createdBy}</td>
                    <td className={TD_CLASS}>{formatTimestamp(item.createdAt)}</td>
                    {superAdmin ? (
                      <td className={TD_CLASS}>
                        {item.status === 'queued' ? (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy}
                            aria-label={`Skip queue item ${item.itemId}`}
                            onClick={() => void onSkip(item.itemId)}
                          >
                            Skip
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {list.nextCursor ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

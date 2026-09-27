// src/features/automation/EmailTab.tsx
//
// The Email log tab (A00 §8.6, §12.5): every email the automation queued, and
// its plain-text body on demand. The log has no recipient column: the owner
// alert address is known only to the notifier. A super_admin may send a test
// email, which works in every mode.
//
// Show answers only for the email last asked for, marks its button busy while
// the body loads, and moves focus to the body's heading (B07
// frontend-console-4, frontend-console-8). Hide returns focus to the Show
// button it came from, or to the Email log heading when that row is gone
// (C07 frontend-console-18).
//
// `?tab=email&status=queued` opens the log on that status: the Overview's
// unconfirmed-email count links there (K6, L5).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  fetchNotification,
  listNotifications,
  sendTestNotification,
  type AutomationNotification,
  type AutomationNotificationDetail,
} from '../../api/automation';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS, LABEL_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  MODE_LABELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_STATUS_LABELS,
  automationErrorMessage,
  codeLabel,
  formatTimestamp,
  orDash,
  shortId,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';

const PAGE_SIZE = 50;
const KIND_ID = 'automation-email-kind';
const STATUS_ID = 'automation-email-status';

type ListState = {
  forKey: string | null;
  error: string | null;
  items: AutomationNotification[];
  nextCursor: string | null;
};

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

export function EmailTab({ superAdmin, announce }: { superAdmin: boolean; announce: (text: string) => void }) {
  const [searchParams] = useSearchParams();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState(() => {
    const linked = searchParams.get('status') ?? '';
    return (NOTIFICATION_STATUSES as readonly string[]).includes(linked) ? linked : '';
  });
  const [nonce, setNonce] = useState(0);
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  // A Load more failure and busy state belong to the list they were asked for
  // (the Decisions pattern), so a filter change hides them (C07 frontend-console-20).
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{ forKey: string; text: string } | null>(null);
  const [shown, setShown] = useState<AutomationNotificationDetail | null>(null);
  // The email whose body was asked for last; an older answer is dropped.
  const [showing, setShowing] = useState<string | null>(null);
  const requestedRef = useRef<string | null>(null);
  const bodyHeadingRef = useRef<HTMLHeadingElement>(null);
  const listSectionRef = useRef<HTMLElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = `${kind}|${status}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const forKey = `${kind}|${status}|${nonce}`;
    async function run() {
      const res = await listNotifications({ kind: kind || undefined, status: status || undefined, limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setList({ forKey, error: errorText(res.error, 'Failed to load the email log.'), items: [], nextCursor: null });
        return;
      }
      setList({ forKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [kind, status, nonce]);

  const loading = list.forKey !== key;

  useEffect(() => {
    if (!shown) return;
    const heading = bodyHeadingRef.current;
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView?.({ block: 'start' });
  }, [shown]);

  async function onLoadMore() {
    // The cursor belongs to the list on screen; while a new filter loads it is foreign.
    if (!list.nextCursor || loading) return;
    const startKey = key;
    setLoadingMoreKey(startKey);
    setMoreError(null);
    const res = await listNotifications({
      kind: kind || undefined,
      status: status || undefined,
      limit: PAGE_SIZE,
      cursor: list.nextCursor,
    });
    setLoadingMoreKey(k => (k === startKey ? null : k));
    if (!res.success || !res.data) {
      setMoreError({ forKey: startKey, text: errorText(res.error, 'Failed to load more emails.') });
      return;
    }
    const page = res.data;
    // Appended only to the list it was asked for: a filter changed meanwhile drops it.
    setList(prev =>
      prev.forKey === startKey ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
    );
  }

  async function onShow(notificationId: string) {
    setWriteError(null);
    requestedRef.current = notificationId;
    setShowing(notificationId);
    const res = await fetchNotification(notificationId);
    if (requestedRef.current !== notificationId) return;
    requestedRef.current = null;
    setShowing(null);
    if (!res.success || !res.data) {
      setShown(null);
      setWriteError(errorText(res.error, 'The email could not be loaded.'));
      return;
    }
    setShown(res.data);
  }

  function onHide() {
    if (!shown) return;
    const origin = listSectionRef.current?.querySelector<HTMLElement>(
      `button[aria-label="Show email ${shortId(shown.notificationId)}"]`,
    );
    setShown(null);
    (origin ?? listHeadingRef.current)?.focus();
  }

  async function onSendTest() {
    setWriteError(null);
    setBusy(true);
    const res = await sendTestNotification();
    setBusy(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'The test email could not be sent.'));
      return;
    }
    announce(`Test email ${res.data.status}.`);
    setNonce(n => n + 1);
  }

  return (
    <div className="space-y-4">
      {writeError ? (
        <Callout tone="danger" role="alert">
          {writeError}
        </Callout>
      ) : null}

      <section ref={listSectionRef} className={CARD_CLASS} aria-label="Email log">
        <div className="flex flex-wrap items-end gap-3">
          <h2 ref={listHeadingRef} tabIndex={-1} className={`${H2_CLASS} focus:outline-none`}>
            Email log
          </h2>
          <div>
            <label htmlFor={KIND_ID} className={LABEL_CLASS}>
              Kind
            </label>
            <select id={KIND_ID} className={INPUT_CLASS} value={kind} onChange={e => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {NOTIFICATION_KINDS.map(k => (
                <option key={k} value={k}>
                  {codeLabel(NOTIFICATION_KIND_LABELS, k)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={STATUS_ID} className={LABEL_CLASS}>
              Status
            </label>
            <select id={STATUS_ID} className={INPUT_CLASS} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {NOTIFICATION_STATUSES.map(s => (
                <option key={s} value={s}>
                  {codeLabel(NOTIFICATION_STATUS_LABELS, s)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
            Refresh
          </Button>
          {superAdmin ? (
            <Button size="xs" disabled={busy} onClick={() => void onSendTest()}>
              Send test email
            </Button>
          ) : null}
        </div>

        {list.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {list.error}
            </Callout>
          </div>
        ) : null}
        {!list.error && !loading && list.items.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">No email yet.</p>
        ) : null}

        {list.items.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Created</th>
                  <th className={TH_CLASS}>Kind</th>
                  <th className={TH_CLASS}>Subkind</th>
                  <th className={TH_CLASS}>Subject</th>
                  <th className={TH_CLASS}>Mode</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Attempts</th>
                  <th className={TH_CLASS}>Sent</th>
                  <th className={TH_CLASS}>Error code</th>
                  <th className={TH_CLASS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map(n => (
                  <tr key={n.notificationId} className="border-t border-slate-100 align-top">
                    <td className={TD_CLASS}>{formatTimestamp(n.createdAt)}</td>
                    <td className={TD_CLASS}>{codeLabel(NOTIFICATION_KIND_LABELS, n.kind)}</td>
                    <td className={TD_CLASS}>{orDash(n.subkind)}</td>
                    <td className={TD_CLASS}>{n.subject}</td>
                    <td className={TD_CLASS}>{codeLabel(MODE_LABELS, n.mode)}</td>
                    <td className={TD_CLASS}>{codeLabel(NOTIFICATION_STATUS_LABELS, n.status)}</td>
                    <td className={TD_CLASS}>{n.attempts}</td>
                    <td className={TD_CLASS}>{formatTimestamp(n.sentAt)}</td>
                    <td className={TD_CLASS}>{orDash(n.errorCode)}</td>
                    <td className={TD_CLASS}>
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Show email ${shortId(n.notificationId)}`}
                        loading={showing === n.notificationId}
                        onClick={() => void onShow(n.notificationId)}
                      >
                        Show
                      </Button>
                    </td>
                  </tr>
                ))}
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
        {list.nextCursor && !loading ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMoreKey === key} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {shown ? (
        <section className={CARD_CLASS} aria-label="Email body">
          <div className="flex items-center justify-between gap-3">
            <h2 ref={bodyHeadingRef} tabIndex={-1} className={`${H2_CLASS} focus:outline-none`}>
              {shown.subject}
            </h2>
            <Button variant="ghost" size="xs" onClick={onHide}>
              Hide
            </Button>
          </div>
          <pre
            data-testid="automation-email-body"
            className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded p-3"
          >
            {shown.bodyText}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

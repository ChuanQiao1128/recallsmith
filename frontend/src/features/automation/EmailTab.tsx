// src/features/automation/EmailTab.tsx
//
// The Email log tab (A00 §8.6, §12.5): every email the automation queued, and
// its plain-text body on demand. The log has no recipient column: the owner
// alert address is known only to the notifier. A super_admin may send a test
// email, which works in every mode.
import { useEffect, useState } from 'react';

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
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  automationErrorMessage,
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
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [nonce, setNonce] = useState(0);
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [shown, setShown] = useState<AutomationNotificationDetail | null>(null);
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

  async function onLoadMore() {
    if (!list.nextCursor) return;
    setLoadingMore(true);
    const res = await listNotifications({
      kind: kind || undefined,
      status: status || undefined,
      limit: PAGE_SIZE,
      cursor: list.nextCursor,
    });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setWriteError(errorText(res.error, 'Failed to load more emails.'));
      return;
    }
    const page = res.data;
    setList(prev => ({ ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  async function onShow(notificationId: string) {
    setWriteError(null);
    const res = await fetchNotification(notificationId);
    if (!res.success || !res.data) {
      setShown(null);
      setWriteError(errorText(res.error, 'The email could not be loaded.'));
      return;
    }
    setShown(res.data);
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

  const loading = list.forKey !== key;

  return (
    <div className="space-y-4">
      {writeError ? (
        <Callout tone="danger" role="alert">
          {writeError}
        </Callout>
      ) : null}

      <section className={CARD_CLASS} aria-label="Email log">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Email log</h2>
          <div>
            <label htmlFor={KIND_ID} className={LABEL_CLASS}>
              Kind
            </label>
            <select id={KIND_ID} className={INPUT_CLASS} value={kind} onChange={e => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {NOTIFICATION_KINDS.map(k => (
                <option key={k} value={k}>
                  {k}
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
                  {s}
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
                    <td className={TD_CLASS}>{n.kind}</td>
                    <td className={TD_CLASS}>{orDash(n.subkind)}</td>
                    <td className={TD_CLASS}>{n.subject}</td>
                    <td className={TD_CLASS}>{n.mode}</td>
                    <td className={TD_CLASS}>{n.status}</td>
                    <td className={TD_CLASS}>{n.attempts}</td>
                    <td className={TD_CLASS}>{formatTimestamp(n.sentAt)}</td>
                    <td className={TD_CLASS}>{orDash(n.errorCode)}</td>
                    <td className={TD_CLASS}>
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Show email ${shortId(n.notificationId)}`}
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

        {list.nextCursor ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {shown ? (
        <section className={CARD_CLASS} aria-label="Email body">
          <div className="flex items-center justify-between gap-3">
            <h2 className={H2_CLASS}>{shown.subject}</h2>
            <Button variant="ghost" size="xs" onClick={() => setShown(null)}>
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

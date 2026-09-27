// src/pages/WebhooksPage.tsx
//
// super_admin console for outbound webhooks (R18 contract §6.7): subscriptions,
// recent deliveries, where the signing secret lives, and how a receiver checks
// a signature. The secret itself never reaches this page — only the SSM
// parameter name that holds it.
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  redeliverWebhookDelivery,
  sendWebhookTest,
  updateWebhookSubscription,
  type WebhookDelivery,
  type WebhookSubscription,
  type WebhookSubscriptionsData,
} from '../api/webhooks';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { Badge } from '../components/ui/Badge';
import { Callout } from '../components/ui/Callout';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import { CONSOLE_NAME } from '../lib/brand';
import {
  SIGNING_SECRET_SSM_PARAMETER,
  WEBHOOK_EVENTS,
  WEBHOOK_HEADERS,
  WEBHOOK_SIGNATURE_TEST_VECTOR,
  WEBHOOK_TOLERANCE_SECONDS,
  WEBHOOK_VERIFY_SNIPPET,
  isRedeliverable,
  webhookFormProblems,
} from '../lib/webhookRules';
import type { ApiError } from '../types/api';

type LoadError = { code: string; message: string };

type SubscriptionsState = {
  loading: boolean;
  error: LoadError | null;
  data: WebhookSubscriptionsData | null;
};

type DeliveriesState = {
  loading: boolean;
  error: LoadError | null;
  items: WebhookDelivery[];
  nextCursor: string | null;
};

type FormState = {
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
};

const EMPTY_FORM: FormState = { name: '', url: '', events: [], isActive: true };

const DELIVERY_STATUSES = ['queued', 'delivered', 'retrying', 'failed', 'dead', 'enqueue_failed'];
const DELIVERIES_PAGE_SIZE = 50;

const BUTTON_CLASS =
  'text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed';
const PRIMARY_BUTTON_CLASS =
  'text-sm px-3 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed';
const INPUT_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
const LABEL_CLASS = 'block text-xs font-medium text-slate-700 mb-1';
const CARD_CLASS = 'bg-white border border-slate-200 rounded-lg shadow-sm p-4';
const TH_CLASS = 'px-4 py-2 text-left font-semibold text-slate-600';
const TD_CLASS = 'px-4 py-2';

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback };
}

function isNotReady(error: LoadError | null): boolean {
  return !!error && error.code.startsWith('SERVER_NOT_READY_');
}

function when(value: string | null | undefined): string {
  return value ? value : '—';
}

function statusBadge(status: string) {
  if (status === 'delivered') return <Badge tone="success">{status}</Badge>;
  if (status === 'queued' || status === 'retrying') return <Badge tone="info">{status}</Badge>;
  if (status === 'failed' || status === 'dead' || status === 'enqueue_failed') {
    return <Badge tone="danger">{status}</Badge>;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

export function WebhooksPage() {
  const sessionUser = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(sessionUser), [sessionUser]);
  const confirm = useConfirm();

  const [subs, setSubs] = useState<SubscriptionsState>({ loading: true, error: null, data: null });
  const [deliveries, setDeliveries] = useState<DeliveriesState>({
    loading: true,
    error: null,
    items: [],
    nextCursor: null,
  });

  // Bumped to refetch. refreshNonce reloads both lists; deliveriesNonce only the log.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [deliveriesNonce, setDeliveriesNonce] = useState(0);

  const [filterSubscription, setFilterSubscription] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEvent, setFilterEvent] = useState('');

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formProblems, setFormProblems] = useState<string[]>([]);
  const [formServerError, setFormServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rows with a request in flight. The ref is the synchronous guard (a second
  // click can arrive before React re-renders the disabled button); the state
  // drives the disabled attribute.
  const busyRef = useRef(new Set<string>());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [actionError, setActionError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [redeliverMessage, setRedeliverMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    async function run() {
      const res = await listWebhookSubscriptions();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setSubs({ loading: false, error: toLoadError(res.error, 'Failed to load webhook subscriptions.'), data: null });
        return;
      }
      setSubs({ loading: false, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [superAdmin, refreshNonce]);

  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    async function run() {
      const res = await listWebhookDeliveries({
        subscriptionId: filterSubscription === '' ? undefined : Number(filterSubscription),
        status: filterStatus,
        event: filterEvent,
        limit: DELIVERIES_PAGE_SIZE,
      });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDeliveries({
          loading: false,
          error: toLoadError(res.error, 'Failed to load webhook deliveries.'),
          items: [],
          nextCursor: null,
        });
        return;
      }
      setDeliveries({ loading: false, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [superAdmin, refreshNonce, deliveriesNonce, filterSubscription, filterStatus, filterEvent]);

  function beginBusy(key: string): boolean {
    if (busyRef.current.has(key)) return false;
    busyRef.current.add(key);
    setBusy(new Set(busyRef.current));
    return true;
  }

  function endBusy(key: string) {
    busyRef.current.delete(key);
    setBusy(new Set(busyRef.current));
  }

  if (!superAdmin) {
    return (
      <ConsoleShell title={CONSOLE_NAME} subtitle="Admin · Webhooks" superAdmin={false} decksHref="/">
        <Callout tone="danger" title="Access denied">
          This page requires super_admin.
        </Callout>
      </ConsoleShell>
    );
  }

  const subscriptions = subs.data?.items ?? [];
  const eventOptions = subs.data?.events ?? [...WEBHOOK_EVENTS];
  const ssmName = subs.data?.signingSecretSsmName || SIGNING_SECRET_SSM_PARAMETER;
  const nameById = new Map(subscriptions.map(s => [s.id, s.name]));
  const notReady = isNotReady(subs.error) || isNotReady(deliveries.error);

  function toggleFormEvent(event: string, checked: boolean) {
    setForm(prev => ({
      ...prev,
      events: checked ? [...prev.events.filter(e => e !== event), event] : prev.events.filter(e => e !== event),
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormProblems([]);
    setFormServerError(null);
  }

  function startEdit(s: WebhookSubscription) {
    setForm({ name: s.name, url: s.url, events: [...s.events], isActive: s.isActive });
    setEditingId(s.id);
    setFormProblems([]);
    setFormServerError(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const input = { name: form.name.trim(), url: form.url.trim(), events: form.events, isActive: form.isActive };
    const problems = webhookFormProblems(input);
    setFormProblems(problems);
    setFormServerError(null);
    if (problems.length > 0) return;

    setSubmitting(true);
    const res =
      editingId === null
        ? await createWebhookSubscription(input)
        : await updateWebhookSubscription(editingId, input);
    setSubmitting(false);
    if (!res.success) {
      setFormServerError(res.error?.message ?? 'The subscription could not be saved.');
      return;
    }
    resetForm();
    setRefreshNonce(n => n + 1);
  }

  async function toggleActive(s: WebhookSubscription) {
    const key = `sub:${s.id}`;
    if (!beginBusy(key)) return;
    setActionError(null);
    const res = await updateWebhookSubscription(s.id, { isActive: !s.isActive });
    endBusy(key);
    if (!res.success) {
      setActionError(res.error?.message ?? 'The subscription could not be updated.');
      return;
    }
    setRefreshNonce(n => n + 1);
  }

  async function deleteSubscription(s: WebhookSubscription) {
    const key = `sub:${s.id}`;
    if (busyRef.current.has(key)) return;
    const confirmed = await confirm({
      title: `Delete webhook "${s.name}"?`,
      body: 'Deliveries to this endpoint stop immediately. Past deliveries stay in the log.',
      destructive: true,
      confirmLabel: 'Delete subscription',
    });
    if (!confirmed) return;
    if (!beginBusy(key)) return;
    setActionError(null);
    const res = await deleteWebhookSubscription(s.id);
    endBusy(key);
    if (!res.success) {
      setActionError(res.error?.message ?? 'The subscription could not be deleted.');
      return;
    }
    if (editingId === s.id) resetForm();
    setRefreshNonce(n => n + 1);
  }

  async function sendTest(s: WebhookSubscription) {
    const key = `sub:${s.id}`;
    if (!beginBusy(key)) return;
    setTestResult(null);
    const res = await sendWebhookTest(s.id);
    endBusy(key);
    if (res.success && res.data) {
      setTestResult(`Test event queued: delivery ${res.data.deliveryId}`);
    } else if (res.error?.code === 'WEBHOOKS_NOT_CONFIGURED') {
      setTestResult('The webhook queue is not configured on the server yet.');
    } else {
      setTestResult(res.error?.message ?? 'The test event could not be sent.');
    }
    setDeliveriesNonce(n => n + 1);
  }

  async function redeliver(d: WebhookDelivery) {
    const key = `delivery:${d.deliveryId}`;
    if (!beginBusy(key)) return;
    setRedeliverMessage(null);
    const res = await redeliverWebhookDelivery(d.deliveryId);
    endBusy(key);
    if (!res.success) {
      setRedeliverMessage(
        res.error?.code === 'SUBSCRIPTION_INACTIVE'
          ? 'Enable the subscription before redelivering.'
          : (res.error?.message ?? 'The delivery could not be redelivered.'),
      );
      return;
    }
    setRedeliverMessage(`Redelivery queued: delivery ${res.data?.deliveryId ?? d.deliveryId}`);
    setDeliveriesNonce(n => n + 1);
  }

  async function loadMore() {
    if (loadingMore || !deliveries.nextCursor) return;
    setLoadingMore(true);
    const res = await listWebhookDeliveries({
      subscriptionId: filterSubscription === '' ? undefined : Number(filterSubscription),
      status: filterStatus,
      event: filterEvent,
      limit: DELIVERIES_PAGE_SIZE,
      cursor: deliveries.nextCursor,
    });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setDeliveries(prev => ({ ...prev, error: toLoadError(res.error, 'Failed to load more deliveries.') }));
      return;
    }
    const page = res.data;
    setDeliveries(prev => ({
      ...prev,
      error: null,
      items: [...prev.items, ...page.items],
      nextCursor: page.nextCursor,
    }));
  }

  const V = WEBHOOK_SIGNATURE_TEST_VECTOR;

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Admin · Webhooks"
      decksHref="/"
      contentIntelligenceHref="/content-intelligence"
      webhooksHref="/admin/webhooks"
      adminUsersHref="/admin/users"
      superAdmin
    >
      <h1 className="text-lg font-semibold text-slate-900">Webhooks</h1>

      {notReady ? (
        <div data-testid="webhooks-not-ready">
          <Callout tone="warning" title="Webhooks are not set up yet">
            The server has not run the webhooks database migration.
          </Callout>
        </div>
      ) : null}

      <section className={CARD_CLASS}>
        <h2 className="text-sm font-semibold text-slate-900">Subscriptions</h2>

        {subs.error && !isNotReady(subs.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load subscriptions">
              {subs.error.message}
            </Callout>
          </div>
        ) : null}
        {actionError ? (
          <div className="mt-3">
            <Callout tone="danger">{actionError}</Callout>
          </div>
        ) : null}
        {testResult ? (
          <div className="mt-3 text-sm text-slate-700" data-testid="webhooks-test-result">
            {testResult}
          </div>
        ) : null}

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>Name</th>
                <th className={TH_CLASS}>Endpoint URL</th>
                <th className={TH_CLASS}>Events</th>
                <th className={TH_CLASS}>Status</th>
                <th className={TH_CLASS}>Updated</th>
                <th className={TH_CLASS}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : subscriptions.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No subscriptions yet.
                  </td>
                </tr>
              ) : (
                subscriptions.map(s => {
                  const rowBusy = busy.has(`sub:${s.id}`);
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className={TD_CLASS}>{s.name}</td>
                      <td className={`${TD_CLASS} font-mono text-xs text-slate-800`}>{s.url}</td>
                      <td className={TD_CLASS}>{s.events.join(', ')}</td>
                      <td className={TD_CLASS}>{s.isActive ? 'Active' : 'Disabled'}</td>
                      <td className={`${TD_CLASS} text-slate-600 text-xs`}>{when(s.updatedAt)}</td>
                      <td className={TD_CLASS}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BUTTON_CLASS}
                            aria-label={`Edit ${s.name}`}
                            disabled={rowBusy}
                            onClick={() => startEdit(s)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={BUTTON_CLASS}
                            aria-label={`${s.isActive ? 'Disable' : 'Enable'} ${s.name}`}
                            disabled={rowBusy}
                            onClick={() => void toggleActive(s)}
                          >
                            {s.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className={BUTTON_CLASS}
                            aria-label={`Send test to ${s.name}`}
                            disabled={rowBusy}
                            onClick={() => void sendTest(s)}
                          >
                            Send test
                          </button>
                          <button
                            type="button"
                            className={BUTTON_CLASS}
                            aria-label={`Delete ${s.name}`}
                            disabled={rowBusy}
                            onClick={() => void deleteSubscription(s)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <form className="mt-4 space-y-3" onSubmit={e => void submitForm(e)} noValidate>
          <div className="text-sm font-semibold text-slate-900">
            {editingId === null ? 'New subscription' : 'Edit subscription'}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="webhook-name">
                Name
              </label>
              <input
                id="webhook-name"
                className={INPUT_CLASS}
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="webhook-url">
                Endpoint URL
              </label>
              <input
                id="webhook-url"
                type="url"
                className={INPUT_CLASS}
                value={form.url}
                onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
              />
            </div>
          </div>
          <fieldset>
            <legend className={LABEL_CLASS}>Events</legend>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map(event => (
                <label key={event} className="text-xs text-slate-700 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.events.includes(event)}
                    onChange={e => toggleFormEvent(event, e.target.checked)}
                  />
                  {event}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-xs text-slate-700 flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
            />
            Active
          </label>

          {formProblems.length > 0 ? (
            <Callout tone="danger" title="Fix these first">
              <ul>
                {formProblems.map(p => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {formServerError ? <Callout tone="danger">{formServerError}</Callout> : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={submitting}>
              {editingId === null ? 'Add subscription' : 'Save changes'}
            </button>
            {editingId !== null ? (
              <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className={CARD_CLASS}>
        <h2 className="text-sm font-semibold text-slate-900">Recent deliveries</h2>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLASS} htmlFor="webhook-filter-subscription">
              Subscription
            </label>
            <select
              id="webhook-filter-subscription"
              className={INPUT_CLASS}
              value={filterSubscription}
              onChange={e => setFilterSubscription(e.target.value)}
            >
              <option value="">Any</option>
              {subscriptions.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="webhook-filter-status">
              Status
            </label>
            <select
              id="webhook-filter-status"
              className={INPUT_CLASS}
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="">Any</option>
              {DELIVERY_STATUSES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="webhook-filter-event">
              Event
            </label>
            <select
              id="webhook-filter-event"
              className={INPUT_CLASS}
              value={filterEvent}
              onChange={e => setFilterEvent(e.target.value)}
            >
              <option value="">Any</option>
              {[...eventOptions.filter(e => e !== 'webhook.test'), 'webhook.test'].map(e => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </div>

        {deliveries.error && !isNotReady(deliveries.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load deliveries">
              {deliveries.error.message}
            </Callout>
          </div>
        ) : null}
        {redeliverMessage ? <div className="mt-3 text-sm text-slate-700">{redeliverMessage}</div> : null}

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="webhooks-deliveries-table">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>Created</th>
                <th className={TH_CLASS}>Event</th>
                <th className={TH_CLASS}>Subscription</th>
                <th className={TH_CLASS}>Status</th>
                <th className={TH_CLASS}>Attempts</th>
                <th className={TH_CLASS}>HTTP status</th>
                <th className={TH_CLASS}>Last error</th>
                <th className={TH_CLASS}>Delivered</th>
                <th className={TH_CLASS}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={9}>
                    Loading…
                  </td>
                </tr>
              ) : deliveries.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={9}>
                    No deliveries match.
                  </td>
                </tr>
              ) : (
                deliveries.items.map(d => (
                  <tr key={d.deliveryId} className="border-t border-slate-100">
                    <td className={`${TD_CLASS} text-slate-600 text-xs`}>{when(d.createdAt)}</td>
                    <td className={TD_CLASS}>{d.event}</td>
                    <td className={TD_CLASS}>{nameById.get(d.subscriptionId) ?? `#${d.subscriptionId}`}</td>
                    <td className={TD_CLASS}>{statusBadge(d.status)}</td>
                    <td className={TD_CLASS}>{d.attempts}</td>
                    <td className={TD_CLASS}>{d.lastStatusCode ?? '—'}</td>
                    <td className={`${TD_CLASS} text-slate-600 text-xs`}>{d.lastError ?? '—'}</td>
                    <td className={`${TD_CLASS} text-slate-600 text-xs`}>{when(d.deliveredAt)}</td>
                    <td className={TD_CLASS}>
                      {isRedeliverable(d.status) ? (
                        <button
                          type="button"
                          className={BUTTON_CLASS}
                          aria-label={`Redeliver ${d.deliveryId}`}
                          disabled={busy.has(`delivery:${d.deliveryId}`)}
                          onClick={() => void redeliver(d)}
                        >
                          Redeliver
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {deliveries.nextCursor ? (
          <div className="mt-3">
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={loadingMore} onClick={() => void loadMore()}>
              Load more
            </button>
          </div>
        ) : null}
      </section>

      <section className={CARD_CLASS}>
        <h2 className="text-sm font-semibold text-slate-900">Signing secret</h2>
        <p className="mt-3 text-slate-600 text-sm">
          Every delivery is signed with one shared secret, stored in the SSM parameter{' '}
          <code data-testid="webhooks-ssm-name" className="font-mono text-xs text-slate-800">
            {ssmName}
          </code>
          .
        </p>
        <p className="mt-2 text-slate-600 text-sm">
          The console never shows the secret value. Read it with your own AWS credentials:
        </p>
        <pre className="mt-2 overflow-x-auto border border-slate-200 rounded p-4 font-mono text-xs text-slate-800">
          <code>{`aws ssm get-parameter --name ${ssmName} --with-decryption --query Parameter.Value --output text`}</code>
        </pre>
      </section>

      <section className={CARD_CLASS}>
        <h2 className="text-sm font-semibold text-slate-900">Verify a delivery</h2>
        <p className="mt-3 text-slate-600 text-sm">Each delivery is a POST carrying these headers:</p>
        <ul className="mt-2 text-sm">
          {WEBHOOK_HEADERS.map(h => (
            <li key={h}>
              <code className="font-mono text-xs text-slate-800">{h}</code>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-slate-600 text-sm">
          The signature is HMAC-SHA256 over <code className="font-mono text-xs text-slate-800">{'"<timestamp>.<body>"'}</code>{' '}
          with the signing secret, as lowercase hex. The timestamp is in seconds; reject a delivery more than{' '}
          {WEBHOOK_TOLERANCE_SECONDS} s from your clock. Compare signatures in constant time, and deduplicate on the
          body&apos;s <code className="font-mono text-xs text-slate-800">eventId</code>, since a delivery can arrive more
          than once.
        </p>
        <pre className="mt-3 overflow-x-auto border border-slate-200 rounded p-4 font-mono text-xs text-slate-800">
          <code>{WEBHOOK_VERIFY_SNIPPET}</code>
        </pre>
        <div className="mt-3" data-testid="webhooks-test-vector">
          <div className="text-xs font-medium text-slate-900">Test vector (a published fake secret)</div>
          <dl className="mt-1 text-xs text-slate-600">
            <div>
              <dt className="font-semibold">Secret</dt>
              <dd className="font-mono">{V.secret}</dd>
            </div>
            <div>
              <dt className="font-semibold">Timestamp</dt>
              <dd className="font-mono">{V.timestamp}</dd>
            </div>
            <div>
              <dt className="font-semibold">Body</dt>
              <dd className="font-mono">{V.body}</dd>
            </div>
            <div>
              <dt className="font-semibold">Expected signature</dt>
              <dd className="font-mono break-words">{V.signature}</dd>
            </div>
          </dl>
        </div>
      </section>
    </ConsoleShell>
  );
}

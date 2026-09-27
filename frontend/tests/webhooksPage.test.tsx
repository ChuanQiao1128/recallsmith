// @vitest-environment jsdom
//
// The /admin/webhooks console page (R18 contract §6.7). src/api/webhooks is
// mocked, so nothing here can leave the process; the session is a real token
// through tests/support/consoleSession, so the super_admin gate is the app's own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { deferred, ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { renderAt } from './support/routerProbe';
import { ConsoleShell } from '../src/components/console/ConsoleShell';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { documentTitleFor } from '../src/lib/brand';
import type { ApiResult } from '../src/types/api';
import type {
  WebhookDelivery,
  WebhookDeliveriesPage,
  WebhookSubscription,
  WebhookSubscriptionsData,
} from '../src/api/webhooks';

const api = vi.hoisted(() => ({
  listWebhookSubscriptions: vi.fn(),
  createWebhookSubscription: vi.fn(),
  updateWebhookSubscription: vi.fn(),
  deleteWebhookSubscription: vi.fn(),
  sendWebhookTest: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  redeliverWebhookDelivery: vi.fn(),
}));

vi.mock('../src/api/webhooks', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/webhooks')>();
  return { ...actual, ...api };
});

const { WebhooksPage } = await import('../src/pages/WebhooksPage');

const SSM_NAME = '/developercards/test/webhook-signing-secret';

const n8n: WebhookSubscription = {
  id: 7,
  name: 'n8n',
  url: 'https://hooks.example.com/dc',
  events: ['deck.published'],
  isActive: true,
  createdAt: '2026-09-27T10:00:00Z',
  updatedAt: '2026-09-27T10:00:00Z',
};

function delivery(overrides: Partial<WebhookDelivery>): WebhookDelivery {
  return {
    deliveryId: 'del-1',
    eventId: 'evt-1',
    event: 'deck.published',
    subscriptionId: 7,
    status: 'delivered',
    attempts: 1,
    lastStatusCode: 200,
    lastError: null,
    createdAt: '2026-09-27T10:01:00Z',
    updatedAt: '2026-09-27T10:01:00Z',
    deliveredAt: '2026-09-27T10:01:01Z',
    ...overrides,
  };
}

function subsData(items: WebhookSubscription[]): ApiResult<WebhookSubscriptionsData> {
  return ok({ items, events: ['deck.published', 'import.failed', 'card.flagged', 'review.queued'], signingSecretSsmName: SSM_NAME });
}

function deliveriesPage(items: WebhookDelivery[], nextCursor: string | null = null): ApiResult<WebhookDeliveriesPage> {
  return ok({ items, nextCursor });
}

function mountPage() {
  return renderAt(
    <ConfirmDialogProvider>
      <WebhooksPage />
    </ConfirmDialogProvider>,
    ['/admin/webhooks'],
  );
}

async function mountLoaded() {
  mountPage();
  await waitFor(() => {
    expect(api.listWebhookSubscriptions).toHaveBeenCalled();
    expect(api.listWebhookDeliveries).toHaveBeenCalled();
  });
  await screen.findByTestId('webhooks-ssm-name');
  await act(async () => {});
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listWebhookSubscriptions.mockResolvedValue(subsData([n8n]));
  api.listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
  signInAsSuperAdmin();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe('WebhooksPage', () => {
  it('refuses an editor without calling the API', async () => {
    signOut();
    signInAsEditor();
    mountPage();
    expect(await screen.findByText('Access denied')).toBeTruthy();
    expect(screen.getByText('This page requires super_admin.')).toBeTruthy();
    await act(async () => {});
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Webhooks' })).toBeNull();
  });

  it('shows the signing secret SSM parameter name and never a secret value', async () => {
    await mountLoaded();
    expect(screen.getByTestId('webhooks-ssm-name').textContent).toBe(SSM_NAME);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Webhooks');
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Subscriptions',
      'Recent deliveries',
      'Signing secret',
      'Verify a delivery',
    ]);

    const vector = screen.getByTestId('webhooks-test-vector');
    expect(vector.textContent).toContain('whsec-test');
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelector('[data-testid="webhooks-test-vector"]')?.remove();
    expect(clone.textContent).not.toContain('whsec-');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('creates a subscription and lists it', async () => {
    const user = userEvent.setup();
    api.listWebhookSubscriptions.mockResolvedValueOnce(subsData([]));
    const slack: WebhookSubscription = { ...n8n, id: 8, name: 'slack', url: 'https://hooks.slack.example/x' };
    api.createWebhookSubscription.mockResolvedValue(ok(slack));
    await mountLoaded();
    expect(screen.getByText('No subscriptions yet.')).toBeTruthy();

    api.listWebhookSubscriptions.mockResolvedValue(subsData([slack]));
    await user.type(screen.getByLabelText('Name'), 'slack');
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://hooks.slack.example/x');
    const events = screen.getByRole('group', { name: 'Events' });
    await user.click(within(events).getByLabelText('deck.published'));
    await user.click(screen.getByRole('button', { name: 'Add subscription' }));

    await waitFor(() => expect(api.createWebhookSubscription).toHaveBeenCalledTimes(1));
    expect(api.createWebhookSubscription).toHaveBeenCalledWith({
      name: 'slack',
      url: 'https://hooks.slack.example/x',
      events: ['deck.published'],
      isActive: true,
    });
    expect(await screen.findByRole('button', { name: 'Edit slack' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('blocks a private or non-https URL before sending', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.type(screen.getByLabelText('Name'), 'internal');
    await user.type(screen.getByLabelText('Endpoint URL'), 'https://192.168.1.10/hook');
    await user.click(within(screen.getByRole('group', { name: 'Events' })).getByLabelText('card.flagged'));
    await user.click(screen.getByRole('button', { name: 'Add subscription' }));
    expect(await screen.findByText('The endpoint URL must not point at a private or loopback address.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Endpoint URL'));
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://hooks.example.com/dc');
    await user.click(screen.getByRole('button', { name: 'Add subscription' }));
    expect(await screen.findByText('The endpoint URL must use https.')).toBeTruthy();
    expect(api.createWebhookSubscription).not.toHaveBeenCalled();
  });

  it('sends one test event per click and shows the delivery id', async () => {
    const user = userEvent.setup();
    const pending = deferred<ApiResult<{ eventId: string; deliveryId: string }>>();
    api.sendWebhookTest.mockReturnValue(pending.promise);
    await mountLoaded();
    const deliveriesCalls = api.listWebhookDeliveries.mock.calls.length;

    const button = screen.getByRole('button', { name: 'Send test to n8n' });
    await user.dblClick(button);
    expect(api.sendWebhookTest).toHaveBeenCalledTimes(1);
    expect(api.sendWebhookTest).toHaveBeenCalledWith(7);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete n8n' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => pending.resolve(ok({ eventId: 'evt-9', deliveryId: 'del-9' })));
    expect((await screen.findByTestId('webhooks-test-result')).textContent).toBe('Test event queued: delivery del-9');
    await waitFor(() => expect(api.listWebhookDeliveries.mock.calls.length).toBeGreaterThan(deliveriesCalls));
    expect((screen.getByRole('button', { name: 'Send test to n8n' }) as HTMLButtonElement).disabled).toBe(false);

    api.sendWebhookTest.mockResolvedValue(refused('WEBHOOKS_NOT_CONFIGURED', 'queue missing'));
    await user.click(screen.getByRole('button', { name: 'Send test to n8n' }));
    await waitFor(() =>
      expect(screen.getByTestId('webhooks-test-result').textContent).toBe(
        'The webhook queue is not configured on the server yet.',
      ),
    );
  });

  it('redelivers a dead delivery and refreshes the log', async () => {
    const user = userEvent.setup();
    api.listWebhookDeliveries.mockResolvedValue(
      deliveriesPage([delivery({ deliveryId: 'del-dead', status: 'dead', attempts: 8, lastStatusCode: 500, lastError: 'HTTP 500', deliveredAt: null })]),
    );
    api.redeliverWebhookDelivery.mockResolvedValue(ok({ deliveryId: 'del-dead', eventId: 'evt-1' }));
    await mountLoaded();
    const table = screen.getByTestId('webhooks-deliveries-table');
    expect(within(table).getByText('dead')).toBeTruthy();
    expect(within(table).getByText('n8n')).toBeTruthy();
    const calls = api.listWebhookDeliveries.mock.calls.length;

    api.listWebhookDeliveries.mockResolvedValue(deliveriesPage([delivery({ deliveryId: 'del-dead', status: 'queued', deliveredAt: null })]));
    await user.click(within(table).getByRole('button', { name: 'Redeliver del-dead' }));
    expect(api.redeliverWebhookDelivery).toHaveBeenCalledTimes(1);
    expect(api.redeliverWebhookDelivery).toHaveBeenCalledWith('del-dead');
    await waitFor(() => expect(api.listWebhookDeliveries.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(within(screen.getByTestId('webhooks-deliveries-table')).getByText('queued')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Redeliver del-dead' })).toBeNull();
  });

  it('announces test and redeliver results through one persistent live region', async () => {
    const user = userEvent.setup();
    api.listWebhookDeliveries.mockResolvedValue(
      deliveriesPage([delivery({ deliveryId: 'del-dead', status: 'dead', deliveredAt: null })]),
    );
    api.sendWebhookTest.mockResolvedValue(ok({ eventId: 'evt-9', deliveryId: 'del-9' }));
    api.redeliverWebhookDelivery.mockResolvedValue(refused('SUBSCRIPTION_INACTIVE', 'inactive'));
    await mountLoaded();

    // Present and empty before anything happens, so later text is announced.
    const live = screen.getByTestId('webhooks-live');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Send test to n8n' }));
    await waitFor(() => expect(live.textContent).toBe('Test event queued: delivery del-9'));
    expect(screen.getByTestId('webhooks-live')).toBe(live);

    await user.click(screen.getByRole('button', { name: 'Redeliver del-dead' }));
    await waitFor(() => expect(live.textContent).toBe('Enable the subscription before redelivering.'));
  });

  it('marks invalid form fields and announces the problem list as an alert', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    await user.type(screen.getByLabelText('Name'), 'internal');
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://hooks.example.com/dc');
    await user.click(screen.getByRole('button', { name: 'Add subscription' }));

    const problems = await screen.findByRole('alert');
    expect(problems.textContent).toContain('The endpoint URL must use https.');
    expect(problems.textContent).toContain('Choose at least one event.');
    const url = screen.getByLabelText('Endpoint URL');
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(url.getAttribute('aria-describedby')).toBe(problems.id);
    expect(screen.getByRole('group', { name: 'Events' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull();
  });

  it('drops a Load more page whose filter changed while it was in flight, and shows the refetch', async () => {
    const user = userEvent.setup();
    const stale = deferred<ApiResult<WebhookDeliveriesPage>>();
    const filtered = deferred<ApiResult<WebhookDeliveriesPage>>();
    api.listWebhookDeliveries.mockImplementation(async (params: { status?: string; cursor?: string }) => {
      if (params.cursor) return stale.promise;
      if (params.status === 'dead') return filtered.promise;
      return deliveriesPage([delivery({ deliveryId: 'del-first' })], 'cursor-1');
    });
    await mountLoaded();
    const table = screen.getByTestId('webhooks-deliveries-table');
    expect(within(table).getByRole('button', { name: 'Redeliver del-first' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'dead');

    // The old rows stay, dimmed and marked busy, until the new filter's page lands.
    expect(await screen.findByTestId('webhooks-deliveries-refetching')).toBeTruthy();
    expect(screen.getByTestId('webhooks-deliveries-table').getAttribute('aria-busy')).toBe('true');

    await act(async () => filtered.resolve(deliveriesPage([delivery({ deliveryId: 'del-dead', status: 'dead', deliveredAt: null })])));
    await waitFor(() => expect(screen.queryByTestId('webhooks-deliveries-refetching')).toBeNull());
    await act(async () =>
      stale.resolve(deliveriesPage([delivery({ deliveryId: 'del-stale', status: 'delivered' })], 'cursor-2')),
    );

    const rows = within(screen.getByTestId('webhooks-deliveries-table'));
    expect(rows.getByRole('button', { name: 'Redeliver del-dead' })).toBeTruthy();
    expect(rows.queryByRole('button', { name: 'Redeliver del-stale' })).toBeNull();
    expect(rows.getAllByText('dead')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows no Redeliver button for a queued delivery', async () => {
    api.listWebhookDeliveries.mockResolvedValue(
      deliveriesPage(
        [
          delivery({ deliveryId: 'del-q', status: 'queued', deliveredAt: null }),
          delivery({ deliveryId: 'del-r', status: 'retrying', deliveredAt: null }),
          delivery({ deliveryId: 'del-ok', status: 'delivered' }),
        ],
        'cursor-2',
      ),
    );
    await mountLoaded();
    expect(screen.queryByRole('button', { name: 'Redeliver del-q' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redeliver del-r' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Redeliver del-ok' })).toBeTruthy();

    const user = userEvent.setup();
    api.listWebhookDeliveries.mockResolvedValueOnce(deliveriesPage([delivery({ deliveryId: 'del-old', status: 'failed' })]));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: 'Redeliver del-old' })).toBeTruthy();
    expect(api.listWebhookDeliveries).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' }));
    expect(screen.getByRole('button', { name: 'Redeliver del-ok' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('explains a server that has not run the webhooks migration', async () => {
    api.listWebhookSubscriptions.mockResolvedValue(refused('SERVER_NOT_READY_WEBHOOKS', 'migration 0042 missing'));
    api.listWebhookDeliveries.mockResolvedValue(refused('SERVER_NOT_READY_WEBHOOKS', 'migration 0042 missing'));
    mountPage();
    const notice = await screen.findByTestId('webhooks-not-ready');
    expect(notice.textContent).toContain('Webhooks are not set up yet');
    expect(notice.textContent).toContain('The server has not run the webhooks database migration.');
  });

  it('deletes only after the confirm dialog', async () => {
    const user = userEvent.setup();
    api.deleteWebhookSubscription.mockResolvedValue(ok({ id: 7, deleted: true }));
    await mountLoaded();

    await user.click(screen.getByRole('button', { name: 'Delete n8n' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete webhook "n8n"?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.deleteWebhookSubscription).not.toHaveBeenCalled();

    api.listWebhookSubscriptions.mockResolvedValue(subsData([]));
    await user.click(screen.getByRole('button', { name: 'Delete n8n' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete subscription' }));
    await waitFor(() => expect(api.deleteWebhookSubscription).toHaveBeenCalledTimes(1));
    expect(api.deleteWebhookSubscription).toHaveBeenCalledWith(7);
    expect(await screen.findByText('No subscriptions yet.')).toBeTruthy();
  });

  it('shows the Webhooks nav link to a super_admin only', () => {
    function shell(href?: string) {
      return render(
        <MemoryRouter>
          <ConsoleShell title="t" webhooksHref={href}>
            body
          </ConsoleShell>
        </MemoryRouter>,
      );
    }

    shell('/admin/webhooks');
    const link = screen.getByRole('link', { name: 'Webhooks' });
    expect(link.getAttribute('href')).toBe('/admin/webhooks');
    expect(link.querySelector('span')).toBeNull();
    cleanup();

    shell(undefined);
    expect(screen.queryByRole('link', { name: 'Webhooks' })).toBeNull();
    cleanup();

    signOut();
    signInAsEditor();
    shell('/admin/webhooks');
    expect(screen.queryByRole('link', { name: 'Webhooks' })).toBeNull();
  });

  it('names the route Webhooks in the tab title', () => {
    expect(documentTitleFor('/admin/webhooks')).toBe('Webhooks · DeveloperCards Console');
  });

  it('moves focus to the form and announces it when Edit is clicked (frontend-console-18)', async () => {
    const user = userEvent.setup();
    await mountLoaded();
    const live = screen.getByTestId('webhooks-live');
    await user.click(screen.getByRole('button', { name: 'Edit n8n' }));
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('n8n');
    expect(document.activeElement).toBe(name);
    await waitFor(() => expect(live.textContent).toBe('Editing subscription n8n.'));
  });
});

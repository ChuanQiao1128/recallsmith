// What src/api/webhooks.ts sends, below every page-level mock.
//
// src/api/http is replaced wholesale, as in adminConsoleRequests.test.tsx:
// .env.development points VITE_API_BASE at a real origin, so with the module
// mocked an outbound request has nowhere to go.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/webhooks');
const { SIGNING_SECRET_SSM_PARAMETER, WEBHOOK_EVENTS } = await import('../src/lib/webhookRules');

const SUB = {
  id: 7,
  name: 'n8n',
  url: 'https://hooks.example.com/dc',
  events: ['deck.published'],
  isActive: true,
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
};

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('src/api/webhooks', () => {
  it('lists subscriptions from GET /api/v1/admin/webhooks/subscriptions', async () => {
    httpMock.get.mockResolvedValueOnce({
      data: ok({ items: [SUB], events: ['deck.published'], signingSecretSsmName: '/x/y' }),
    });
    const res = await api.listWebhookSubscriptions();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/webhooks/subscriptions');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ items: [SUB], events: ['deck.published'], signingSecretSsmName: '/x/y' });

    httpMock.get.mockResolvedValueOnce({ data: ok({ items: [] }) });
    const fallback = await api.listWebhookSubscriptions();
    expect(fallback.data).toEqual({
      items: [],
      events: [...WEBHOOK_EVENTS],
      signingSecretSsmName: SIGNING_SECRET_SSM_PARAMETER,
    });
  });

  it('creates, updates, deletes and tests a subscription on the contract routes', async () => {
    const input = { name: 'n8n', url: 'https://hooks.example.com/dc', events: ['deck.published'], isActive: true };

    httpMock.post.mockResolvedValueOnce({ data: ok(SUB) });
    expect((await api.createWebhookSubscription(input)).data).toEqual(SUB);
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/webhooks/subscriptions', input);

    httpMock.put.mockResolvedValueOnce({ data: ok({ ...SUB, isActive: false }) });
    await api.updateWebhookSubscription(7, { isActive: false });
    expect(httpMock.put).toHaveBeenCalledWith('/api/v1/admin/webhooks/subscriptions/7', { isActive: false });

    httpMock.delete.mockResolvedValueOnce({ data: ok({ id: 7, deleted: true }) });
    expect((await api.deleteWebhookSubscription(7)).data).toEqual({ id: 7, deleted: true });
    expect(httpMock.delete).toHaveBeenCalledWith('/api/v1/admin/webhooks/subscriptions/7');

    httpMock.post.mockResolvedValueOnce({ data: ok({ eventId: 'e1', deliveryId: 'd1' }) });
    expect((await api.sendWebhookTest(7)).data).toEqual({ eventId: 'e1', deliveryId: 'd1' });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/webhooks/subscriptions/7/test', {});
  });

  it('pages deliveries with only the filters that are set', async () => {
    httpMock.get.mockResolvedValue({ data: ok({ items: [], nextCursor: 'c2' }) });

    const res = await api.listWebhookDeliveries({
      subscriptionId: 7,
      status: '',
      event: 'deck.published',
      limit: 50,
      cursor: null,
    });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/webhooks/deliveries', {
      params: { subscriptionId: 7, event: 'deck.published', limit: 50 },
    });
    expect(res.data).toEqual({ items: [], nextCursor: 'c2' });

    await api.listWebhookDeliveries({ cursor: 'c2', status: 'dead' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/webhooks/deliveries', {
      params: { cursor: 'c2', status: 'dead' },
    });

    await api.listWebhookDeliveries({});
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/webhooks/deliveries', { params: {} });
  });

  it('redelivers through POST /api/v1/admin/webhooks/deliveries/:deliveryId/redeliver', async () => {
    httpMock.post.mockResolvedValueOnce({ data: ok({ deliveryId: 'd/1', eventId: 'e1' }) });
    const res = await api.redeliverWebhookDelivery('d/1');
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/webhooks/deliveries/d%2F1/redeliver', {});
    expect(res.data).toEqual({ deliveryId: 'd/1', eventId: 'e1' });
  });

  it('sweeps stranded deliveries through POST /api/v1/admin/webhooks/deliveries/sweep (automation-1)', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ swept: 2, resent: 2, enqueueFailures: 0, deliveryIds: ['a', 'b'] }) });
    const res = await api.sweepWebhookDeliveries();
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/webhooks/deliveries/sweep', {});
    expect(res.data).toEqual({ swept: 2, resent: 2, enqueueFailures: 0, deliveryIds: ['a', 'b'] });

    httpMock.post.mockResolvedValue({ data: ok({ nothing: true }) });
    expect((await api.sweepWebhookDeliveries()).error?.code).toBe('BAD_RESPONSE');
  });

  it('keeps the server error code when a request fails', async () => {
    const envelope = {
      success: false,
      data: null,
      error: { code: 'WEBHOOK_URL_INVALID', message: 'The URL must be public https.' },
      traceId: 't-1',
    };
    const err = new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      statusText: 'Bad Request',
      data: envelope,
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
    httpMock.post.mockRejectedValueOnce(err);

    const res = await api.createWebhookSubscription({ name: 'x', url: 'https://10.0.0.1', events: ['deck.published'] });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('WEBHOOK_URL_INVALID');
    expect(res.error?.message).toBe('The URL must be public https.');
    expect(res.error?.httpStatus).toBe(400);
  });

  it('reports BAD_RESPONSE when the list is not an array', async () => {
    httpMock.get.mockResolvedValueOnce({ data: ok({ items: 'nope' }) });
    expect((await api.listWebhookSubscriptions()).error?.code).toBe('BAD_RESPONSE');

    httpMock.get.mockResolvedValueOnce({ data: ok({ nextCursor: null }) });
    expect((await api.listWebhookDeliveries({})).error?.code).toBe('BAD_RESPONSE');
  });
});

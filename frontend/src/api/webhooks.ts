// src/api/webhooks.ts
// Outbound webhooks admin API (R18 contract §6.6), served under /api/v1/admin/webhooks.
// super_admin only on the server. Every function returns an ApiResult and never throws.
import type { ApiResult } from '../types/api';
import { SIGNING_SECRET_SSM_PARAMETER, WEBHOOK_EVENTS } from '../lib/webhookRules';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type WebhookSubscription = {
  id: number;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDeliveryStatus = 'queued' | 'delivered' | 'retrying' | 'failed' | 'dead' | 'enqueue_failed';

/** One delivery attempt record. The request body is never returned. */
export type WebhookDelivery = {
  deliveryId: string;
  eventId: string;
  event: string;
  subscriptionId: number;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  /**
   * When the row was handed to the queue; null for a row never sent (stranded
   * after a failed post-commit enqueue). Absent when the server does not list it.
   */
  enqueuedAt?: string | null;
};

/** POST …/deliveries/sweep: rows claimed, re-sent, and those whose re-send failed again. */
export type WebhookSweepResult = { swept: number; resent: number; enqueueFailures: number; deliveryIds: string[] };

export type WebhookSubscriptionsData = {
  items: WebhookSubscription[];
  events: string[];
  /** The SSM parameter name that holds the signing secret. Never the value. */
  signingSecretSsmName: string;
};

export type WebhookDeliveriesPage = { items: WebhookDelivery[]; nextCursor: string | null };

export type WebhookSubscriptionInput = { name: string; url: string; events: string[]; isActive?: boolean };

export type WebhookDeliveriesParams = {
  subscriptionId?: number;
  status?: string;
  event?: string;
  limit?: number;
  cursor?: string | null;
};

const SUBSCRIPTIONS = '/api/v1/admin/webhooks/subscriptions';
const DELIVERIES = '/api/v1/admin/webhooks/deliveries';

async function run<T>(request: () => Promise<{ data: ApiResult<T> }>): Promise<ApiResult<T>> {
  try {
    const resp = await request();
    return resp.data;
  } catch (err) {
    return apiResultFromError<T>(err);
  }
}

function badResponse<T>(): ApiResult<T> {
  return failResult<T>('The server returned an unexpected response.', 'BAD_RESPONSE');
}

export async function listWebhookSubscriptions(): Promise<ApiResult<WebhookSubscriptionsData>> {
  const res = await run(() => http.get<ApiResult<Partial<WebhookSubscriptionsData>>>(SUBSCRIPTIONS));
  if (!res.success) return { ...res, data: null };
  const data = res.data;
  if (!data || !Array.isArray(data.items)) return badResponse();
  return {
    ...res,
    data: {
      items: data.items,
      events: Array.isArray(data.events) ? data.events : [...WEBHOOK_EVENTS],
      signingSecretSsmName:
        typeof data.signingSecretSsmName === 'string' && data.signingSecretSsmName !== ''
          ? data.signingSecretSsmName
          : SIGNING_SECRET_SSM_PARAMETER,
    },
  };
}

export async function createWebhookSubscription(
  input: WebhookSubscriptionInput,
): Promise<ApiResult<WebhookSubscription>> {
  return run(() => http.post<ApiResult<WebhookSubscription>>(SUBSCRIPTIONS, input));
}

export async function updateWebhookSubscription(
  id: number,
  patch: Partial<WebhookSubscriptionInput>,
): Promise<ApiResult<WebhookSubscription>> {
  return run(() => http.put<ApiResult<WebhookSubscription>>(`${SUBSCRIPTIONS}/${id}`, patch));
}

export async function deleteWebhookSubscription(id: number): Promise<ApiResult<{ id: number; deleted: boolean }>> {
  return run(() => http.delete<ApiResult<{ id: number; deleted: boolean }>>(`${SUBSCRIPTIONS}/${id}`));
}

export async function sendWebhookTest(id: number): Promise<ApiResult<{ eventId: string; deliveryId: string }>> {
  return run(() => http.post<ApiResult<{ eventId: string; deliveryId: string }>>(`${SUBSCRIPTIONS}/${id}/test`, {}));
}

export async function listWebhookDeliveries(
  params: WebhookDeliveriesParams,
): Promise<ApiResult<WebhookDeliveriesPage>> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  const res = await run(() => http.get<ApiResult<Partial<WebhookDeliveriesPage>>>(DELIVERIES, { params: query }));
  if (!res.success) return { ...res, data: null };
  const data = res.data;
  if (!data || !Array.isArray(data.items)) return badResponse();
  return {
    ...res,
    data: { items: data.items, nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null },
  };
}

export async function redeliverWebhookDelivery(
  deliveryId: string,
): Promise<ApiResult<{ deliveryId: string; eventId: string }>> {
  return run(() =>
    http.post<ApiResult<{ deliveryId: string; eventId: string }>>(
      `${DELIVERIES}/${encodeURIComponent(deliveryId)}/redeliver`,
      {},
    ),
  );
}

/**
 * POST /api/v1/admin/webhooks/deliveries/sweep (super_admin, automation-1):
 * re-sends deliveries stranded 'queued' (never handed to the queue) or
 * 'enqueue_failed' for at least ten minutes. Idempotent.
 */
export async function sweepWebhookDeliveries(): Promise<ApiResult<WebhookSweepResult>> {
  const res = await run(() => http.post<ApiResult<Partial<WebhookSweepResult>>>(`${DELIVERIES}/sweep`, {}));
  if (!res.success) return { ...res, data: null };
  const data = res.data;
  if (!data || typeof data.swept !== 'number') return badResponse();
  return {
    ...res,
    data: {
      swept: data.swept,
      resent: typeof data.resent === 'number' ? data.resent : 0,
      enqueueFailures: typeof data.enqueueFailures === 'number' ? data.enqueueFailures : 0,
      deliveryIds: Array.isArray(data.deliveryIds) ? data.deliveryIds : [],
    },
  };
}

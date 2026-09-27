// What src/api/automation.ts sends and how it reads the answers (contract A00
// §8.6, §15.4, §16.2), below every page-level mock.
//
// src/api/http is replaced wholesale, as in ledgerApi.test.ts: with the module
// mocked an outbound request has nowhere to go.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { ok } from './support/apiResult';
import { NOTIFICATION_ID, RUN_ID } from './support/automationFixtures';

const httpMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const api = await import('../src/api/automation');

function axiosFailure(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: 'Error',
    headers: {},
    config,
    data,
  });
}

function rawStatus() {
  return {
    serverTime: '2026-09-28T12:00:00Z',
    mode: { configured: 'live', effective: 'dry_run', liveBlockedReason: 'EVAL_GATE_MISSING', autoPublish: true },
    evalGate: null,
    runners: [
      {
        runnerId: 'owner-mac',
        host: 'mac-mini',
        runnerVersion: '1.0.0',
        claudeVersion: null,
        state: 'idle',
        lastHeartbeatAt: '2026-09-28T11:45:00Z',
        stale: false,
        loginExpiresAt: '2026-10-01T12:00:00Z',
        loginExpiresInDays: '3.5',
        lastRunId: null,
        lastRunAt: null,
        lastRunOutcome: null,
        lastError: null,
        ownerSub: 'must-not-reach-the-page',
      },
    ],
    queue: { queued: '2', due: 1, claimed: 0, failed: 0, doneLast7d: '5' },
    decisions24h: { byState: { human: '4' }, byReason: { QA_FLAGGED: '4' } },
    shadow: {
      wouldAccept: 10,
      humanDecided: 8,
      humanAccepted: 7,
      humanEditedAccepted: 1,
      humanRejected: 0,
      agreementRate: '0.875',
    },
    publishes7d: { byState: { would_publish: '2' } },
    spend: { todayUsd: '1.250000', automationTodayUsd: '0.5', reservedUsd: 0, dailyCapUsd: '10' },
    watch: { targets: 4, active: 3, failing: 1, lastCheckedAt: null, changes7d: 0 },
    notifications: { sent24h: 3, failed24h: 0, queued: 0, lastSentAt: null },
  };
}

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset();
});

describe('src/api/automation', () => {
  it('reads the status from GET /api/v1/admin/automation/status', async () => {
    httpMock.get.mockResolvedValue({ data: ok(rawStatus()) });

    const res = await api.fetchAutomationStatus();
    expect(httpMock.get).toHaveBeenCalledWith('/api/v1/admin/automation/status');
    expect(res.success).toBe(true);
    const data = res.data!;
    expect(data.mode).toEqual({
      configured: 'live',
      effective: 'dry_run',
      liveBlockedReason: 'EVAL_GATE_MISSING',
      autoPublish: true,
    });
    expect(data.queue).toEqual({ queued: 2, due: 1, claimed: 0, failed: 0, doneLast7d: 5 });
    expect(data.decisions24h).toEqual({ byState: { human: 4 }, byReason: { QA_FLAGGED: 4 } });
    expect(data.shadow.agreementRate).toBe(0.875);
    expect(data.publishes7d.byState).toEqual({ would_publish: 2 });
    expect(data.spend).toEqual({ todayUsd: 1.25, automationTodayUsd: 0.5, reservedUsd: 0, dailyCapUsd: 10 });
    expect(data.runners).toHaveLength(1);
    expect(data.runners[0].loginExpiresInDays).toBe(3.5);
    expect(data.runners[0]).not.toHaveProperty('ownerSub');
    expect(Object.keys(data.runners[0]).sort()).toEqual(
      [
        'runnerId',
        'host',
        'runnerVersion',
        'claudeVersion',
        'state',
        'lastHeartbeatAt',
        'stale',
        'loginExpiresAt',
        'loginExpiresInDays',
        'lastRunId',
        'lastRunAt',
        'lastRunOutcome',
        'lastError',
      ].sort(),
    );

    // A payload without its runners array is not a status.
    httpMock.get.mockResolvedValue({ data: ok({ mode: {} }) });
    const bad = await api.fetchAutomationStatus();
    expect(bad.success).toBe(false);
    expect(bad.error?.code).toBe('BAD_RESPONSE');
    expect(bad.error?.message).toBe('The server sent an unexpected automation response.');
  });

  it('lists runs and decisions with only the filters that are set', async () => {
    httpMock.get.mockResolvedValue({
      data: ok({
        items: [
          {
            runId: RUN_ID,
            queueItemId: '12',
            kind: 'manual',
            url: 'https://docs.aws.amazon.com/',
            deckId: '7',
            deckSlug: 'aws-saa-c03',
            runnerId: 'owner-mac',
            status: 'completed',
            startedAt: '2026-09-28T11:00:00Z',
            counts: { submitted: '3', qaPending: 0, qaQueued: '1' },
            publishes: [{ publishId: '2', deckId: 7, state: 'would_publish', mode: 'dry_run' }],
          },
        ],
        nextCursor: 'abc',
      }),
    });

    const runs = await api.listAutomationRuns({ limit: 50 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/runs', { params: { limit: 50 } });
    expect(runs.data?.nextCursor).toBe('abc');
    expect(runs.data?.items[0].queueItemId).toBe(12);
    expect(runs.data?.items[0].counts.submitted).toBe(3);
    expect(runs.data?.items[0].counts.qaQueued).toBe(1);
    expect(runs.data?.items[0].publishes[0].publishId).toBe(2);

    await api.listAutomationRuns({ status: 'failed', deckId: undefined, limit: 50, cursor: 'abc' });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/runs', {
      params: { status: 'failed', limit: 50, cursor: 'abc' },
    });

    httpMock.get.mockResolvedValue({ data: ok({ items: [], nextCursor: null }) });
    await api.listAutomationDecisions({ runId: RUN_ID });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/decisions', { params: { runId: RUN_ID } });

    await api.listAutomationDecisions({ deckId: 7, state: '', reason: 'QA_FLAGGED', limit: 50, cursor: null });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/decisions', {
      params: { deckId: 7, reason: 'QA_FLAGGED', limit: 50 },
    });

    httpMock.get.mockResolvedValue({
      data: ok({ draftId: '41', deckId: 7, state: 'human', qa: null, findings: [], events: [], card: null }),
    });
    const detail = await api.fetchAutomationDecision(41);
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/decisions/41');
    expect(detail.data?.draftId).toBe(41);
    expect(detail.data?.qa).toBeNull();

    httpMock.get.mockResolvedValue({ data: ok({ notAList: true }) });
    expect((await api.listAutomationRuns()).error?.code).toBe('BAD_RESPONSE');
    expect((await api.fetchAutomationDecision(41)).error?.code).toBe('BAD_RESPONSE');
  });

  it('sends the pasted eval gate report unchanged to POST /api/v1/admin/automation/eval-gate', async () => {
    // Odd spacing and key order on purpose: the server hashes these exact bytes.
    const pasted = '{ "v": 1,\n  "passed": true, "kind":"automation-gate",   "failures": [] }\n';
    httpMock.post.mockResolvedValue({
      data: ok({
        gateId: '4',
        reviewer: { provider: 'bedrock-converse', model: 'global.openai.gpt-5.5', promptVersion: 'qa-v4' },
        passed: true,
        metrics: { autoAcceptPrecision: 0.98 },
        reportSha256: 'a'.repeat(64),
        createdBySub: 'owner-sub',
        createdAt: '2026-09-28T12:00:00Z',
        revokedAt: null,
        revokedBySub: null,
        report: { must: 'not reach the page' },
      }),
    });

    const res = await api.recordEvalGate(pasted);
    // B07 frontend-console-3: an identity transformRequest, so axios cannot parse and trim the body.
    expect(httpMock.post).toHaveBeenCalledWith('/api/v1/admin/automation/eval-gate', pasted, {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: [expect.any(Function)],
    });
    expect(httpMock.post.mock.calls[0][1]).toBe(pasted);
    expect(httpMock.post.mock.calls[0][2].transformRequest[0](pasted)).toBe(pasted);
    expect(res.data?.gateId).toBe(4);
    expect(res.data).not.toHaveProperty('report');

    await api.revokeEvalGate(4);
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/eval-gate/4/revoke', {});

    httpMock.get.mockResolvedValue({ data: ok({ current: null, history: [{ gateId: 3, reviewer: {} }] }) });
    const gate = await api.fetchEvalGate();
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/eval-gate');
    expect(gate.data?.current).toBeNull();
    expect(gate.data?.history.map(g => g.gateId)).toEqual([3]);
  });

  it('adds and skips queue items', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ itemId: '13', kind: 'manual', url: 'https://docs.aws.amazon.com/' }) });

    const added = await api.addQueueItem({ url: 'https://docs.aws.amazon.com/', deckId: 7, title: '', note: '' });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/queue', {
      url: 'https://docs.aws.amazon.com/',
      deckId: 7,
    });
    expect(added.data?.itemId).toBe(13);

    await api.addQueueItem({ url: 'https://docs.aws.amazon.com/', deckId: 7, title: 'S3', note: 'section 2' });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/queue', {
      url: 'https://docs.aws.amazon.com/',
      deckId: 7,
      title: 'S3',
      note: 'section 2',
    });

    await api.skipQueueItem(12);
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/queue/12/skip', {});

    httpMock.get.mockResolvedValue({ data: ok({ items: [], nextCursor: '' }) });
    const list = await api.listQueueItems({ status: 'queued', limit: 50 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/queue', {
      params: { status: 'queued', limit: 50 },
    });
    expect(list.data).toEqual({ items: [], nextCursor: null });

    httpMock.post.mockResolvedValue({ data: ok({}) });
    expect((await api.skipQueueItem(12)).error?.code).toBe('BAD_RESPONSE');
  });

  it('creates and updates watch targets', async () => {
    httpMock.post.mockResolvedValue({ data: ok({ targetId: 5, kind: 'feed', url: 'https://example.com/feed' }) });

    await api.addWatchTarget({ url: 'https://example.com/feed', feedFormat: 'atom', deckId: 7 });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch/targets', {
      url: 'https://example.com/feed',
      kind: 'feed',
      feedFormat: 'atom',
      deckId: 7,
    });

    const added = await api.addWatchTarget({
      url: 'https://example.com/feed',
      feedFormat: 'rss',
      deckId: 7,
      itemTitlePattern: '\\mS3\\M',
      checkIntervalMinutes: 360,
    });
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch/targets', {
      url: 'https://example.com/feed',
      kind: 'feed',
      feedFormat: 'rss',
      deckId: 7,
      itemTitlePattern: '\\mS3\\M',
      checkIntervalMinutes: 360,
    });
    expect(added.data?.targetId).toBe(5);

    httpMock.put.mockResolvedValue({ data: ok({ targetId: 5, active: false }) });
    const updated = await api.updateWatchTarget(5, { active: false });
    expect(httpMock.put).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch/targets/5', { active: false });
    expect(updated.data?.active).toBe(false);

    await api.updateWatchTarget(5, { itemTitlePattern: null, checkIntervalMinutes: 120 });
    expect(httpMock.put).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch/targets/5', {
      itemTitlePattern: null,
      checkIntervalMinutes: 120,
    });

    httpMock.get.mockResolvedValue({
      data: ok({
        items: [{ targetId: '3', url: 'https://example.com/feed', active: true, citingCards: '2' }],
        recentEvents: [{ eventId: 9, targetId: 3, recheckRunIds: [RUN_ID], queueItemIds: ['12'] }],
        nextCursor: null,
      }),
    });
    const watch = await api.fetchWatch({ limit: 50 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch', { params: { limit: 50 } });
    expect(watch.data?.items[0].targetId).toBe(3);
    expect(watch.data?.items[0].citingCards).toBe(2);
    expect(watch.data?.recentEvents[0].queueItemIds).toEqual([12]);
    expect(watch.data?.recentEvents[0].recheckRunIds).toEqual([RUN_ID]);

    await api.fetchWatch({ kind: 'feed', active: false });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/watch', {
      params: { kind: 'feed', active: false },
    });
  });

  it('lists notifications, reads one body and sends the test email', async () => {
    httpMock.get.mockResolvedValue({
      data: ok({
        items: [
          {
            notificationId: NOTIFICATION_ID,
            kind: 'test',
            subject: '[DeveloperCards] Test',
            mode: 'off',
            status: 'sent',
            attempts: '1',
            createdAt: '2026-09-28T12:00:00Z',
            to: 'owner@example.com',
            recipient: 'owner@example.com',
          },
        ],
        nextCursor: null,
      }),
    });
    const list = await api.listNotifications({ kind: 'test', status: undefined, limit: 50 });
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/notifications', {
      params: { kind: 'test', limit: 50 },
    });
    const row = list.data!.items[0];
    expect(row.attempts).toBe(1);
    expect(row).not.toHaveProperty('to');
    expect(row).not.toHaveProperty('recipient');
    expect(JSON.stringify(list.data)).not.toContain('@');

    httpMock.get.mockResolvedValue({
      data: ok({ notificationId: NOTIFICATION_ID, kind: 'test', subject: 'x', bodyText: 'Hello.\nLine two.' }),
    });
    const one = await api.fetchNotification(NOTIFICATION_ID);
    expect(httpMock.get).toHaveBeenLastCalledWith(`/api/v1/admin/automation/notifications/${NOTIFICATION_ID}`);
    expect(one.data?.bodyText).toBe('Hello.\nLine two.');

    await api.fetchNotification('a/b');
    expect(httpMock.get).toHaveBeenLastCalledWith('/api/v1/admin/automation/notifications/a%2Fb');

    httpMock.post.mockResolvedValue({ data: ok({ notificationId: NOTIFICATION_ID, status: 'queued' }) });
    const sent = await api.sendTestNotification();
    expect(httpMock.post).toHaveBeenLastCalledWith('/api/v1/admin/automation/notifications/test', {});
    expect(sent.data).toEqual({ notificationId: NOTIFICATION_ID, status: 'queued' });
  });

  it('keeps the server error code of a refusal', async () => {
    httpMock.post.mockRejectedValue(
      axiosFailure(409, {
        success: false,
        data: null,
        error: { code: 'QUEUE_ITEM_EXISTS', message: 'An item for this url and deck is already queued.' },
        traceId: 'trace-409',
      }),
    );
    const res = await api.addQueueItem({ url: 'https://docs.aws.amazon.com/', deckId: 7 });
    expect(res.success).toBe(false);
    expect(res.data).toBeNull();
    expect(res.error?.code).toBe('QUEUE_ITEM_EXISTS');
    expect(res.error?.httpStatus).toBe(409);
    expect(res.error?.message).toBe('An item for this url and deck is already queued.');
    expect(res.traceId).toBe('trace-409');

    httpMock.post.mockRejectedValue(
      axiosFailure(400, {
        success: false,
        data: null,
        error: { code: 'EVAL_GATE_FAILED', message: 'failed', details: 'seededRecall 0.81 < 0.90' },
        traceId: 't',
      }),
    );
    const gate = await api.recordEvalGate('{}');
    expect(gate.error?.code).toBe('EVAL_GATE_FAILED');
    expect(gate.error?.details).toBe('seededRecall 0.81 < 0.90');

    httpMock.get.mockRejectedValue(
      axiosFailure(503, {
        success: false,
        data: null,
        error: { code: 'SERVER_NOT_READY_AUTOMATION', message: 'Migration 034 has not run.' },
        traceId: 't',
      }),
    );
    const status = await api.fetchAutomationStatus();
    expect(status.error?.code).toBe('SERVER_NOT_READY_AUTOMATION');
    expect(status.error?.httpStatus).toBe(503);
  });
});

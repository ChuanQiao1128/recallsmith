// @vitest-environment jsdom
//
// src/api/automation.ts through the REAL `http` axios instance, with only the
// adapter replaced (as in apiEnvelopeOnHttpError.test.ts), so axios's own
// transformRequest runs. automationApi.test.ts mocks `http` wholesale and so
// cannot see what axios does to a body (B07 frontend-console-3, -5).

import { afterEach, describe, expect, it } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { http } from '../src/api/http';
import { fetchAutomationStatus, listAutomationRuns, recordEvalGate, RUN_SUMMARY_MAX } from '../src/api/automation';
import { ok } from './support/apiResult';
import { RUN_ID } from './support/automationFixtures';

const realAdapter = http.defaults.adapter;

function answer(data: unknown, seen: InternalAxiosRequestConfig[] = []) {
  http.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    seen.push(config);
    const response: AxiosResponse = { data, status: 200, statusText: 'OK', headers: {}, config };
    return Promise.resolve(response);
  };
  return seen;
}

afterEach(() => {
  http.defaults.adapter = realAdapter;
});

function rawStatus(extra: Record<string, unknown> = {}) {
  return {
    serverTime: '2026-09-28T12:00:00Z',
    mode: { configured: 'dry_run', effective: 'dry_run', liveBlockedReason: null, autoPublish: true },
    evalGate: null,
    runners: [],
    ...extra,
  };
}

describe('the eval-gate report reaches the adapter byte for byte', () => {
  it('keeps the trailing newline and the spacing dc-evals wrote', async () => {
    // The shape automation_gate.py writes: indent=2 and a trailing newline.
    const report = '{\n  "v": 1,\n  "kind": "automation-gate",\n  "passed": true,\n  "failures": []\n}\n';
    const seen = answer(ok({ gateId: 5, reviewer: {}, passed: true, reportSha256: 'b'.repeat(64) }));

    const res = await recordEvalGate(report);

    expect(res.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('post');
    expect(seen[0].url).toBe('/api/v1/admin/automation/eval-gate');
    expect(seen[0].data).toBe(report);
    expect(String(seen[0].headers['Content-Type'])).toContain('application/json');
  });

  it('does not trim leading whitespace either', async () => {
    const report = '  {"v":1,"kind":"automation-gate","passed":true}  \n\n';
    const seen = answer(ok({ gateId: 6, reviewer: {}, passed: true }));
    await recordEvalGate(report);
    expect(seen[0].data).toBe(report);
  });
});

describe('the open backlog on the status (K7)', () => {
  it('reads backlog.humanPending, oldestHumanPendingAt and humanPublishes', async () => {
    answer(
      ok(
        rawStatus({
          backlog: { humanPending: '3', oldestHumanPendingAt: '2026-09-25T08:00:00Z', humanPublishes: 1, extra: 'x' },
        }),
      ),
    );
    const res = await fetchAutomationStatus();
    expect(res.data?.backlog).toEqual({
      humanPending: 3,
      oldestHumanPendingAt: '2026-09-25T08:00:00Z',
      humanPublishes: 1,
    });
  });

  it('is null on an older server that does not send it', async () => {
    answer(ok(rawStatus()));
    const res = await fetchAutomationStatus();
    expect(res.success).toBe(true);
    expect(res.data?.backlog).toBeNull();
  });
});

describe('the agent notes of a run (K3)', () => {
  function run(summary: unknown) {
    return { runId: RUN_ID, kind: 'manual', url: 'https://docs.aws.amazon.com/', status: 'completed', summary };
  }

  it('reads summary as plain text, null when empty or absent, capped at 2000 characters', async () => {
    answer(
      ok({
        items: [
          run('Card s3-02 cites the wrong limit.\nPlease check.'),
          run('   '),
          run(null),
          { runId: RUN_ID, kind: 'manual', url: 'https://x/', status: 'completed' },
          run('y'.repeat(2500)),
        ],
        nextCursor: null,
      }),
    );
    const res = await listAutomationRuns({ limit: 50 });
    const notes = res.data?.items.map(r => r.summary);
    expect(notes?.slice(0, 4)).toEqual(['Card s3-02 cites the wrong limit.\nPlease check.', null, null, null]);
    expect(notes?.[4]).toHaveLength(RUN_SUMMARY_MAX);
    expect(RUN_SUMMARY_MAX).toBe(2000);
  });
});

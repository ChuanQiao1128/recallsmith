// @vitest-environment jsdom
//
// D07 frontend-console-29: the console's normalizers against the server's own
// pinned response shapes. The src_C integration tests pin the keys each
// automation route returns (StatusContractJson, RunnerKeys, RunKeys, GateKeys,
// DecisionKeys, …). This test reads those pins from the C# test files, builds
// a raw response from them, runs it through src/api/automation.ts over the
// REAL `http` instance (only the adapter replaced, as in
// automationApiWire.test.ts), and fails when the server sends a key that the
// normalizer neither keeps nor lists in IGNORED below. So a server addition
// like shadow.blindDecided (C02) breaks a console test, not the go-live
// review. The reverse check keeps the console from reading a key the server
// never pins, except the few newer optional keys listed in TOLERATED.
//
// E05 frontend-console-31: key shapes alone let an enumeration drift through
// (the server's AUTHOR_NOT_GATED reason, R18D M1, never reached the console).
// So the decision and publish reasons and states are read from the server's
// source (AutomationReasons.cs, StatusRoutes.cs) and compared with the
// console's lists, in contract order.
//
// Hand-written fixtures stay for the page tests; they cannot drift silently any
// more, because the fixture builders are typed with the normalizer's output.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { http } from '../src/api/http';
import {
  fetchAutomationStatus,
  fetchEvalGate,
  fetchWatch,
  listAutomationDecisions,
  listAutomationRuns,
  listNotifications,
  listQueueItems,
} from '../src/api/automation';
import { DECISION_REASONS, DECISION_STATES, PUBLISH_REASONS, PUBLISH_STATES } from '../src/lib/automationRules';
import { ok } from './support/apiResult';

// A path, not a URL: under jsdom the global URL is jsdom's, which node's fileURLToPath refuses.
const SERVER_TESTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src_C/Tests/RecallSmith.Lambda.IntegrationTests',
);

function serverTest(name: string): string {
  return readFileSync(resolve(SERVER_TESTS, name), 'utf8');
}

const SERVER_AUTOMATION = resolve(dirname(fileURLToPath(import.meta.url)), '../../src_C/Vpc/Automation');

function serverSource(name: string): string {
  return readFileSync(resolve(SERVER_AUTOMATION, name), 'utf8');
}

/** The strings of `public static readonly IReadOnlyList<string> <name> = [ … ];` in a C# source file. */
function serverList(source: string, name: string): string[] {
  const match = new RegExp(`IReadOnlyList<string>\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) throw new Error(`the server no longer declares ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** The strings of `private static readonly string[] <name> = [ … ];` (or `{ … };`) in a C# test file. */
function pinnedKeys(source: string, name: string): string[] {
  const match = new RegExp(`string\\[\\]\\s+${name}\\s*=\\s*[\\[{]([\\s\\S]*?)[\\]}];`).exec(source);
  if (!match) throw new Error(`the server test no longer pins ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** The JSON of a C# raw string literal `const string <name> = """ … """;`. */
function pinnedJson(source: string, name: string): Record<string, unknown> {
  const match = new RegExp(`${name}\\s*=\\s*"""([\\s\\S]*?)"""`).exec(source);
  if (!match) throw new Error(`the server test no longer pins ${name}`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

const statusTests = serverTest('AutomationStatusRoutesTests.cs');
const STATUS = pinnedJson(statusTests, 'StatusContractJson');
const RUNNER_KEYS = pinnedKeys(statusTests, 'RunnerKeys');
const RUN_KEYS = pinnedKeys(statusTests, 'RunKeys');
const RUN_COUNT_KEYS = pinnedKeys(statusTests, 'RunCountKeys');
const PUBLISH_KEYS = pinnedKeys(statusTests, 'PublishKeys');
const DECISION_KEYS = pinnedKeys(statusTests, 'DecisionKeys');
const QA_KEYS = pinnedKeys(statusTests, 'QaKeys');
const GATE_KEYS = pinnedKeys(serverTest('EvalGateTests.cs'), 'GateKeys');
const QUEUE_ITEM_KEYS = pinnedKeys(serverTest('AutomationQueueRoutesTests.cs'), 'QueueItemKeys');
const watchTests = serverTest('WatchAdminRoutesTests.cs');
const WATCH_TARGET_KEYS = pinnedKeys(watchTests, 'WatchTargetKeys');
const WATCH_EVENT_KEYS = pinnedKeys(watchTests, 'WatchEventKeys');
const NOTIFICATION_KEYS = pinnedKeys(serverTest('AutomationNotificationsTests.cs'), 'NotificationKeys');

/** Server keys the console deliberately drops, with the reason. None today. */
const IGNORED: Record<string, string[]> = {};

/**
 * Keys the console reads that the server pins do not list yet: optional
 * R18D keys the console tolerates the absence of (M2 live). N1 (R18E) makes
 * the server pin evalGate.authorConfigId in GateKeys (src_C's side of
 * frontend-console-31); once it does, the tolerance ends by itself and the
 * check is exact, so the key can never again hide behind this list.
 */
const TOLERATED: Record<string, string[]> = {
  status: ['live'],
  evalGate: GATE_KEYS.includes('authorConfigId') ? [] : ['authorConfigId'],
};

/** A raw object with every pinned key; '1' reads as text, as a number and as an id. */
function rawOf(keys: string[], nested: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(keys.map(k => [k, k in nested ? nested[k] : '1']));
}

function expectSameKeys(path: string, raw: unknown, normalized: unknown) {
  expect(raw, path).toBeTypeOf('object');
  expect(normalized, path).toBeTypeOf('object');
  const rawKeys = Object.keys(raw as object);
  const outKeys = Object.keys(normalized as object);
  const dropped = rawKeys.filter(k => !outKeys.includes(k) && !(IGNORED[path] ?? []).includes(k));
  expect(dropped, `${path}: server keys the console drops`).toEqual([]);
  const invented = outKeys.filter(k => !rawKeys.includes(k) && !(TOLERATED[path] ?? []).includes(k));
  expect(invented, `${path}: keys the console reads that the server does not pin`).toEqual([]);
}

const realAdapter = http.defaults.adapter;

function answer(data: unknown) {
  http.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    const response: AxiosResponse = { data, status: 200, statusText: 'OK', headers: {}, config };
    return Promise.resolve(response);
  };
}

afterEach(() => {
  http.defaults.adapter = realAdapter;
});

const QA_RAW = rawOf(QA_KEYS);
const PUBLISH_RAW = rawOf(PUBLISH_KEYS);
const RUN_RAW = rawOf(RUN_KEYS, { counts: rawOf(RUN_COUNT_KEYS), publishes: [PUBLISH_RAW], summary: 'notes' });
const DECISION_RAW = rawOf(DECISION_KEYS, { qa: QA_RAW });
const GATE_RAW = rawOf(GATE_KEYS, {
  reviewer: { provider: 'openai-mantle', model: 'openai.gpt-5.5', promptVersion: 'qa-v4-auto' },
  metrics: {},
  passed: true,
});

describe('the console normalizers keep every key the server pins (frontend-console-29)', () => {
  it('reads the pins from the server tests', () => {
    // A broken extraction would make every check below vacuous.
    expect(Object.keys(STATUS)).toContain('shadow');
    expect(Object.keys(STATUS.shadow as object)).toEqual(
      expect.arrayContaining(['agreementRate', 'blindDecided', 'blindAccepted']),
    );
    for (const keys of [RUNNER_KEYS, RUN_KEYS, RUN_COUNT_KEYS, PUBLISH_KEYS, DECISION_KEYS, QA_KEYS, GATE_KEYS]) {
      expect(keys.length).toBeGreaterThan(5);
    }
    expect(QUEUE_ITEM_KEYS).toContain('itemId');
    expect(WATCH_TARGET_KEYS).toContain('targetId');
    expect(WATCH_EVENT_KEYS).toContain('eventId');
    expect(NOTIFICATION_KEYS).toContain('notificationId');
  });

  it('GET …/status: every section of StatusContractJson', async () => {
    const backlog = STATUS.backlog as Record<string, unknown>;
    const raw = {
      ...STATUS,
      runners: [rawOf(RUNNER_KEYS)],
      evalGate: GATE_RAW,
      backlog: {
        ...backlog,
        humanPublishItems: [{ deckId: 7, deckSlug: 'aws-saa-c03', reason: 'DECK_NEVER_PUBLISHED', since: 'ISO' }],
      },
    };
    answer(ok(raw));
    const res = await fetchAutomationStatus();
    expect(res.success).toBe(true);
    const status = res.data as unknown as Record<string, unknown>;

    expectSameKeys('status', raw, status);
    for (const section of ['mode', 'queue', 'decisions24h', 'shadow', 'spend', 'watch', 'notifications', 'backlog']) {
      expectSameKeys(section, raw[section as keyof typeof raw], status[section]);
    }
    if ('live' in STATUS) expectSameKeys('live', STATUS.live, status.live);
    expectSameKeys('runner', raw.runners[0], (status.runners as unknown[])[0]);
    expectSameKeys('evalGate', raw.evalGate, status.evalGate);
  });

  it('GET …/runs: RunKeys, RunCountKeys, PublishKeys', async () => {
    answer(ok({ items: [RUN_RAW], nextCursor: null }));
    const res = await listAutomationRuns();
    const run = res.data?.items[0] as unknown as Record<string, unknown>;
    expectSameKeys('run', RUN_RAW, run);
    expectSameKeys('counts', RUN_RAW.counts, run.counts);
    expectSameKeys('publish', PUBLISH_RAW, (run.publishes as unknown[])[0]);
  });

  it('GET …/decisions: DecisionKeys, QaKeys', async () => {
    answer(ok({ items: [DECISION_RAW], nextCursor: null }));
    const res = await listAutomationDecisions();
    const decision = res.data?.items[0] as unknown as Record<string, unknown>;
    expectSameKeys('decision', DECISION_RAW, decision);
    expectSameKeys('qa', QA_RAW, decision.qa);
  });

  it('GET …/eval-gate: GateKeys', async () => {
    answer(ok({ current: GATE_RAW, history: [GATE_RAW] }));
    const res = await fetchEvalGate();
    expectSameKeys('evalGate', GATE_RAW, res.data?.current);
    expectSameKeys('evalGate', GATE_RAW, res.data?.history[0]);
  });

  it('GET …/queue, …/watch and …/notifications', async () => {
    const item = rawOf(QUEUE_ITEM_KEYS);
    answer(ok({ items: [item], nextCursor: null }));
    expectSameKeys('queueItem', item, (await listQueueItems()).data?.items[0]);

    const target = rawOf(WATCH_TARGET_KEYS);
    const event = rawOf(WATCH_EVENT_KEYS, { recheckRunIds: [], queueItemIds: [], details: null });
    answer(ok({ items: [target], recentEvents: [event], nextCursor: null }));
    const watch = (await fetchWatch()).data;
    expectSameKeys('watchTarget', target, watch?.items[0]);
    expectSameKeys('watchEvent', event, watch?.recentEvents[0]);

    const notification = rawOf(NOTIFICATION_KEYS);
    answer(ok({ items: [notification], nextCursor: null }));
    expectSameKeys('notification', notification, (await listNotifications()).data?.items[0]);
  });
});

describe('the blind shadow and live keys on the wire (frontend-console-22, M2)', () => {
  const base = {
    serverTime: '2026-09-28T12:00:00Z',
    mode: { configured: 'dry_run', effective: 'dry_run', liveBlockedReason: null, autoPublish: true },
    evalGate: null,
    runners: [],
  };

  it('keeps blindDecided and blindAccepted, coercing numeric strings', async () => {
    answer(
      ok({
        ...base,
        shadow: { humanDecided: '50', humanAccepted: '40', agreementRate: '1', blindDecided: '10', blindAccepted: '10' },
        live: { autoAccepted30d: '25', deletedByPerson: '1', editedByPerson: '1', overrideRate: '0.08' },
      }),
    );
    const res = await fetchAutomationStatus();
    expect(res.data?.shadow).toMatchObject({ humanDecided: 50, blindDecided: 10, blindAccepted: 10, agreementRate: 1 });
    expect(res.data?.live).toEqual({ autoAccepted30d: 25, deletedByPerson: 1, editedByPerson: 1, overrideRate: 0.08 });
  });

  it('defaults both blind keys and live to null on an older server', async () => {
    answer(ok({ ...base, shadow: { humanDecided: 8, humanAccepted: 7, agreementRate: 0.875 } }));
    const res = await fetchAutomationStatus();
    expect(res.data?.shadow.blindDecided).toBeNull();
    expect(res.data?.shadow.blindAccepted).toBeNull();
    expect(res.data?.live).toBeNull();
  });

  it('keeps a null override rate null', async () => {
    answer(ok({ ...base, live: { autoAccepted30d: 0, deletedByPerson: 0, editedByPerson: 0, overrideRate: null } }));
    expect((await fetchAutomationStatus()).data?.live?.overrideRate).toBeNull();
  });
});

describe('the console knows every reason and state the server does (frontend-console-31)', () => {
  const reasons = serverSource('AutomationReasons.cs');
  const statusRoutes = serverSource('StatusRoutes.cs');

  it('reads the lists from the server source', () => {
    // A broken extraction would make every check below vacuous.
    expect(serverList(reasons, 'DecisionReasons')).toContain('QA_FLAGGED');
    expect(serverList(statusRoutes, 'DecisionStates')).toContain('would_accept');
  });

  it('DECISION_REASONS equals AutomationReasons.DecisionReasons, AUTHOR_NOT_GATED included', () => {
    expect([...DECISION_REASONS]).toEqual(serverList(reasons, 'DecisionReasons'));
    expect(DECISION_REASONS).toContain('AUTHOR_NOT_GATED');
  });

  it('PUBLISH_REASONS equals AutomationReasons.PublishReasons', () => {
    expect([...PUBLISH_REASONS]).toEqual(serverList(reasons, 'PublishReasons'));
  });

  it("DECISION_STATES and PUBLISH_STATES equal StatusRoutes' state lists", () => {
    expect([...DECISION_STATES]).toEqual(serverList(statusRoutes, 'DecisionStates'));
    expect([...PUBLISH_STATES]).toEqual(serverList(statusRoutes, 'PublishStates'));
  });

  it('keeps the gate author id on the wire (N1)', async () => {
    answer(ok({ current: { ...GATE_RAW, authorConfigId: 'a'.repeat(64) }, history: [{ ...GATE_RAW, authorConfigId: null }] }));
    const res = await fetchEvalGate();
    expect(res.data?.current?.authorConfigId).toBe('a'.repeat(64));
    expect(res.data?.history[0].authorConfigId).toBeNull();
  });
});

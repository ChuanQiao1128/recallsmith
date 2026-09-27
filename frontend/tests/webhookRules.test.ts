// The outbound-webhook rules the console runs before the server does
// (src/lib/webhookRules.ts, R18 contract §6). Pure functions, node environment.

import { describe, expect, it } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  WEBHOOK_EVENTS,
  WEBHOOK_NAME_MAX_LENGTH,
  WEBHOOK_SIGNATURE_TEST_VECTOR,
  WEBHOOK_URL_MAX_LENGTH,
  WEBHOOK_VERIFY_SNIPPET,
  WEBHOOK_PREVIOUS_SIGNATURE_HEADER,
  WEBHOOK_STRANDED_AFTER_MS,
  isRedeliverable,
  webhookFormProblems,
  webhookUrlProblem,
} from '../src/lib/webhookRules';

describe('webhookRules', () => {
  it('accepts a public https endpoint', () => {
    expect(webhookUrlProblem('https://hooks.example.com/dc')).toBeNull();
    expect(webhookUrlProblem('  https://n8n.example.org:8443/webhook/abc?x=1  ')).toBeNull();
    expect(webhookUrlProblem('https://8.8.8.8/hook')).toBeNull();
    expect(webhookUrlProblem('https://172.32.0.1/hook')).toBeNull();
    expect(webhookUrlProblem('https://[2001:db8::1]/hook')).toBeNull();
  });

  it('rejects non-https, userinfo, localhost and private IP literals', () => {
    const rejected = [
      '',
      '   ',
      'not a url',
      'http://hooks.example.com/dc',
      'ftp://hooks.example.com/dc',
      'https://user:pass@hooks.example.com/dc',
      'https://user@hooks.example.com/dc',
      'https://localhost/hook',
      'https://api.localhost/hook',
      'https://0.0.0.0/hook',
      'https://10.1.2.3/hook',
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://172.16.0.1/hook',
      'https://172.31.255.255/hook',
      'https://192.168.1.10/hook',
      'https://[::]/hook',
      'https://[::1]/hook',
      'https://[fc00::1]/hook',
      'https://[fd12:3456::1]/hook',
      'https://[fe80::1]/hook',
      'https://[febf::1]/hook',
      `https://hooks.example.com/${'a'.repeat(WEBHOOK_URL_MAX_LENGTH)}`,
    ];
    for (const url of rejected) {
      const problem = webhookUrlProblem(url);
      expect(problem, url).toEqual(expect.any(String));
      expect(problem?.length ?? 0, url).toBeGreaterThan(0);
    }
  });

  it('validates name length and the event list', () => {
    const good = { name: 'n8n', url: 'https://hooks.example.com/dc', events: ['deck.published'] };
    expect(webhookFormProblems(good)).toEqual([]);
    expect(webhookFormProblems({ ...good, events: [...WEBHOOK_EVENTS] })).toEqual([]);
    expect(webhookFormProblems({ ...good, name: 'x'.repeat(WEBHOOK_NAME_MAX_LENGTH) })).toEqual([]);

    expect(webhookFormProblems({ ...good, name: '   ' })).toHaveLength(1);
    expect(webhookFormProblems({ ...good, name: 'x'.repeat(WEBHOOK_NAME_MAX_LENGTH + 1) })).toHaveLength(1);
    expect(webhookFormProblems({ ...good, events: [] })).toHaveLength(1);
    expect(webhookFormProblems({ ...good, events: ['webhook.test'] })).toHaveLength(1);
    expect(webhookFormProblems({ ...good, events: [...WEBHOOK_EVENTS, 'deck.published'] })).toHaveLength(1);
    expect(webhookFormProblems({ ...good, url: 'http://hooks.example.com' })).toHaveLength(1);
    expect(webhookFormProblems({ name: '', url: '', events: [] })).toHaveLength(3);
    expect(WEBHOOK_EVENTS).not.toContain('webhook.test');
  });

  it('matches the published signature test vector', () => {
    const V = WEBHOOK_SIGNATURE_TEST_VECTOR;
    const computed = createHmac('sha256', V.secret).update(`${V.timestamp}.${V.body}`).digest('hex');
    expect(computed).toBe(WEBHOOK_SIGNATURE_TEST_VECTOR.signature);
    expect(WEBHOOK_VERIFY_SNIPPET).toContain('timingSafeEqual');
    expect(WEBHOOK_VERIFY_SNIPPET).toContain('process.env.DC_WEBHOOK_SECRET');
    expect(WEBHOOK_VERIFY_SNIPPET).toContain('eventId');
    expect(WEBHOOK_VERIFY_SNIPPET).not.toContain('whsec-');
  });

  it('verifies the §6.3 vector sent as the primary or the rotation header (automation-6)', () => {
    const V = WEBHOOK_SIGNATURE_TEST_VECTOR;
    // Run the snippet exactly as an integrator would paste it, minus the ESM wrapper.
    const body = WEBHOOK_VERIFY_SNIPPET.replace(/^import .*$/m, '').replace(/^export function/m, 'function');
    const make = new Function(
      'createHmac',
      'timingSafeEqual',
      'process',
      'Buffer',
      'Date',
      `${body}\nreturn verifyDeveloperCardsWebhook;`,
    ) as (...args: unknown[]) => (raw: string, headers: Record<string, string | undefined>) => boolean;
    const clock = { now: () => Number(V.timestamp) * 1000 };
    const verify = make(createHmac, timingSafeEqual, { env: { DC_WEBHOOK_SECRET: V.secret } }, Buffer, clock);
    const base = { 'x-developercards-timestamp': V.timestamp };

    expect(verify(V.body, { ...base, 'x-developercards-signature': V.signature })).toBe(true);
    // Rotation: the primary is signed with the new secret this receiver does not have yet.
    expect(
      verify(V.body, { ...base, 'x-developercards-signature': 'a'.repeat(64), 'x-developercards-signature-previous': V.signature }),
    ).toBe(true);
    expect(verify(V.body, { ...base, 'x-developercards-signature-previous': V.signature })).toBe(true);
    // Malformed or wrong signatures are refused, never thrown on.
    expect(verify(V.body, { ...base, 'x-developercards-signature': V.signature.toUpperCase() })).toBe(false);
    expect(verify(V.body, { ...base, 'x-developercards-signature': 'zz' })).toBe(false);
    expect(verify(V.body, { ...base, 'x-developercards-signature': 'a'.repeat(64) })).toBe(false);
    expect(verify(`${V.body} `, { ...base, 'x-developercards-signature': V.signature })).toBe(false);
    expect(verify(V.body, { 'x-developercards-signature': V.signature })).toBe(false);
    expect(WEBHOOK_VERIFY_SNIPPET).toContain(WEBHOOK_PREVIOUS_SIGNATURE_HEADER.toLowerCase());
  });

  it('offers redelivery only for settled deliveries', () => {
    expect(isRedeliverable('queued')).toBe(false);
    expect(isRedeliverable('retrying')).toBe(false);
    for (const status of ['delivered', 'failed', 'dead', 'enqueue_failed']) {
      expect(isRedeliverable(status), status).toBe(true);
    }
    // automation-1: a never-sent queued row is stranded once it has sat for the sweep interval.
    const now = Date.parse('2026-09-27T12:00:00Z');
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    expect(isRedeliverable('queued', { enqueuedAt: null, updatedAt: at(10) }, now)).toBe(true);
    expect(isRedeliverable('queued', { enqueuedAt: null, updatedAt: at(9) }, now)).toBe(false);
    expect(isRedeliverable('queued', { enqueuedAt: at(30), updatedAt: at(30) }, now)).toBe(false);
    // A server that does not list enqueuedAt: the row may be in flight.
    expect(isRedeliverable('queued', { updatedAt: at(30) }, now)).toBe(false);
    expect(WEBHOOK_STRANDED_AFTER_MS).toBe(10 * 60_000);
  });
});

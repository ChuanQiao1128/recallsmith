// The outbound-webhook rules the console runs before the server does
// (src/lib/webhookRules.ts, R18 contract §6). Pure functions, node environment.

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

import {
  WEBHOOK_EVENTS,
  WEBHOOK_NAME_MAX_LENGTH,
  WEBHOOK_SIGNATURE_TEST_VECTOR,
  WEBHOOK_URL_MAX_LENGTH,
  WEBHOOK_VERIFY_SNIPPET,
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

  it('offers redelivery only for settled deliveries', () => {
    expect(isRedeliverable('queued')).toBe(false);
    expect(isRedeliverable('retrying')).toBe(false);
    for (const status of ['delivered', 'failed', 'dead', 'enqueue_failed']) {
      expect(isRedeliverable(status), status).toBe(true);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server';
import { EVIDENCE_CORPUS_VERSION } from '../src/evidence';
import { loadConfig } from '../src/config';
import { callTool, connect, makeTestEnv } from './helpers';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('bounded local evidence tools', () => {
  it('stays opt-in and does not require login for disabled status', async () => {
    const env = makeTestEnv(); cleanups.push(env.cleanup);
    const client = await connect(env.config); cleanups.push(() => client.close());
    const result = await callTool(client, 'get_content_review_status', { stableUid: 'aws-basics-01' });
    expect(result).toEqual({ isError: true, text: 'EVIDENCE_DISABLED: explicit local evidence configuration is required' });
    expect(loadConfig({ HOME: '/unused', DC_EVIDENCE_CORPUS_ROOT: '/arbitrary' }).evidence).toBeUndefined();
    expect(() => loadConfig({ DC_EVIDENCE_ENABLED: '1' })).toThrow('Explicit evidence configuration');
  });

  it('refuses extra answer/path inputs, traversal, long goals and stale versions before invoking retrieval', async () => {
    const env = makeTestEnv(); cleanups.push(env.cleanup);
    const runEvidence = vi.fn(async () => ({ state: 'unknown', humanPerCardReview: false }));
    const server = createServer({ config: env.config, env: {}, runEvidence });
    const client = new Client({ name: 'evidence-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    cleanups.push(async () => { await client.close(); await server.close(); });
    for (const [name, args] of [
      ['search_evidence', { learningGoal: 'Explain S3 durability.', answer: 'A supplied answer' }],
      ['search_evidence', { learningGoal: 'https://example.com' }],
      ['search_evidence', { learningGoal: 'x'.repeat(801) }],
      ['get_evidence', { evidenceId: 'ev-' + 'a'.repeat(32), corpusVersion: 'b'.repeat(64) }],
      ['get_evidence', { evidenceId: '../../private/file', corpusVersion: EVIDENCE_CORPUS_VERSION }],
      ['get_content_review_status', { stableUid: '../private' }],
      ['get_content_review_status', { stableUid: 'a'.repeat(129) }],
      ['get_content_review_status', { stableUid: 'aws-01', path: '/private' }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect((await callTool(client, name, args)).isError, name).toBe(true);
    }
    expect(runEvidence).not.toHaveBeenCalled();
    const status = await callTool(client, 'get_content_review_status', { stableUid: 'aws_basics-01' });
    expect(status.isError).toBe(false);
    expect(runEvidence).toHaveBeenCalledWith('get_content_review_status', { stableUid: 'aws_basics-01' });
  });

  it('redacts all bridge failures and keeps source paths, queries and secrets out of errors', async () => {
    const env = makeTestEnv(); cleanups.push(env.cleanup);
    env.config.evidence = { corpusRoot: '/private/public', controlRoot: '/private', modelCache: '/private/cache',
      localPython: '/python', corpusVersion: EVIDENCE_CORPUS_VERSION, container: 'local', strategy: 'rrf' };
    const server = createServer({ config: env.config, env: {}, runEvidence: async () => { throw new Error('/private/token secret query'); } });
    const client = new Client({ name: 'evidence-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    cleanups.push(async () => { await client.close(); await server.close(); });
    expect(await callTool(client, 'search_evidence', { learningGoal: 'Explain S3 durability.' }))
      .toEqual({ isError: true, text: 'EVIDENCE_REQUEST_REFUSED' });
  });
});

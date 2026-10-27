import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
const calls = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined, input: '' }));
vi.mock('node:child_process', () => ({ execFile: (_command: string, _args: string[], options: Record<string, unknown>, callback: (err: null, output: string) => void) => {
  calls.options = options;
  return { stdin: { end: (input: string) => { calls.input = input; callback(null, '{"ok":true,"value":{"state":"unknown"}}'); } } };
} }));
import { evidenceRunner, EVIDENCE_CORPUS_VERSION } from '../src/evidence';

it('uses argument arrays and an explicit environment that never passes parent credentials', async () => {
  const config = loadConfig({ HOME: '/unused' });
  config.evidence = { corpusRoot: '/public/retrieval-v3', controlRoot: '/public', localPython: '/python',
    modelCache: '/models', container: 'local', corpusVersion: EVIDENCE_CORPUS_VERSION, strategy: 'rrf' };
  process.env.AWS_SECRET_ACCESS_KEY = 'do-not-inherit-aws';
  process.env.OPENAI_API_KEY = 'do-not-inherit-api';
  try {
    expect(await evidenceRunner(config)('get_content_review_status', { stableUid: 'aws-01' })).toEqual({ state: 'unknown' });
    const env = calls.options?.env as Record<string, string>;
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HOME).toBeUndefined(); expect(env.HF_HUB_OFFLINE).toBe('1');
    expect(JSON.stringify(env)).not.toContain('do-not-inherit');
    expect(calls.input).not.toContain('do-not-inherit');
  } finally { delete process.env.AWS_SECRET_ACCESS_KEY; delete process.env.OPENAI_API_KEY; }
});

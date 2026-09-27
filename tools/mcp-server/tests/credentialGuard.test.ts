// ai-agent-29: the authoring agent must not be able to read its own login credential.
// The server never returns a path inside the token directory, and the repo's Claude Code
// settings deny the built-in tools access to that directory.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callTool, connect, ingestDoc, makeTestEnv, SAMPLE_CHUNK, type TestEnv } from './helpers';

const repoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('credential directory guard (ai-agent-29)', () => {
  let env: TestEnv;
  afterEach(() => env.cleanup());

  it('refuses a read_source result whose path lies in the token directory', async () => {
    env = makeTestEnv();
    const tokenDir = dirname(env.config.tokenFile);
    for (const path of [env.config.tokenFile, join(tokenDir, 'notes.md'), join(realpathSync(env.dir), 'config', 'x.md')]) {
      const doc = { ...ingestDoc('https://example.com/x', { sourceId: 'sid-x', chunks: [SAMPLE_CHUNK] }), path };
      const client = await connect(env.config, async () => ({ code: 0, stdout: JSON.stringify(doc), stderr: '' }));
      const result = await callTool(client, 'read_source', { source: 'https://example.com/x' });
      expect(result.isError, path).toBe(true);
      expect(result.text).toMatch(/login token directory/);
      expect(result.text).not.toContain(tokenDir);
      await client.close();
    }
  });

  it('refuses any successful tool result that names the token directory', async () => {
    env = makeTestEnv();
    const tokenDir = dirname(env.config.tokenFile);
    const doc = ingestDoc('https://example.com/x', { sourceId: 'sid-x', chunks: [`the tokens are in ${env.config.tokenFile} today`] });
    const client = await connect(env.config, async () => ({ code: 0, stdout: JSON.stringify(doc), stderr: '' }));
    const result = await callTool(client, 'read_source', { source: 'https://example.com/x' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/login token directory/);
    expect(result.text).not.toContain(tokenDir);
    await client.close();
  });

  it('keeps a sibling directory whose name only starts with the token directory name', async () => {
    env = makeTestEnv();
    const doc = ingestDoc('https://example.com/x', { sourceId: 'sid-x', chunks: [`see ${dirname(env.config.tokenFile)}-backup/readme`] });
    const client = await connect(env.config, async () => ({ code: 0, stdout: JSON.stringify(doc), stderr: '' }));
    const result = await callTool(client, 'read_source', { source: 'https://example.com/x' });
    expect(result.isError).toBe(false);
    await client.close();
  });

  it('removes the token directory from a failure message', async () => {
    env = makeTestEnv();
    const tokenDir = dirname(env.config.tokenFile);
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(env.config.tokenFile, '{}');
    const client = await connect(env.config, async () => ({
      code: 1,
      stdout: '',
      stderr: `dc-ingest: error: refused ${env.config.tokenFile}\n`,
    }));
    const result = await callTool(client, 'read_source', { source: 'https://example.com/x' });
    expect(result.isError).toBe(true);
    expect(result.text).toBe('dc-ingest exited 1: dc-ingest: error: refused <login token directory>/mcp-tokens.json');
    await client.close();
  });

  it('commits Claude Code deny rules for the token directory', () => {
    const settings = JSON.parse(repoFile('.claude/settings.json')) as { permissions?: { deny?: string[] } };
    const deny = settings.permissions?.deny ?? [];
    for (const rule of [
      'Read(~/.config/developercards/**)',
      'Edit(~/.config/developercards/**)',
      'Grep(~/.config/developercards/**)',
      'Bash(*mcp-tokens*)',
      'Bash(*.config/developercards*)',
    ]) {
      expect(deny).toContain(rule);
    }
  });

  it('limits the author-cards skill to the developercards tools, the verifier subagent and its own inputs', () => {
    const skill = repoFile('.claude/skills/author-cards/SKILL.md');
    const frontmatter = skill.split('---')[1] ?? '';
    const line = frontmatter.split('\n').find((l) => l.startsWith('allowed-tools:')) ?? '';
    const tools = line.replace('allowed-tools:', '').split(',').map((t) => t.trim()).filter((t) => t !== '');
    expect(tools).toEqual([
      'mcp__developercards__read_source',
      'mcp__developercards__find_similar_cards',
      'mcp__developercards__lint_card',
      'mcp__developercards__submit_draft',
      'Task',
      'Agent',
      'Read(content/decks/FORMAT.md)',
      'Read(.claude/skills/author-cards/**)',
      'Read(sources/**)',
    ]);
    expect(skill).toMatch(/Never try to obtain, read or copy tokens yourself/);
  });
});

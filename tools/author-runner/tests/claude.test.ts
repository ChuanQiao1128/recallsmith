import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_TOOLS,
  SCRUBBED_ENV_NAMES,
  claudeArgs,
  claudeOutcome,
  claudeVersion,
  scrubEnv,
  type ClaudeRun,
} from '../src/claude';
import { makeHome } from './helpers';

const exited = (exitCode: number | null): ClaudeRun => ({ pid: 1, exitCode, signal: null, timedOut: false, spawnError: null });

describe('claude invocation', () => {
  it('builds exactly the contract CLAUDE_ARGS', () => {
    expect(claudeArgs('PROMPT TEXT', 'opus', '/tmp/logs/runs/abc.mcp.json')).toEqual([
      '-p',
      'PROMPT TEXT',
      '--output-format',
      'json',
      '--model',
      'opus',
      '--mcp-config',
      '/tmp/logs/runs/abc.mcp.json',
      '--strict-mcp-config',
      '--setting-sources',
      'project',
      '--tools',
      'Read,Task,Agent,Skill',
      '--allowedTools',
      'mcp__developercards__read_source,mcp__developercards__find_similar_cards,mcp__developercards__lint_card,mcp__developercards__submit_draft,Task,Agent,Skill,Read(content/decks/FORMAT.md),Read(.claude/skills/author-cards/**)',
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
    ]);
    expect(CLAUDE_TOOLS).toBe('Read,Task,Agent,Skill');
    const everything = [...claudeArgs('p', 'opus', 'm'), CLAUDE_ALLOWED_TOOLS].join(' ');
    expect(everything).not.toMatch(/dangerously|Bash|WebFetch|Edit|Write/);
  });

  it('removes cloud credentials and API keys from the claude environment', () => {
    const input: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/example',
      DC_API_BASE: 'https://api.example.com',
      DC_RUNNER_MODEL: 'opus',
      UNSET_VALUE: undefined,
    };
    for (const name of SCRUBBED_ENV_NAMES) input[name] = 'PLACEHOLDER-not-a-secret';
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION']) {
      input[name] = 'PLACEHOLDER-not-a-secret';
    }
    expect(scrubEnv(input)).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/Users/example',
      DC_API_BASE: 'https://api.example.com',
      DC_RUNNER_MODEL: 'opus',
    });
    expect(SCRUBBED_ENV_NAMES).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
    ]);
  });

  it('reads the version line of the fake claude and null for a missing binary', () => {
    const t = makeHome();
    try {
      expect(claudeVersion(t.claudeBin)).toBe('2.1.283 (Claude Code, test fake)');
      expect(claudeVersion(`${t.dir}/missing-claude`)).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it('maps a claude result to the complete outcome', () => {
    const ok = (text: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type: 'result', is_error: false, num_turns: 3, result: text, ...extra });
    expect(claudeOutcome(exited(0), ok('work\n{"outcome":"nothing_new","submitted":0,"notes":"n"}\n\n'), '')).toEqual({
      outcome: 'nothing_new',
      exitCode: 0,
      numTurns: 3,
      error: null,
      summary: 'n',
    });
    expect(claudeOutcome(exited(0), ok('no json line at the end'), '')).toMatchObject({ outcome: 'done', summary: null });
    expect(claudeOutcome(exited(0), ok('{"outcome":"weird"}', { num_turns: 2.5 }), '')).toMatchObject({
      outcome: 'done',
      numTurns: null,
    });
    expect(claudeOutcome(exited(0), ok(`{"outcome":"done","notes":"${'x'.repeat(2500)}"}`), '').summary).toHaveLength(2000);
    expect(claudeOutcome(exited(1), '', '')).toMatchObject({ outcome: 'failed', exitCode: 1, error: 'exit 1' });
    expect(claudeOutcome({ ...exited(null), timedOut: true }, '', 'x')).toMatchObject({ error: 'timeout', exitCode: null });
  });
});

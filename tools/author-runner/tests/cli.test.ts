import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTOMATION_SOURCE_HOSTS } from '../../mcp-server/src/config';
import { USAGE, main } from '../src/cli';
import { DEFAULT_RUNNER_MODEL, FLOATING_MODEL_ALIASES, loadRunnerConfig, ConfigError } from '../src/config';
import { EXIT_OK } from '../src/runner';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('--help (ai-agent-22)', () => {
  it('prints the usage with the model default the config uses and every DC_RUNNER_* variable it reads', async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    expect(await main(['--help'])).toBe(EXIT_OK);
    const help = written.join('');
    expect(help).toBe(USAGE);

    // The advertised model default is the one loadRunnerConfig applies, and the old alias default is gone.
    expect(help).toContain(`(default ${DEFAULT_RUNNER_MODEL})`);
    expect(loadRunnerConfig({ HOME: '/tmp/dc-help-home' }).model).toBe(DEFAULT_RUNNER_MODEL);
    expect(help).not.toMatch(/default opus\)/);
    // The aliases the config refuses are named as refused, never as a default.
    expect(FLOATING_MODEL_ALIASES).toContain('opus');
    expect(() => loadRunnerConfig({ HOME: '/tmp/dc-help-home', DC_RUNNER_MODEL: 'opus' })).toThrow(ConfigError);
    expect(help).toMatch(/aliases such as opus or sonnet are refused/);

    // Every DC_RUNNER_* variable config.ts reads is documented, DC_RUNNER_SOURCE_HOSTS included with its default.
    const configSource = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    const read = new Set([...configSource.matchAll(/DC_RUNNER_[A-Z_]+/g)].map((m) => m[0]));
    expect(read).toContain('DC_RUNNER_SOURCE_HOSTS');
    for (const name of read) expect(help).toContain(`  ${name} `);
    expect(help).toContain(DEFAULT_AUTOMATION_SOURCE_HOSTS.join(','));
  });
});

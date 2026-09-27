import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, RUNNER_VERSION, defaultRunnerId, loadRunnerConfig } from '../src/config';

const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const HOME = '/tmp/dc-runner-config-home';

function configError(env: Record<string, string>): string {
  try {
    loadRunnerConfig({ HOME, ...env });
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as Error).message;
  }
  throw new Error('expected a ConfigError');
}

describe('config', () => {
  it('derives the runner id from the hostname', () => {
    expect(defaultRunnerId('Owners-MacBook-Pro.local')).toBe('owners-macbook-pro-local');
    expect(defaultRunnerId("Owner's  Mac mini")).toBe('owner-s-mac-mini');
    expect(defaultRunnerId('--Studio--')).toBe('studio');
    expect(defaultRunnerId('')).toBe('mac');
    expect(defaultRunnerId('***')).toBe('mac');
    expect(defaultRunnerId('日本')).toBe('mac');
    const long = defaultRunnerId(`a${'b'.repeat(100)}`);
    expect(long).toHaveLength(64);
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);

    const config = loadRunnerConfig({ HOME });
    expect(config.runnerId).toBe(defaultRunnerId(hostname()));
    expect(config).toMatchObject({
      maxItems: 3,
      leaseMinutes: 90,
      itemTimeoutMinutes: 45,
      itemTimeoutMs: 45 * 60_000,
      heartbeatIntervalMs: 300_000,
      killGraceMs: 30_000,
      model: 'opus',
      claudeBin: 'claude',
      logDir: `${HOME}/Library/Logs/DeveloperCards`,
      lockFile: `${HOME}/Library/Application Support/DeveloperCards/author-runner.lock`,
    });
    expect(config.api.tokenFile).toBe(`${HOME}/.config/developercards/mcp-tokens.json`);

    const custom = loadRunnerConfig({
      HOME,
      DC_RUNNER_ID: 'studio-1',
      DC_RUNNER_MAX_ITEMS: '5',
      DC_RUNNER_LEASE_MINUTES: '15',
      DC_RUNNER_ITEM_TIMEOUT_MINUTES: '120',
      DC_RUNNER_MODEL: 'claude-opus-5-5',
      DC_RUNNER_CLAUDE_BIN: '/opt/bin/claude',
      DC_RUNNER_LOG_DIR: '/tmp/logs',
      DC_API_BASE: 'http://127.0.0.1:9',
      DC_REPO_ROOT: '/tmp/repo',
    });
    expect(custom).toMatchObject({
      runnerId: 'studio-1',
      maxItems: 5,
      leaseMinutes: 15,
      itemTimeoutMs: 120 * 60_000,
      model: 'claude-opus-5-5',
      claudeBin: '/opt/bin/claude',
      logDir: '/tmp/logs',
    });
    expect(custom.api).toMatchObject({ apiBase: 'http://127.0.0.1:9', repoRoot: '/tmp/repo' });
  });

  it('rejects values out of range with the variable and its range', () => {
    expect(configError({ DC_RUNNER_MAX_ITEMS: '0' })).toBe('DC_RUNNER_MAX_ITEMS must be an integer from 1 to 5');
    expect(configError({ DC_RUNNER_MAX_ITEMS: '6' })).toBe('DC_RUNNER_MAX_ITEMS must be an integer from 1 to 5');
    expect(configError({ DC_RUNNER_MAX_ITEMS: '2.5' })).toBe('DC_RUNNER_MAX_ITEMS must be an integer from 1 to 5');
    expect(configError({ DC_RUNNER_LEASE_MINUTES: '14' })).toBe('DC_RUNNER_LEASE_MINUTES must be an integer from 15 to 240');
    expect(configError({ DC_RUNNER_LEASE_MINUTES: '241' })).toBe('DC_RUNNER_LEASE_MINUTES must be an integer from 15 to 240');
    expect(configError({ DC_RUNNER_ITEM_TIMEOUT_MINUTES: '4' })).toBe(
      'DC_RUNNER_ITEM_TIMEOUT_MINUTES must be an integer from 5 to 120',
    );
    expect(configError({ DC_RUNNER_ITEM_TIMEOUT_MINUTES: 'abc' })).toBe(
      'DC_RUNNER_ITEM_TIMEOUT_MINUTES must be an integer from 5 to 120',
    );
    expect(configError({ DC_RUNNER_ID: 'Bad_Id' })).toContain('DC_RUNNER_ID');
    expect(configError({ DC_RUNNER_ID: `a${'b'.repeat(64)}` })).toContain('DC_RUNNER_ID');
    expect(configError({ DC_RUNNER_MODEL: 'two words' })).toContain('DC_RUNNER_MODEL');
    expect(configError({ DC_RUNNER_MODEL: 'x'.repeat(101) })).toContain('DC_RUNNER_MODEL');
    expect(configError({ DC_API_BASE: 'http://api.example.com' })).toContain('DC_API_BASE');
  });

  it('keeps RUNNER_VERSION equal to the package.json version', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
    expect(RUNNER_VERSION).toBe(pkg.version);
  });
});

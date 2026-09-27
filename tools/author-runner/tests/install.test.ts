import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = join(PACKAGE, 'scripts', 'install.sh');

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

function fakeBin(bin: string, name: string, body: string): void {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

describe('install.sh', () => {
  it('renders the launchd plist in DRY_RUN without writing anything', () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'dc-runner-install-')));
    const home = join(dir, 'home');
    const bin = join(dir, 'bin');
    const repo = join(dir, 'repo & <co>');
    for (const d of [home, bin, join(repo, 'tools/mcp-server/dist'), join(repo, 'tools/author-runner/dist')]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(join(repo, 'tools/mcp-server/dist/index.js'), '');
    writeFileSync(join(repo, 'tools/author-runner/dist/index.js'), '');
    // Fake claude and uv come first on PATH; the script only locates them and never runs claude.
    fakeBin(bin, 'claude', `: > "${dir}/claude-was-run"; exit 1`);
    fakeBin(bin, 'uv', 'exit 0');
    const tokenFile = join(dir, 'tokens.json');
    writeFileSync(tokenFile, '{}');

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      DC_REPO_ROOT: repo,
      DC_TOKEN_FILE: tokenFile,
      DRY_RUN: '1',
    };
    const res = spawnSync('bash', [INSTALL], { env, encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const plist = res.stdout;
    expect(plist.startsWith('<?xml')).toBe(true);
    expect(plist).toContain('<string>app.developercards.author-runner</string>');
    expect(plist).toContain('<integer>3600</integer>');
    expect(plist).toContain('<false/>');
    expect(plist).not.toMatch(/__[A-Z]+__/);
    const escapedRepo = repo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(plist).toContain(`<string>${escapedRepo}/tools/author-runner/dist/index.js</string>`);
    expect(plist).toContain(`<string>${home}/Library/Logs/DeveloperCards/author-runner.log</string>`);
    expect(plist).toContain(`<string>${home}</string>`);
    const nodeDir = dirname(spawnSync('sh', ['-c', 'command -v node'], { env, encoding: 'utf8' }).stdout.trim());
    const pathValue = [...new Set([nodeDir, bin, bin])].join(':');
    expect(plist).toContain(`<string>${pathValue}:/usr/bin:/bin</string>`);
    // ai-agent-22: the repo root and the non-default token file install.sh checked reach every hourly run.
    expect(plist).toContain(`<key>DC_REPO_ROOT</key>\n    <string>${escapedRepo}</string>`);
    expect(plist).toContain(`<key>DC_TOKEN_FILE</key>\n    <string>${tokenFile}</string>`);

    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['bin', 'home', 'repo & <co>', 'tokens.json']);

    rmSync(tokenFile);
    const missing = spawnSync('bash', [INSTALL], { env, encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('token file');
    expect(readdirSync(home)).toEqual([]);
  });
});

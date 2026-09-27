import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunnerApi } from '../src/api';
import { loadRunnerConfig } from '../src/config';
import { envelope, makeHome, sendJson, startFakeApi, writeTokenFile } from './helpers';

// The same pattern as MCP_CALL_RE in infra/scripts/check-agent-routes.py.
const MCP_CALL_RE = /request(?:<.*?>)?\(\s*['"](GET|POST|PUT|DELETE|PATCH)['"]\s*,\s*[`'"](\/api\/[^`'"?$]*)/gs;
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ROUTES = [
  '/api/v1/authoring/automation/runner/claim',
  '/api/v1/authoring/automation/runner/complete',
  '/api/v1/authoring/automation/runner/heartbeat',
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsFiles(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

let cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

describe('runner API client', () => {
  it('calls exactly the three runner routes', async () => {
    const calls = new Set<string>();
    const texts = tsFiles(SRC).map((file) => readFileSync(file, 'utf8'));
    for (const text of texts) {
      for (const m of text.matchAll(MCP_CALL_RE)) calls.add(`${m[1]} ${m[2]}`);
    }
    expect([...calls].sort()).toEqual(ROUTES.map((r) => `POST ${r}`));
    // No other /api/ path appears anywhere under src/.
    expect(texts.join('\n').match(/\/api\/[A-Za-z0-9/_-]*/g)?.sort()).toEqual(ROUTES);

    // Each call is an authenticated POST to its route, and the envelope is unwrapped.
    const t = makeHome();
    cleanups.push(t.cleanup);
    const api = await startFakeApi((req, res) => sendJson(res, 200, envelope({ echo: req.url })));
    cleanups.push(api.close);
    writeTokenFile(t.tokenFile);
    const client = createRunnerApi(loadRunnerConfig({ HOME: t.home, DC_API_BASE: api.base, DC_TOKEN_FILE: t.tokenFile }).api);
    const answer = await client.claim({ runnerId: 'r', max: 1, leaseMinutes: 90 });
    expect(answer).toEqual({ echo: '/api/v1/authoring/automation/runner/claim' });
    expect(api.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/v1/authoring/automation/runner/claim']);
  });
});

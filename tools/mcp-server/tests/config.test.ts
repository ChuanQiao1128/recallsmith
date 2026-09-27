import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses the contract defaults when no env is set', () => {
    const config = loadConfig({ HOME: '/home/tester' });
    expect(config).toEqual({
      apiBase: 'https://api.developercards.app',
      cognitoDomain: 'https://ap-southeast-24vf8ucxkt.auth.ap-southeast-2.amazoncognito.com',
      clientId: '5au94igdq00nipsst7spsqepb7',
      redirectPort: 8976,
      tokenFile: '/home/tester/.config/developercards/mcp-tokens.json',
      repoRoot: fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, ''),
    });
  });

  it('refuses a plain-http API base that is not loopback', () => {
    expect(() => loadConfig({ HOME: '/h', DC_API_BASE: 'http://api.example.com' })).toThrow(/DC_API_BASE/);
    expect(() => loadConfig({ HOME: '/h', DC_COGNITO_DOMAIN: 'http://auth.example.com' })).toThrow(/DC_COGNITO_DOMAIN/);
    expect(() => loadConfig({ HOME: '/h', DC_API_BASE: 'ftp://127.0.0.1' })).toThrow(/DC_API_BASE/);
  });

  it('accepts loopback http, strips trailing slashes and reads every override', () => {
    const config = loadConfig({
      HOME: '/h',
      DC_API_BASE: 'http://127.0.0.1:1234/',
      DC_COGNITO_DOMAIN: 'http://localhost:5678//',
      DC_COGNITO_CLIENT_ID: 'client-x',
      DC_REDIRECT_PORT: '0',
      DC_TOKEN_FILE: '/tmp/t.json',
      DC_REPO_ROOT: '/repo/',
    });
    expect(config).toEqual({
      apiBase: 'http://127.0.0.1:1234',
      cognitoDomain: 'http://localhost:5678',
      clientId: 'client-x',
      redirectPort: 0,
      tokenFile: '/tmp/t.json',
      repoRoot: '/repo',
    });
    expect(loadConfig({ HOME: '/h', DC_API_BASE: 'http://[::1]:80' }).apiBase).toBe('http://[::1]:80');
  });

  it('rejects a redirect port outside 0..65535', () => {
    expect(() => loadConfig({ HOME: '/h', DC_REDIRECT_PORT: '65536' })).toThrow(/DC_REDIRECT_PORT/);
    expect(() => loadConfig({ HOME: '/h', DC_REDIRECT_PORT: 'abc' })).toThrow(/DC_REDIRECT_PORT/);
  });
});

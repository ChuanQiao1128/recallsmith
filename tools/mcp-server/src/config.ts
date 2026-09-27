// Runtime configuration (contract §8.4). Every key is optional; the defaults
// point at production and the console-dev client. Tests override them with
// loopback servers and a temp token file.

import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export interface Config {
  apiBase: string;
  cognitoDomain: string;
  clientId: string;
  redirectPort: number;
  tokenFile: string;
  repoRoot: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** https always; plain http only for a loopback host, so a bearer token never travels in clear text. */
function baseUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  if (!ok) throw new Error(`${name} must be an https URL (plain http is accepted only for 127.0.0.1, localhost or [::1])`);
  return raw.replace(/\/+$/, '');
}

function port(raw: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error('DC_REDIRECT_PORT must be an integer from 0 to 65535');
  }
  return n;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = env.HOME ?? homedir();
  return {
    apiBase: baseUrl('DC_API_BASE', nonEmpty(env.DC_API_BASE) ?? 'https://api.developercards.app'),
    cognitoDomain: baseUrl(
      'DC_COGNITO_DOMAIN',
      nonEmpty(env.DC_COGNITO_DOMAIN) ?? 'https://ap-southeast-24vf8ucxkt.auth.ap-southeast-2.amazoncognito.com',
    ),
    clientId: nonEmpty(env.DC_COGNITO_CLIENT_ID) ?? '5au94igdq00nipsst7spsqepb7',
    redirectPort: port(nonEmpty(env.DC_REDIRECT_PORT) ?? '8976'),
    tokenFile: nonEmpty(env.DC_TOKEN_FILE) ?? `${home}/.config/developercards/mcp-tokens.json`,
    // src/config.ts and dist/index.js both sit two levels below the repo root's tools/.
    repoRoot: (nonEmpty(env.DC_REPO_ROOT) ?? fileURLToPath(new URL('../../../', import.meta.url))).replace(/(.)\/+$/, '$1'),
  };
}

/**
 * The hosts an automation run may read with read_source when the runner passes no
 * DC_AUTOMATION_SOURCE_HOSTS: the documentation hosts the decks cite, the same list as the
 * server's AUTOMATION_SOURCE_HOSTS default (A00 §4).
 */
export const DEFAULT_AUTOMATION_SOURCE_HOSTS: readonly string[] = [
  'docs.aws.amazon.com',
  'aws.amazon.com',
  'platform.claude.com',
  'docs.claude.com',
  'docs.anthropic.com',
  'www.anthropic.com',
];

/** A comma list of exact hosts: trimmed, lower-cased, empties and duplicates dropped, order kept. */
export function parseHostList(raw: string | undefined): string[] {
  const hosts: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host !== '' && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

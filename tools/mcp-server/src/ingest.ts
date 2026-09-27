// read_source: runs the ingest CLI (contract §8.5) through `uv run` and returns its
// JSON. The source text is data for the agent to cite; nothing in it is executed.
// Local paths are checked here (document suffix, credential locations) and again,
// in full, by dc-ingest (allowed roots, hidden segments, symlinks).

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { credentialGuard } from './credentialGuard';

export type RunProcess = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const INGEST_TIMEOUT_MS = 120_000;
const STDOUT_CAP_BYTES = 20 * 1024 * 1024;
const STDERR_CAP_BYTES = 1024 * 1024;

export class IngestError extends Error {
  constructor(message: string) {
    super(message.replace(/[\r\n]+/g, ' '));
    this.name = 'IngestError';
  }
}

/** spawn with an argument array (never a shell); killed on timeout; stdout capped at 20 MB. */
export const defaultRunProcess: RunProcess = (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let failure: Error | null = null;

    const timer = setTimeout(() => {
      failure = new IngestError(`dc-ingest timed out after ${Math.round(options.timeoutMs / 1000)} s`);
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > STDOUT_CAP_BYTES) {
        failure ??= new IngestError('dc-ingest output exceeds 20 MB');
        child.kill('SIGKILL');
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes <= STDERR_CAP_BYTES) err.push(chunk);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new IngestError(`cannot start ${command}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure !== null) {
        reject(failure);
        return;
      }
      resolvePromise({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });

export interface ReadSourceInput {
  source: string;
  canonicalUrl?: string;
  maxChunkChars?: number;
}

/**
 * Where read_source runs and which credential file it must never read. `allowedHosts`, set
 * inside an automation run, is the only set of https hosts it may fetch (redirects included).
 */
export interface IngestContext {
  repoRoot: string;
  tokenFile: string;
  allowedHosts?: readonly string[];
}

/** Refuses an https URL whose host is not in the automation run's allowlist (ai-agent-1). */
export function checkSourceHost(url: string, allowedHosts: readonly string[] | undefined): void {
  if (allowedHosts === undefined) return;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new IngestError('source must be an https:// URL or a local file path');
  }
  if (!allowedHosts.includes(host)) {
    throw new IngestError(
      `SOURCE_HOST_NOT_ALLOWED: ${host} is not in DC_AUTOMATION_SOURCE_HOSTS; an automation run reads only ${allowedHosts.join(', ') || '(no host)'}`,
    );
  }
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
export const LOCAL_SOURCE_SUFFIXES = ['.pdf', '.html', '.htm', '.md', '.markdown', '.txt'];

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Refuses a local path that is not a document (.pdf/.html/.htm/.md/.markdown/.txt) or that
 * lies in ~/.config, ~/.ssh, ~/.aws or the token file's directory, before and after symlinks.
 * dc-ingest repeats these checks and also confines the path to the allowed source roots.
 */
export function checkLocalSource(path: string, tokenFile: string, home: string = process.env.HOME ?? homedir()): void {
  const candidates = [path, realpathOrSelf(path)];
  for (const candidate of candidates) {
    if (!LOCAL_SOURCE_SUFFIXES.includes(extname(candidate).toLowerCase())) {
      throw new IngestError(`refused local file ${path}: only ${LOCAL_SOURCE_SUFFIXES.join(', ')} files are read`);
    }
  }
  const token = resolve(tokenFile);
  const denied = [token, dirname(token), join(home, '.config'), join(home, '.ssh'), join(home, '.aws')];
  for (const root of denied.flatMap((d) => [d, realpathOrSelf(d)])) {
    if (candidates.some((candidate) => within(candidate, root))) {
      throw new IngestError(`refused local file ${path}: credential locations are never read`);
    }
  }
}

export function buildIngestArgs(context: IngestContext, input: ReadSourceInput, cwd: string = process.cwd()): string[] {
  const { repoRoot } = context;
  let source = input.source;
  if (URL_SCHEME.test(source)) {
    if (!source.startsWith('https://')) {
      throw new IngestError('source must be an https:// URL or a local file path');
    }
    checkSourceHost(source, context.allowedHosts);
  } else {
    source = resolve(cwd, source);
    checkLocalSource(source, context.tokenFile);
  }
  return [
    'run',
    '--project',
    `${repoRoot}/tools/ingest`,
    '--python',
    '3.12',
    'dc-ingest',
    '--json',
    ...(input.canonicalUrl ? ['--canonical-url', input.canonicalUrl] : []),
    ...(input.maxChunkChars !== undefined ? ['--max-chunk-chars', String(input.maxChunkChars)] : []),
    source,
  ];
}

/**
 * process.env with ~/.local/bin appended to PATH, so a GUI-launched Claude Code still finds uv,
 * plus DC_REPO_ROOT and DC_TOKEN_FILE so dc-ingest applies the same source root and token-file refusal,
 * and, inside an automation run, DC_INGEST_ALLOWED_HOSTS so dc-ingest refuses a redirect to another host.
 */
export function ingestEnv(context: IngestContext, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = env.HOME ?? homedir();
  const path = env.PATH ?? '';
  return {
    ...env,
    PATH: path === '' ? `${home}/.local/bin` : `${path}:${home}/.local/bin`,
    DC_REPO_ROOT: context.repoRoot,
    DC_TOKEN_FILE: context.tokenFile,
    ...(context.allowedHosts !== undefined ? { DC_INGEST_ALLOWED_HOSTS: context.allowedHosts.join(',') } : {}),
  };
}

export async function readSource(context: IngestContext, input: ReadSourceInput, runProcess: RunProcess): Promise<unknown> {
  const args = buildIngestArgs(context, input);
  const result = await runProcess('uv', args, { env: ingestEnv(context), timeoutMs: INGEST_TIMEOUT_MS });
  if (result.code !== 0) {
    const lines = result.stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
    const last = lines[lines.length - 1]?.trim() ?? '(no stderr)';
    throw new IngestError(`dc-ingest exited ${result.code}: ${last}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new IngestError('dc-ingest returned unexpected output');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    !Array.isArray((parsed as { chunks?: unknown }).chunks)
  ) {
    throw new IngestError('dc-ingest returned unexpected output');
  }
  // Never hand the agent a file from the login token directory, whatever dc-ingest read (ai-agent-29).
  const path = (parsed as { path?: unknown }).path;
  if (typeof path === 'string' && path !== '' && credentialGuard(context.tokenFile).contains(path)) {
    throw new IngestError('refused: dc-ingest returned a file in the login token directory, which is never read');
  }
  return parsed;
}

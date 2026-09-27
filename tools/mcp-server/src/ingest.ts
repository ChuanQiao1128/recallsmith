// read_source: runs the ingest CLI (contract §8.5) through `uv run` and returns its
// JSON. The source text is data for the agent to cite; nothing in it is executed.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

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

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function buildIngestArgs(repoRoot: string, input: ReadSourceInput, cwd: string = process.cwd()): string[] {
  let source = input.source;
  if (URL_SCHEME.test(source)) {
    if (!source.startsWith('https://')) {
      throw new IngestError('source must be an https:// URL or a local file path');
    }
  } else {
    source = resolve(cwd, source);
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

/** process.env with ~/.local/bin appended to PATH, so a GUI-launched Claude Code still finds uv. */
export function ingestEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = env.HOME ?? homedir();
  const path = env.PATH ?? '';
  return { ...env, PATH: path === '' ? `${home}/.local/bin` : `${path}:${home}/.local/bin` };
}

export async function readSource(repoRoot: string, input: ReadSourceInput, runProcess: RunProcess): Promise<unknown> {
  const args = buildIngestArgs(repoRoot, input);
  const result = await runProcess('uv', args, { env: ingestEnv(), timeoutMs: INGEST_TIMEOUT_MS });
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
  return parsed;
}

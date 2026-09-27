// The pinned authoring configuration of a run (ai-agent-3): the model, the skill version
// parsed from SKILL.md, and SHA-256 hashes of the skill files, the prompt template, the
// claude argument list and the MCP server bundle, all read from disk when the run starts.
// Its `id` changes whenever any of them changes (a branch switch, an uncommitted SKILL.md
// edit, a rebuilt MCP server), so a changed author configuration is visible on every run.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { claudeArgs } from './claude';

export interface AuthorConfig {
  id: string;
  model: string;
  skillVersion: string;
  skillSha256: string;
  promptSha256: string;
  claudeArgsSha256: string;
  mcpServerSha256: string | null;
  claudeVersion: string | null;
  runnerVersion: string;
}

export class AuthorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorConfigError';
  }
}

export const SKILL_DIR = join('.claude', 'skills', 'author-cards');
const SKILL_VERSION_RE = /^Skill version: `(author-cards@[0-9A-Za-z.+-]{1,40})`/m;

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The `Skill version: \`author-cards@x.y.z\`` line of SKILL.md, or null when there is none. */
export function skillVersionFrom(skillMd: string): string | null {
  return SKILL_VERSION_RE.exec(skillMd)?.[1] ?? null;
}

/** SHA-256 over every file of the skill directory (sorted relative path, NUL, content, NUL). */
function skillDirSha256(dir: string): string {
  const hash = createHash('sha256');
  const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function fileSha256(file: string): string | null {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
}

export interface AuthorConfigInput {
  repoRoot: string;
  model: string;
  promptTemplate: string;
  claudeVersion: string | null;
  runnerVersion: string;
}

/** Reads the author configuration from the checkout; throws AuthorConfigError when the skill cannot be pinned. */
export function readAuthorConfig(input: AuthorConfigInput): AuthorConfig {
  const skillDir = join(input.repoRoot, SKILL_DIR);
  let skillMd: string;
  try {
    skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  } catch {
    throw new AuthorConfigError(`cannot read ${join(SKILL_DIR, 'SKILL.md')} in the repo root`);
  }
  const skillVersion = skillVersionFrom(skillMd);
  if (skillVersion === null) throw new AuthorConfigError('SKILL.md has no "Skill version: `author-cards@…`" line');

  const fields: Omit<AuthorConfig, 'id'> = {
    model: input.model,
    skillVersion,
    skillSha256: skillDirSha256(skillDir),
    promptSha256: sha256(input.promptTemplate),
    claudeArgsSha256: sha256(claudeArgs('<prompt>', input.model, '<mcp-config>').join('\0')),
    mcpServerSha256: fileSha256(join(input.repoRoot, 'tools', 'mcp-server', 'dist', 'index.js')),
    claudeVersion: input.claudeVersion,
    runnerVersion: input.runnerVersion,
  };
  return { id: sha256(JSON.stringify(fields)).slice(0, 16), ...fields };
}

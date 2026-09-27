// The pinned authoring configuration of a run (ai-agent-3): the model, the skill version
// parsed from SKILL.md, and SHA-256 hashes of the skill files, the prompt template, the
// claude argument list, the MCP tool surface and the MCP server bundle, all read from disk
// when the run starts. Its `id` changes whenever any of them changes (a branch switch, an
// uncommitted SKILL.md edit, a rebuilt MCP server), so a changed author configuration is
// visible on every run.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, TOOL_SURFACE_FILE, toolSurfaceSha256, type ToolSurface, type ToolSurfaceFile } from '../../mcp-server/src/toolSurfaceHash';
import { claudeArgs } from './claude';

export interface AuthorConfig {
  /** The local fingerprint of everything the run pinned, CLI and runner versions included. */
  id: string;
  /**
   * M1: the author identity an eval gate is bound to: lowercase hex SHA-256 of the canonical JSON (sorted keys,
   * no spaces) of { argsSha256, model, promptSha256, skillSha256, skillVersion }. It leaves out the CLI and runner
   * versions, so a routine Claude Code auto-update does not change it (ai-agent-3). N4: argsSha256 covers the MCP
   * tool surface too (see claudeArgsSha256).
   */
  authorConfigId: string;
  model: string;
  skillVersion: string;
  skillSha256: string;
  promptSha256: string;
  /**
   * SHA-256 of what the agent is started with (N4): the claude argument list and the MCP tool surface it sees
   * (`<args joined by NUL>` NUL `toolSurfaceSha256`). It is the gated argsSha256, so a changed tool name,
   * description, input schema, lint/grounding limit or MCP server version is a new authorConfigId.
   */
  claudeArgsSha256: string;
  /** N4: SHA-256 of the canonical JSON of tools/mcp-server/dist/tool-surface.json. */
  toolSurfaceSha256: string;
  /** N4: the version the MCP server the run starts reports. */
  mcpServerVersion: string;
  /** N4: the sorted names of the MCP tools the agent sees. */
  mcpToolNames: string[];
  mcpServerSha256: string;
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

/** The MCP server bundle every run starts; without it the agent would have no DeveloperCards tools (ai-agent-13). */
export const MCP_SERVER_BUNDLE = join('tools', 'mcp-server', 'dist', 'index.js');
/** N4: the tool surface the MCP server build lists next to its bundle. */
export const MCP_TOOL_SURFACE = join('tools', 'mcp-server', 'dist', TOOL_SURFACE_FILE);

/**
 * The tool surface file, checked for the shape the MCP server build writes and for the bundle it
 * describes (ai-agent-28: its bundleSha256 must be the SHA-256 of the dist/index.js next to it, so
 * a surface left over from an earlier build never pins a changed bundle); throws AuthorConfigError otherwise.
 */
function readToolSurface(repoRoot: string, mcpServerSha256: string): ToolSurface {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(repoRoot, MCP_TOOL_SURFACE), 'utf8'));
  } catch {
    throw new AuthorConfigError(`cannot read ${MCP_TOOL_SURFACE} in the repo root (build tools/mcp-server)`);
  }
  const p = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Partial<ToolSurface>;
  const server = p.server as { name?: unknown; version?: unknown } | undefined;
  const tools = p.tools as Array<{ name?: unknown }> | undefined;
  const valid =
    typeof server?.name === 'string' &&
    typeof server.version === 'string' &&
    server.version !== '' &&
    Array.isArray(tools) &&
    tools.length > 0 &&
    tools.every((tool) => typeof tool === 'object' && tool !== null && typeof tool.name === 'string' && tool.name !== '') &&
    typeof p.constants === 'object' &&
    p.constants !== null;
  if (!valid) throw new AuthorConfigError(`${MCP_TOOL_SURFACE} is not a tool surface (rebuild tools/mcp-server)`);
  if ((p as Partial<ToolSurfaceFile>).bundleSha256 !== mcpServerSha256) {
    throw new AuthorConfigError(`${MCP_TOOL_SURFACE} does not describe ${MCP_SERVER_BUNDLE} (rebuild tools/mcp-server)`);
  }
  return p as ToolSurface;
}

export interface AuthorConfigInput {
  repoRoot: string;
  model: string;
  promptTemplate: string;
  claudeVersion: string | null;
  runnerVersion: string;
}

/** Reads the author configuration from the checkout; throws AuthorConfigError when the skill or the MCP server bundle cannot be pinned. */
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
  let mcpServer: Buffer;
  try {
    mcpServer = readFileSync(join(input.repoRoot, MCP_SERVER_BUNDLE));
  } catch {
    throw new AuthorConfigError(`cannot read ${MCP_SERVER_BUNDLE} in the repo root (build tools/mcp-server)`);
  }
  const mcpServerSha256 = sha256(mcpServer);
  const surface = readToolSurface(input.repoRoot, mcpServerSha256);
  const surfaceSha256 = toolSurfaceSha256(surface);

  const fields: Omit<AuthorConfig, 'id' | 'authorConfigId'> = {
    model: input.model,
    skillVersion,
    skillSha256: skillDirSha256(skillDir),
    promptSha256: sha256(input.promptTemplate),
    claudeArgsSha256: sha256(`${claudeArgs('<prompt>', input.model, '<mcp-config>').join('\0')}\0${surfaceSha256}`),
    toolSurfaceSha256: surfaceSha256,
    mcpServerVersion: surface.server.version,
    mcpToolNames: surface.tools.map((tool) => tool.name).sort(),
    mcpServerSha256,
    claudeVersion: input.claudeVersion,
    runnerVersion: input.runnerVersion,
  };
  return { id: sha256(JSON.stringify(fields)).slice(0, 16), authorConfigId: authorConfigIdOf(fields), ...fields };
}

/** M1: the gated author identity of a configuration (see AuthorConfig.authorConfigId). */
export function authorConfigIdOf(config: Pick<AuthorConfig, 'model' | 'skillVersion' | 'skillSha256' | 'promptSha256' | 'claudeArgsSha256'>): string {
  const gated: Record<string, string> = {
    argsSha256: config.claudeArgsSha256,
    model: config.model,
    promptSha256: config.promptSha256,
    skillSha256: config.skillSha256,
    skillVersion: config.skillVersion,
  };
  // Canonical JSON: keys sorted, no spaces.
  return sha256(canonicalJson(gated));
}

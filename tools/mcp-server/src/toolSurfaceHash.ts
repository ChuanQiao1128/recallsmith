// N4: the canonical form and hash of the MCP tool surface the authoring agent sees. It has
// no npm dependency (node: builtins only), so the author-runner bundles it and hashes the
// dist/tool-surface.json this server's build writes exactly as the build computed it.

import { createHash } from 'node:crypto';

/** The file the build writes next to dist/index.js. */
export const TOOL_SURFACE_FILE = 'tool-surface.json';

/** One tool as a client lists it: what the model reads (name, description, input schema). */
export interface SurfaceTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** The tool surface of the server the runner starts: its name and version, its tools and the lint/grounding limits. */
export interface ToolSurface {
  server: { name: string; version: string };
  tools: SurfaceTool[];
  constants: Record<string, number>;
}

/** JSON with object keys sorted at every depth and no spaces; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * dist/tool-surface.json: the surface plus the SHA-256 of the dist/index.js it was listed from
 * (ai-agent-28), so the runner can refuse a surface left over from another build.
 */
export interface ToolSurfaceFile extends ToolSurface {
  bundleSha256: string;
}

/**
 * Lowercase hex SHA-256 of the canonical JSON of a tool surface: its server, tools and constants
 * only, so the file's bundleSha256 (which moves with every rebuild) never enters the gated id.
 */
export function toolSurfaceSha256(surface: ToolSurface): string {
  const { server, tools, constants } = surface;
  return createHash('sha256').update(canonicalJson({ server, tools, constants })).digest('hex');
}

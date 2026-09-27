import { describe, expect, it } from 'vitest';
import { SOURCE_QUOTE_MIN_CHARS, SOURCE_QUOTE_MIN_WORDS } from '../src/lint';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../src/server';
import { listToolSurface } from '../src/toolSurface';
import { canonicalJson, toolSurfaceSha256, type ToolSurface } from '../src/toolSurfaceHash';

describe('tool surface (N4, ai-agent-24)', () => {
  it('lists every tool the agent sees, sorted by name, with its description and input schema', async () => {
    const surface = await listToolSurface();
    expect(surface.server).toEqual({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
    expect(surface.tools.map((tool) => tool.name)).toEqual(['find_similar_cards', 'lint_card', 'read_source', 'submit_draft']);
    const similar = surface.tools.find((tool) => tool.name === 'find_similar_cards')!;
    expect(similar.description).toContain('likelyDuplicate');
    expect(similar.inputSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } });
    expect(surface.constants).toEqual({ SOURCE_QUOTE_MIN_CHARS, SOURCE_QUOTE_MIN_WORDS });
    // Listing twice gives the same surface, so the same hash.
    expect(toolSurfaceSha256(await listToolSurface())).toBe(toolSurfaceSha256(surface));
  });

  it('hashes the canonical JSON, so a changed description, schema, limit or version is a new surface', async () => {
    const surface = await listToolSurface();
    const base = toolSurfaceSha256(surface);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const variants: ToolSurface[] = [
      { ...surface, tools: surface.tools.map((t, i) => (i === 0 ? { ...t, description: `${t.description} ` } : t)) },
      { ...surface, tools: surface.tools.map((t, i) => (i === 1 ? { ...t, inputSchema: {} } : t)) },
      { ...surface, tools: surface.tools.slice(1) },
      { ...surface, constants: { ...surface.constants, SOURCE_QUOTE_MIN_WORDS: SOURCE_QUOTE_MIN_WORDS + 1 } },
      { ...surface, server: { ...surface.server, version: '9.9.9' } },
    ];
    for (const variant of variants) expect(toolSurfaceSha256(variant)).not.toBe(base);
  });

  it('writes canonical JSON: keys sorted at every depth, no spaces, array order kept', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 'x y' }], c: null }, u: undefined })).toBe('{"a":{"c":null,"d":[3,{"y":"x y","z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

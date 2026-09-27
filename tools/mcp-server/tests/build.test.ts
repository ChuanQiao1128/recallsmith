import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../scripts/buildLib.mjs';
import { listToolSurface } from '../src/toolSurface';
import { canonicalJson, toolSurfaceSha256, type ToolSurfaceFile } from '../src/toolSurfaceHash';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// Output directories inside the package root, so the built surface script resolves node_modules.
const outDirs: string[] = [];
function outDir(): string {
  const dir = mkdtempSync(join(root, '.build-test-'));
  outDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('build: dist/tool-surface.json always describes the bundle next to it (ai-agent-28)', () => {
  it('writes the surface the built server lists, with the SHA-256 of that dist/index.js', async () => {
    const out = outDir();
    await buildMcpServer({ root, outDir: out });
    const text = readFileSync(join(out, 'tool-surface.json'), 'utf8');
    const file = JSON.parse(text) as ToolSurfaceFile;
    expect(file.bundleSha256).toBe(sha256(readFileSync(join(out, 'index.js'))));
    expect(text).toBe(`${canonicalJson(file)}\n`);
    // The bundle hash never enters the gated surface hash.
    expect(toolSurfaceSha256(file)).toBe(toolSurfaceSha256(await listToolSurface()));
    expect(existsSync(join(out, 'tool-surface.build.mjs'))).toBe(false);
    expect(existsSync(join(out, 'tool-surface.json.tmp'))).toBe(false);
  }, 60_000);

  it('leaves no surface at all when the surface step fails, never the previous one next to a new bundle', async () => {
    const out = outDir();
    const stale = `${JSON.stringify({ bundleSha256: '0'.repeat(64), server: { name: 'developercards', version: '0.0.1' }, tools: [], constants: {} })}\n`;
    writeFileSync(join(out, 'tool-surface.json'), stale);
    await expect(
      buildMcpServer({
        root,
        outDir: out,
        listSurface: () => {
          throw new Error('surface listing failed');
        },
      }),
    ).rejects.toThrow('surface listing failed');
    expect(existsSync(join(out, 'index.js'))).toBe(true);
    expect(existsSync(join(out, 'tool-surface.json'))).toBe(false);
    expect(existsSync(join(out, 'tool-surface.build.mjs'))).toBe(false);
  }, 60_000);

  it('leaves no surface when the bundle step fails', async () => {
    const out = outDir();
    writeFileSync(join(out, 'tool-surface.json'), '{}\n');
    await expect(buildMcpServer({ root: join(out, 'no-such-package'), outDir: out })).rejects.toThrow();
    expect(existsSync(join(out, 'tool-surface.json'))).toBe(false);
  }, 60_000);
});

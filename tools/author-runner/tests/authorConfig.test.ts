import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthorConfigError, readAuthorConfig, skillVersionFrom } from '../src/authorConfig';
import { claudeArgs } from '../src/claude';
import { readPromptTemplate } from '../src/prompt';
import { makeHome, TEST_TOOL_SURFACE, writeTestToolSurface } from './helpers';

const REPO_SKILL = new URL('../../../.claude/skills/author-cards/SKILL.md', import.meta.url);

describe('author configuration (ai-agent-3)', () => {
  it('parses the skill version from the repository SKILL.md', () => {
    expect(skillVersionFrom(readFileSync(REPO_SKILL, 'utf8'))).toMatch(/^author-cards@\d+\.\d+\.\d+$/);
    expect(skillVersionFrom('no version line')).toBeNull();
  });

  it('changes its id when the skill, the prompt or the model changes', () => {
    const t = makeHome();
    try {
      const input = { repoRoot: t.repo, model: 'claude-opus-5-5', promptTemplate: readPromptTemplate(), claudeVersion: '2.1', runnerVersion: '1.0.0' };
      const base = readAuthorConfig(input);
      expect(base.skillVersion).toBe('author-cards@1.8.1');
      expect(readAuthorConfig(input)).toEqual(base);
      expect(readAuthorConfig({ ...input, model: 'claude-sonnet-5' }).id).not.toBe(base.id);
      expect(readAuthorConfig({ ...input, promptTemplate: `${input.promptTemplate} ` }).id).not.toBe(base.id);

      // An uncommitted edit of any skill file changes the configuration.
      writeFileSync(join(t.repo, '.claude', 'skills', 'author-cards', 'checklist.md'), 'extra rule\n');
      const edited = readAuthorConfig(input);
      expect(edited.skillSha256).not.toBe(base.skillSha256);
      expect(edited.id).not.toBe(base.id);

      // A rebuilt MCP server bundle changes it too.
      expect(base.mcpServerSha256).toMatch(/^[0-9a-f]{64}$/);
      writeFileSync(join(t.repo, 'tools', 'mcp-server', 'dist', 'index.js'), '// rebuilt\n');
      writeTestToolSurface(t.repo);
      expect(readAuthorConfig(input).mcpServerSha256).not.toBe(base.mcpServerSha256);

      writeFileSync(join(t.repo, '.claude', 'skills', 'author-cards', 'SKILL.md'), 'no version\n');
      expect(() => readAuthorConfig(input)).toThrow(AuthorConfigError);
    } finally {
      t.cleanup();
    }
  });

  it('refuses a checkout without the MCP server bundle instead of running with no DeveloperCards tools (ai-agent-13)', () => {
    const t = makeHome();
    try {
      const input = { repoRoot: t.repo, model: 'claude-opus-5-5', promptTemplate: readPromptTemplate(), claudeVersion: '2.1', runnerVersion: '1.0.0' };
      rmSync(join(t.repo, 'tools', 'mcp-server', 'dist', 'index.js'));
      expect(() => readAuthorConfig(input)).toThrow(AuthorConfigError);
      expect(() => readAuthorConfig(input)).toThrow('cannot read tools/mcp-server/dist/index.js in the repo root (build tools/mcp-server)');
    } finally {
      t.cleanup();
    }
  });

  it('computes the gated authorConfigId from the canonical JSON of the five M1 fields, without the CLI or runner version (M1)', () => {
    const t = makeHome();
    try {
      const input = { repoRoot: t.repo, model: 'claude-opus-5-5', promptTemplate: readPromptTemplate(), claudeVersion: '2.1.283', runnerVersion: '1.0.0' };
      const base = readAuthorConfig(input);
      const canonical =
        `{"argsSha256":"${base.claudeArgsSha256}","model":"claude-opus-5-5","promptSha256":"${base.promptSha256}",` +
        `"skillSha256":"${base.skillSha256}","skillVersion":"author-cards@1.8.1"}`;
      expect(base.authorConfigId).toBe(createHash('sha256').update(canonical).digest('hex'));
      expect(base.authorConfigId).toMatch(/^[0-9a-f]{64}$/);

      // A Claude Code auto-update or a runner release keeps the gated id; the local fingerprint still moves.
      const updated = readAuthorConfig({ ...input, claudeVersion: '2.2.0', runnerVersion: '1.0.1' });
      expect(updated.authorConfigId).toBe(base.authorConfigId);
      expect(updated.id).not.toBe(base.id);
      // A new model, prompt or skill does change it.
      expect(readAuthorConfig({ ...input, model: 'claude-sonnet-5' }).authorConfigId).not.toBe(base.authorConfigId);
      expect(readAuthorConfig({ ...input, promptTemplate: `${input.promptTemplate}!` }).authorConfigId).not.toBe(base.authorConfigId);
      writeFileSync(join(t.repo, '.claude', 'skills', 'author-cards', 'checklist.md'), 'extra rule\n');
      expect(readAuthorConfig(input).authorConfigId).not.toBe(base.authorConfigId);
    } finally {
      t.cleanup();
    }
  });

  it('binds the gated authorConfigId to the MCP tool surface the agent sees (N4, ai-agent-24)', () => {
    const t = makeHome();
    try {
      const input = { repoRoot: t.repo, model: 'claude-opus-5-5', promptTemplate: readPromptTemplate(), claudeVersion: '2.1.283', runnerVersion: '1.0.0' };
      const surfaceFile = join(t.repo, 'tools', 'mcp-server', 'dist', 'tool-surface.json');
      const writeSurface = (surface: object) => writeTestToolSurface(t.repo, surface);
      const base = readAuthorConfig(input);
      expect(base.mcpServerVersion).toBe('1.8.0');
      expect(base.mcpToolNames).toEqual(['find_similar_cards', 'lint_card', 'read_source', 'submit_draft']);
      expect(base.toolSurfaceSha256).toMatch(/^[0-9a-f]{64}$/);
      // argsSha256 is the claude argument list together with the tool surface.
      const args = claudeArgs('<prompt>', 'claude-opus-5-5', '<mcp-config>').join('\0');
      expect(base.claudeArgsSha256).toBe(createHash('sha256').update(`${args}\0${base.toolSurfaceSha256}`).digest('hex'));

      // The same surface written with other key order or spacing is the same surface.
      writeTestToolSurface(t.repo, { tools: TEST_TOOL_SURFACE.tools, server: TEST_TOOL_SURFACE.server, constants: TEST_TOOL_SURFACE.constants }, 2);
      expect(readAuthorConfig(input).authorConfigId).toBe(base.authorConfigId);

      // A changed tool description, input schema, tool list, lint limit or server version is a new gated author.
      const changed = [
        { ...TEST_TOOL_SURFACE, tools: TEST_TOOL_SURFACE.tools.map((tool, i) => (i === 0 ? { ...tool, description: 'Drop a draft only when told to.' } : tool)) },
        { ...TEST_TOOL_SURFACE, tools: TEST_TOOL_SURFACE.tools.map((tool, i) => (i === 1 ? { ...tool, inputSchema: { type: 'object', properties: { x: {} } } } : tool)) },
        { ...TEST_TOOL_SURFACE, tools: TEST_TOOL_SURFACE.tools.slice(1) },
        { ...TEST_TOOL_SURFACE, constants: { ...TEST_TOOL_SURFACE.constants, SOURCE_QUOTE_MIN_CHARS: 20 } },
        { ...TEST_TOOL_SURFACE, server: { name: 'developercards', version: '1.9.0' } },
      ];
      const ids = new Set<string>([base.authorConfigId]);
      for (const surface of changed) {
        writeSurface(surface);
        const config = readAuthorConfig(input);
        expect(config.authorConfigId).not.toBe(base.authorConfigId);
        expect(config.id).not.toBe(base.id);
        ids.add(config.authorConfigId);
      }
      expect(ids.size).toBe(changed.length + 1);

      // No surface, or a file that is not one, pins nothing.
      writeFileSync(surfaceFile, '{"tools":[]}');
      expect(() => readAuthorConfig(input)).toThrow('tools/mcp-server/dist/tool-surface.json is not a tool surface (rebuild tools/mcp-server)');
      rmSync(surfaceFile);
      expect(() => readAuthorConfig(input)).toThrow('cannot read tools/mcp-server/dist/tool-surface.json in the repo root (build tools/mcp-server)');
    } finally {
      t.cleanup();
    }
  });

  it('refuses a tool surface that does not describe the MCP server bundle next to it (ai-agent-28)', () => {
    const t = makeHome();
    try {
      const input = { repoRoot: t.repo, model: 'claude-opus-5-5', promptTemplate: readPromptTemplate(), claudeVersion: '2.1.283', runnerVersion: '1.0.0' };
      const dist = join(t.repo, 'tools', 'mcp-server', 'dist');
      const base = readAuthorConfig(input);
      const mismatch = 'tools/mcp-server/dist/tool-surface.json does not describe tools/mcp-server/dist/index.js (rebuild tools/mcp-server)';

      // A new bundle next to the previous build's surface (a failed surface step) pins nothing.
      writeFileSync(join(dist, 'index.js'), '// rebuilt with changed tools\n');
      expect(() => readAuthorConfig(input)).toThrow(AuthorConfigError);
      expect(() => readAuthorConfig(input)).toThrow(mismatch);
      // So does a surface written before the build recorded its bundle.
      writeFileSync(join(dist, 'tool-surface.json'), `${JSON.stringify(TEST_TOOL_SURFACE)}\n`);
      expect(() => readAuthorConfig(input)).toThrow(mismatch);

      // The surface the build lists for this bundle is accepted, and the bundle hash stays out of the gated id.
      writeTestToolSurface(t.repo);
      const rebuilt = readAuthorConfig(input);
      expect(rebuilt.authorConfigId).toBe(base.authorConfigId);
      expect(rebuilt.toolSurfaceSha256).toBe(base.toolSurfaceSha256);
      expect(rebuilt.id).not.toBe(base.id);
    } finally {
      t.cleanup();
    }
  });
});

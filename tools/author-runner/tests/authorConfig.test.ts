import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthorConfigError, readAuthorConfig, skillVersionFrom } from '../src/authorConfig';
import { readPromptTemplate } from '../src/prompt';
import { makeHome } from './helpers';

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
});

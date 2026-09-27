import { readFileSync, writeFileSync } from 'node:fs';
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

      writeFileSync(join(t.repo, '.claude', 'skills', 'author-cards', 'SKILL.md'), 'no version\n');
      expect(() => readAuthorConfig(input)).toThrow(AuthorConfigError);
    } finally {
      t.cleanup();
    }
  });
});

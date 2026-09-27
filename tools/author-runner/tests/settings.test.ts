import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPromptTemplate } from '../src/prompt';

describe('what an unattended run may read (ai-agent-21)', () => {
  it('denies secret-shaped files of the checkout in the project settings the run loads', () => {
    const settings = JSON.parse(readFileSync(new URL('../../../.claude/settings.json', import.meta.url), 'utf8')) as {
      permissions?: { deny?: string[] };
    };
    const deny = settings.permissions?.deny ?? [];
    for (const rule of ['Read(./**/.env*)', 'Read(./**/*.tfstate*)', 'Read(./**/*.tfvars)', 'Read(./**/*.pem)']) {
      expect(deny).toContain(rule);
    }
  });

  it('tells the agent that the queue item host has no implicit pass', () => {
    const prompt = readPromptTemplate();
    expect(prompt).not.toContain("reads only the queue item's host");
    expect(prompt).toContain("the queue item's own host included when it is not one of them");
  });
});

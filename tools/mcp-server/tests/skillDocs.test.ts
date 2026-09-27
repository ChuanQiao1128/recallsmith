// The author-cards skill documents the contract this server enforces; these checks keep
// the verifier prompt and the workflow text in step with it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skillFile = (name: string) => readFileSync(new URL(`../../../.claude/skills/author-cards/${name}`, import.meta.url), 'utf8');

describe('author-cards skill', () => {
  it('verifies the keyed answer, explanation and quote against the chunk, and distractor whys only for contradiction', () => {
    const prompt = skillFile('verifier-prompt.md');
    // Step 1 no longer lists distractor whys among the claims the chunk must support.
    const step1 = prompt.split('\n').find((line) => line.startsWith('1. List each factual claim')) ?? '';
    expect(step1).toMatch(/`explanation`/);
    expect(step1).toMatch(/`correct: true`/);
    expect(step1).not.toMatch(/why/);
    expect(prompt).toMatch(/`correct: false` only for contradiction/);
    expect(prompt).toMatch(/`not addressed`/);
    expect(prompt).toMatch(/any distractor why is `contradicted`/);
    expect(prompt).toMatch(/`not addressed` never lowers the verdict/);
    expect(prompt).toMatch(/"distractorWhys"/);
    expect(prompt).toMatch(/weak_distractor/);

    const skill = skillFile('SKILL.md');
    expect(skill).toMatch(/each distractor `why` is judged only for contradiction/);
  });

  it('documents submit-time grounding and the local source roots', () => {
    const skill = skillFile('SKILL.md');
    expect(skill).toMatch(/SOURCE_NOT_INGESTED/);
    expect(skill).toMatch(/`sources\/` directory/);
    expect(skillFile('citation-rules.md')).toMatch(/`submit_draft` always checks it/);
  });
});

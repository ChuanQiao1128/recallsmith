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

  it('has the verifier check codeSnippet and realWorldUsage against the chunk like the explanation (ai-agent-25)', () => {
    const prompt = skillFile('verifier-prompt.md');
    const step1 = prompt.split('\n').find((line) => line.startsWith('1. List each factual claim')) ?? '';
    expect(step1).toMatch(/`codeSnippet`/);
    expect(step1).toMatch(/parameter, flag or option/);
    expect(step1).toMatch(/`realWorldUsage`/);
    const step2 = prompt.split('\n').find((line) => line.startsWith('2. Mark each of those claims')) ?? '';
    expect(step2).toMatch(/the same way for every field/);
    expect(step2).toMatch(/`codeSnippet` that the chunk does not state is `not`/);
    expect(prompt).toMatch(/"field": "explanation" \| "option" \| "codeSnippet" \| "realWorldUsage"/);

    const step5 = skillFile('SKILL.md').split('\n').find((line) => line.startsWith('5. **Verify with a subagent.**')) ?? '';
    expect(step5).toMatch(/`codeSnippet` \(API names, parameters, flags, values\) and `realWorldUsage`/);
    expect(skillFile('checklist.md')).toMatch(/an invented flag or parameter is `incorrect_answer`, not `other`/);
  });

  it('documents read_source paging and the minimum quote length (ai-agent-23, ai-agent-24)', () => {
    const skill = skillFile('SKILL.md');
    const step1 = skill.split('\n').find((line) => line.startsWith('1. **Read.**')) ?? '';
    for (const phrase of [/offset: nextOffset/, /`chunkIds`/, /`remainingChunkIds`/, /Never write a card or a quote from a `preview`/]) {
      expect(step1).toMatch(phrase);
    }
    expect(skill).toMatch(/SOURCE_QUOTE_TOO_SHORT/);
    expect(skill).toMatch(/`kind: "local"`/);
    const rules = skillFile('citation-rules.md');
    expect(rules).toMatch(/Minimum: 40 characters and 6 words/);
    expect(rules).toMatch(/`kind: "local"`/);
  });
});

import { describe, expect, it } from 'vitest';

import { hasKeyLine, splitKeyLine } from '../../src/content/answerKeyLine';

// 2026-10-14 learning flow (B3): the aws-saa-fundamentals deck answers in three lines, 答：/因为：/考法：.
// splitKeyLine finds the 答 line; every other answer (all English decks) is left alone.

const THREE_LINES = [
  '答：一整片连续的 IP 地址。',
  '因为：10.0.0.0/16 约有 6.5 万个地址；"/" 后面的数字越大，范围越小。',
  '考法：比较 10.0.0.0/16 和 10.0.0.0/24 → ✅ /24 范围更小（约 256 个地址）；❌ 以为数字越大范围越大',
].join('\n');

describe('splitKeyLine', () => {
  it('splits a 答： answer into the key line and the remaining lines', () => {
    expect(splitKeyLine(THREE_LINES)).toEqual({
      keyLine: '答：一整片连续的 IP 地址。',
      rest: '因为：10.0.0.0/16 约有 6.5 万个地址；"/" 后面的数字越大，范围越小。\n考法：比较 10.0.0.0/16 和 10.0.0.0/24 → ✅ /24 范围更小（约 256 个地址）；❌ 以为数字越大范围越大',
    });
  });

  it('ignores leading and trailing whitespace around the answer and the key line', () => {
    expect(splitKeyLine(`\n  \n   ${THREE_LINES}\n\n`)).toEqual(splitKeyLine(THREE_LINES));
    expect(splitKeyLine('  答：结论。  \n因为：原因。')).toEqual({ keyLine: '答：结论。', rest: '因为：原因。' });
  });

  it('returns an empty rest for a one-line answer', () => {
    expect(splitKeyLine('答：只有一行。')).toEqual({ keyLine: '答：只有一行。', rest: '' });
    expect(splitKeyLine('答：只有一行。\n\n')).toEqual({ keyLine: '答：只有一行。', rest: '' });
  });

  it('accepts the ASCII colon too', () => {
    expect(splitKeyLine('答: ASCII 冒号。\n因为：原因。')).toEqual({ keyLine: '答: ASCII 冒号。', rest: '因为：原因。' });
  });

  it('reads Windows line endings', () => {
    expect(splitKeyLine('答：结论。\r\n因为：原因。\r\n考法：问法。')).toEqual({ keyLine: '答：结论。', rest: '因为：原因。\n考法：问法。' });
  });

  it('returns null for everything else', () => {
    for (const text of [
      'A buffer between producer and consumer.',
      'Publish to an EventBridge custom bus.\nEach consumer gets its own rule.',
      '因为：原因。\n答：结论。',
      '答 没有冒号。',
      '回答：不是答字开头。',
      'Answer: 答：not at the start.',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(splitKeyLine(text), String(text)).toBeNull();
      expect(hasKeyLine(text)).toBe(false);
    }
    expect(hasKeyLine(THREE_LINES)).toBe(true);
  });
});

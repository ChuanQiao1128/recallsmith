import { describe, expect, it } from 'vitest';

import {
  FENCE_ONLY_QUESTION_TEXT,
  questionA11yLabel,
  questionText,
  splitQuestionCode,
} from '../../src/content/questionCode';

const FENCE = '```';

describe('splitQuestionCode', () => {
  it('returns a question without a fence unchanged with code null', () => {
    const q = 'Which S3 storage class is the LEAST expensive for archives?';
    expect(splitQuestionCode(q)).toEqual({ text: q, code: null });
  });

  it('extracts one fence, keeps the code indentation and tidies the prose', () => {
    const q = [
      'What does this print?',
      `${FENCE}csharp`,
      'var xs = new[] { 1, 2, 3 };',
      'if (xs.Length > 2)',
      '    Console.WriteLine(xs[0]);',
      FENCE,
    ].join('\n');
    expect(splitQuestionCode(q)).toEqual({
      text: 'What does this print?',
      code: {
        language: 'csharp',
        source: 'var xs = new[] { 1, 2, 3 };\nif (xs.Length > 2)\n    Console.WriteLine(xs[0]);',
      },
    });
  });

  it('joins the prose before and after the fence with one blank line', () => {
    const q = `Given:\n\n${FENCE}cs\nint x = 1;\n${FENCE}\n\n\nWhat is x?  `;
    const split = splitQuestionCode(q);
    expect(split.text).toBe('Given:\n\nWhat is x?');
    expect(split.code).toEqual({ language: 'cs', source: 'int x = 1;' });
  });

  it('extracts only the first of two fences', () => {
    const q = `A:\n${FENCE}csharp\nint a = 1;\n${FENCE}\nB:\n${FENCE}csharp\nint b = 2;\n${FENCE}`;
    const split = splitQuestionCode(q);
    expect(split.code).toEqual({ language: 'csharp', source: 'int a = 1;' });
    expect(split.text).toBe(`A:\n\nB:\n${FENCE}csharp\nint b = 2;\n${FENCE}`);
  });

  it('returns a malformed fence unchanged', () => {
    const unclosed = `What is this?\n${FENCE}csharp\nint x = 1;`;
    const noLanguage = `What is this?\n${FENCE}\nint x = 1;\n${FENCE}`;
    const inline = `What does ${FENCE}csharp int x${FENCE} do?`;
    for (const q of [unclosed, noLanguage, inline]) {
      expect(splitQuestionCode(q)).toEqual({ text: q, code: null });
    }
  });

  it('drops blank lines at the edges of the fence body but keeps inner blank lines', () => {
    const q = `Q?\n${FENCE}csharp\n\n  int a = 1;\n\n  int b = 2;\n   \n${FENCE}`;
    expect(splitQuestionCode(q).code).toEqual({ language: 'csharp', source: '  int a = 1;\n\n  int b = 2;' });
  });

  it('treats a fence with only blank lines as malformed', () => {
    const q = `Q?\n${FENCE}csharp\n\n   \n${FENCE}`;
    expect(splitQuestionCode(q)).toEqual({ text: q, code: null });
  });

  it('accepts CRLF line endings and spaces around the fence lines', () => {
    const q = `Q?\r\n  ${FENCE}csharp  \r\nint a = 1;\r\n ${FENCE} \r\n`;
    expect(splitQuestionCode(q)).toEqual({ text: 'Q?', code: { language: 'csharp', source: 'int a = 1;' } });
  });

  // F01 supervisor-1 / y-correctness-2: a fence-only question never yields empty prose.
  it('falls back to neutral prose when the question is only a fence', () => {
    expect(FENCE_ONLY_QUESTION_TEXT).toBe('What does this code do?');
    expect(splitQuestionCode(`${FENCE}csharp\nint a = 1;\n${FENCE}`)).toEqual({
      text: 'What does this code do?',
      code: { language: 'csharp', source: 'int a = 1;' },
    });
    expect(splitQuestionCode(`  \n${FENCE}csharp\nConsole.WriteLine(1 + 1);\n${FENCE}\n   \n`).text).toBe(
      'What does this code do?',
    );
  });
});

describe('questionText / questionA11yLabel', () => {
  it('gives row surfaces the prose only and full surfaces a code cue', () => {
    const q = `What prints?\n${FENCE}csharp\nConsole.WriteLine(1);\n${FENCE}`;
    expect(questionText(q)).toBe('What prints?');
    expect(questionA11yLabel(splitQuestionCode(q))).toBe('What prints?, code sample follows');
    expect(questionA11yLabel(splitQuestionCode('Plain?'))).toBe('Plain?');
  });

  it('gives a fence-only question the fallback prose on row surfaces and in the spoken label', () => {
    const q = `${FENCE}csharp\nConsole.WriteLine(1 + 1);\n${FENCE}\n`;
    expect(questionText(q)).toBe('What does this code do?');
    expect(questionA11yLabel(splitQuestionCode(q))).toBe('What does this code do?, code sample follows');
  });
});

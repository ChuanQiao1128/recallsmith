import { describe, expect, it } from 'vitest';

import { hasInlineCode, splitInlineCode, stripInlineCode } from '../../src/content/inlineCode';
import { splitQuestionCode } from '../../src/content/questionCode';

describe('splitInlineCode', () => {
  it('returns one text segment when there is no span', () => {
    const text = 'Which AWS service stores objects durably?';
    expect(splitInlineCode(text)).toEqual([{ kind: 'text', value: text }]);
    expect(stripInlineCode(text)).toBe(text);
    expect(hasInlineCode(text)).toBe(false);
  });

  it('returns no segments for an empty string', () => {
    expect(splitInlineCode('')).toEqual([]);
    expect(stripInlineCode('')).toBe('');
  });

  it('splits several spans, keeping the prose between them', () => {
    expect(splitInlineCode('Call `Add(4)` then `ConfigureAwait(false)`.')).toEqual([
      { kind: 'text', value: 'Call ' },
      { kind: 'code', value: 'Add(4)' },
      { kind: 'text', value: ' then ' },
      { kind: 'code', value: 'ConfigureAwait(false)' },
      { kind: 'text', value: '.' },
    ]);
    expect(stripInlineCode('Call `Add(4)` then `ConfigureAwait(false)`.')).toBe(
      'Call Add(4) then ConfigureAwait(false).',
    );
  });

  it('keeps generics with < > intact inside a span', () => {
    expect(splitInlineCode('`List<int>` vs `Dictionary<string, int>`')).toEqual([
      { kind: 'code', value: 'List<int>' },
      { kind: 'text', value: ' vs ' },
      { kind: 'code', value: 'Dictionary<string, int>' },
    ]);
    expect(stripInlineCode('A `List<int>` grows.')).toBe('A List<int> grows.');
  });

  it('leaves an unmatched backtick as literal text', () => {
    expect(splitInlineCode('A lone ` backtick')).toEqual([{ kind: 'text', value: 'A lone ` backtick' }]);
    expect(stripInlineCode('Use `x` and a stray ` here')).toBe('Use x and a stray ` here');
    expect(splitInlineCode('Use `x` and a stray ` here')).toEqual([
      { kind: 'text', value: 'Use ' },
      { kind: 'code', value: 'x' },
      { kind: 'text', value: ' and a stray ` here' },
    ]);
  });

  it('never pairs backticks across a line break', () => {
    const text = 'first `line\nsecond` line';
    expect(splitInlineCode(text)).toEqual([{ kind: 'text', value: text }]);
    expect(stripInlineCode(text)).toBe(text);
  });

  it('leaves a ``` fence untouched for splitQuestionCode', () => {
    const question = 'What does `xs.Length` print?\n```csharp\nvar xs = new[] { 1, 2 };\n```';
    expect(stripInlineCode('```csharp\nvar x = 1;\n```')).toBe('```csharp\nvar x = 1;\n```');
    expect(splitInlineCode('```csharp\nvar x = 1;\n```')).toEqual([
      { kind: 'text', value: '```csharp\nvar x = 1;\n```' },
    ]);
    expect(stripInlineCode(question)).toBe('What does xs.Length print?\n```csharp\nvar xs = new[] { 1, 2 };\n```');
    expect(splitQuestionCode(question).text).toBe('What does `xs.Length` print?');
  });

  it('treats the empty span `` as literal text', () => {
    expect(splitInlineCode('an empty `` span')).toEqual([{ kind: 'text', value: 'an empty `` span' }]);
    expect(stripInlineCode('an empty `` span')).toBe('an empty `` span');
    expect(hasInlineCode('an empty `` span')).toBe(false);
  });
});

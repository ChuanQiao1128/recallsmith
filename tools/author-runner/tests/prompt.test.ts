import { describe, expect, it } from 'vitest';
import { readPromptTemplate, renderPrompt, type PromptValues } from '../src/prompt';

const PLACEHOLDERS = ['{{url}}', '{{deckSlug}}', '{{kind}}', '{{title}}', '{{sectionHint}}', '{{maxCards}}', '{{note}}'];

describe('queue-item prompt', () => {
  it('renders every placeholder of the queue-item prompt', () => {
    const template = readPromptTemplate();
    for (const p of PLACEHOLDERS) expect(template).toContain(p);
    for (const lit of ['author-cards@1.8.1', 'find_similar_cards', 'read_source', 'submit_draft', 'nothing_new', '"outcome"']) {
      expect(template).toContain(lit);
    }

    const values: PromptValues = {
      url: 'https://docs.example.com/page',
      deckSlug: 'aws-lambda',
      kind: 'source_changed',
      title: 'Line one\r\nline two {{url}}',
      sectionHint: null,
      maxCards: 5,
      note: 'n'.repeat(900),
    };
    const out = renderPrompt(template, values);
    // The only {{…}} left is the literal one carried inside the title value.
    expect(out.match(/\{\{\w+\}\}/g)).toEqual(['{{url}}']);
    expect(out).toContain('https://docs.example.com/page');
    expect(out).toContain('`aws-lambda`');
    expect(out).toContain('source_changed');
    // CR/LF become spaces and a {{…}} inside a value stays literal (one pass, never expanded).
    expect(out).toContain('Line one  line two {{url}}');
    expect(out).toContain('Section hint: (none)');
    expect(out).toContain('at most 5 **new** cards');
    expect(out).toContain(`Note from the queue: ${'n'.repeat(500)}\n`);
    expect(out).not.toContain('n'.repeat(501));

    const capped = renderPrompt('{{url}}|{{title}}|{{sectionHint}}|{{note}}|{{maxCards}}', {
      ...values,
      url: `https://x.example.com/${'u'.repeat(3000)}`,
      title: 't'.repeat(400),
      sectionHint: 's'.repeat(400),
      note: null,
      maxCards: 3,
    });
    const [url, title, hint, note, max] = capped.split('|');
    expect(url).toHaveLength(2048);
    expect(title).toHaveLength(300);
    expect(hint).toHaveLength(300);
    expect(note).toBe('(none)');
    expect(max).toBe('3');
  });
});

// @vitest-environment jsdom
//
// F34 — the snippet preview highlights off the typing path, without
// auto-detection. Two claims live here: the pure highlightSnippet helper escapes
// plain text when no language is set (never runs highlight.js auto-detection),
// and CardForm feeds the preview from deferred values so the highlight lands
// once React catches up. The preview is deferred, so every DOM assertion that
// depends on a keystroke uses findBy…/waitFor rather than reading synchronously.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The same module instance lib/highlightSnippet registers grammars on, so a spy
// here sees exactly the calls the lib would make.
import hljs from 'highlight.js/lib/core';

import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import type { Deck } from '../src/types/deck';
import { highlightSnippet } from '../src/lib/highlightSnippet';

const deck = {
  id: 7,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
} as Deck;

function values(over: Partial<CardFormValues> = {}): CardFormValues {
  return {
    question: 'What does await actually suspend?',
    stableUid: 'cs-async-001',
    explanation: 'The async function, not the thread.',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 2,
    orderInDeck: 10,
    revision: 1,
    topic: '',
    ...over,
  };
}

function mount(initial: CardFormValues) {
  return render(
    <CardForm
      mode="edit"
      deck={deck}
      initialValues={initial}
      onSubmit={async () => ({ ok: true })}
      onCancel={() => {}}
    />,
  );
}

/** The preview <code> element rendered with dangerouslySetInnerHTML. */
function preview(): HTMLElement {
  const node = document.querySelector<HTMLElement>('pre code');
  expect(node).not.toBeNull();
  return node!;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CardForm deferred snippet highlight', () => {
  it('renders a snippet with no language as escaped plain text', () => {
    const html = highlightSnippet('<b>x</b> && y', null);
    expect(html).toBe('&lt;b&gt;x&lt;/b&gt; &amp;&amp; y');
    expect(html).not.toContain('hljs-');
  });

  it('never runs highlight.js auto-detection', async () => {
    const spy = vi.spyOn(hljs, 'highlightAuto');
    const user = userEvent.setup();

    mount(values({ codeLanguage: '' }));

    await user.type(screen.getByLabelText('Code Snippet'), 'const total = a + b;');
    await waitFor(() => {
      expect(preview().textContent).toBe('const total = a + b;');
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('still highlights a snippet whose language is chosen', async () => {
    mount(values({ codeLanguage: 'js', codeSnippet: 'const x = 1;' }));

    await waitFor(() => {
      expect(preview().innerHTML).toContain('hljs-keyword');
    });
  });

  it('shows the placeholder comment for an empty snippet', () => {
    mount(values({ codeSnippet: '' }));
    expect(preview().textContent).toContain('// No code snippet.');
  });

  it('updates the preview after typing, once React catches up', async () => {
    const user = userEvent.setup();
    mount(values({ codeSnippet: '' }));

    await user.type(screen.getByLabelText('Code Snippet'), 'let count = 0;');
    await waitFor(() => {
      expect(preview().textContent).toBe('let count = 0;');
    });
  });
});

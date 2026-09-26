// Node environment, pure: authoringBodies has no React and no runtime imports,
// so its rules are pinned here directly rather than through a mounted form.
//
// The rule under test is the one deckImportRunner already documents and the
// four form pages now share: every collected field is sent, and a cleared
// optional text field is sent as '' rather than dropped, because the server
// treats an absent key as "leave it alone".

import { describe, expect, it } from 'vitest';
import type { CardFormValues } from '../src/components/CardForm';
import {
  DEFAULT_DECK_LOCALE,
  buildCardBody,
  buildDeckBody,
  parseDraftVersion,
  type CardBodyInput,
  type DeckBodyInput,
} from '../src/lib/authoringBodies';

function deckInput(over: Partial<DeckBodyInput> = {}): DeckBodyInput {
  return {
    slug: 'js-core-basics',
    title: 'JavaScript Core Basics',
    author: 'Leo',
    description: 'Core concepts',
    locale: 'zh-CN',
    deckType: 2,
    version: 9,
    ...over,
  };
}

function cardInput(over: Partial<CardBodyInput> = {}): CardBodyInput {
  return {
    question: 'What does volatile guarantee?',
    explanation: 'Visibility, not atomicity.',
    realWorldUsage: 'A flag polled from another thread.',
    codeSnippet: 'let x = 1;',
    codeLanguage: 'js',
    difficulty: 3,
    orderInDeck: 20,
    revision: 4,
    ...over,
  };
}

describe('buildDeckBody', () => {
  it('buildDeckBody trims every text field and sends an emptied description as an empty string', () => {
    const body = buildDeckBody(
      deckInput({
        slug: '  js-core-basics  ',
        title: '  JavaScript Core Basics  ',
        author: '  Leo  ',
        description: '   ',
      }),
    );

    expect(body.slug).toBe('js-core-basics');
    expect(body.title).toBe('JavaScript Core Basics');
    expect(body.author).toBe('Leo');
    // Present and empty, not dropped: '' is what clears the column.
    expect(body.description).toBe('');
    expect(Object.hasOwn(body, 'description')).toBe(true);
  });

  it('buildDeckBody always carries locale, deckType and version', () => {
    const body = buildDeckBody(deckInput());

    expect(body).toStrictEqual({
      slug: 'js-core-basics',
      title: 'JavaScript Core Basics',
      author: 'Leo',
      description: 'Core concepts',
      locale: 'zh-CN',
      deckType: 2,
      version: 9,
    });
  });

  it('buildDeckBody falls back to en-US for a blank locale', () => {
    // decks.locale is NOT NULL, so a blank box becomes the default rather than
    // clearing the column.
    expect(buildDeckBody(deckInput({ locale: '   ' })).locale).toBe(DEFAULT_DECK_LOCALE);
    expect(buildDeckBody(deckInput({ locale: '  fr-FR  ' })).locale).toBe('fr-FR');
  });
});

describe('buildCardBody', () => {
  it('buildCardBody sends emptied optional text as empty strings', () => {
    const body = buildCardBody(
      cardInput({
        explanation: '   ',
        realWorldUsage: '',
        codeSnippet: '   ',
        codeLanguage: '  ',
      }),
    );

    expect(body.explanation).toBe('');
    expect(body.realWorldUsage).toBe('');
    expect(body.codeSnippet).toBe('');
    expect(body.codeLanguage).toBe('');
    for (const key of ['explanation', 'realWorldUsage', 'codeSnippet', 'codeLanguage']) {
      expect(Object.hasOwn(body, key)).toBe(true);
    }
  });

  it('buildCardBody keeps the whitespace inside a non-blank snippet', () => {
    // Indentation is content: a snippet that has any non-whitespace keeps its
    // exact original text, untrimmed.
    const snippet = '  function f() {\n    return 1;\n  }\n';
    expect(buildCardBody(cardInput({ codeSnippet: snippet })).codeSnippet).toBe(snippet);
  });

  it('buildCardBody never carries mcq, topic, stableUid or ids', () => {
    // Pass a value CardFormValues can hold, and confirm the extras it may carry
    // never reach the body. CardFormValues must be assignable to CardBodyInput.
    const values: CardFormValues = {
      question: 'q',
      stableUid: 'cs-x-001',
      explanation: '',
      realWorldUsage: '',
      codeSnippet: '',
      codeLanguage: '',
      difficulty: 2,
      orderInDeck: 10,
      revision: 1,
      topic: 'a-topic',
    };
    const body = buildCardBody(values);

    expect(Object.keys(body).sort()).toStrictEqual(
      ['codeLanguage', 'codeSnippet', 'difficulty', 'explanation', 'orderInDeck', 'question', 'realWorldUsage', 'revision'],
    );
    for (const key of ['mcq', 'topic', 'stableUid', 'id', 'deckId', 'expectedVersion']) {
      expect(Object.hasOwn(body, key)).toBe(false);
    }
  });

  it('buildCardBody coerces difficulty, orderInDeck and revision, with defaults', () => {
    expect(buildCardBody(cardInput({ difficulty: '3' }))).toMatchObject({ difficulty: 3 });
    // Number('') is NaN, so the || fallbacks fire.
    expect(buildCardBody(cardInput({ difficulty: '' }))).toMatchObject({ difficulty: 2 });
    expect(buildCardBody(cardInput({ orderInDeck: '' }))).toMatchObject({ orderInDeck: 1 });
    // revision uses Number.isFinite, so a 0 is kept rather than replaced.
    expect(buildCardBody(cardInput({ revision: 0 }))).toMatchObject({ revision: 0 });
    expect(buildCardBody(cardInput({ revision: 'abc' }))).toMatchObject({ revision: 1 });
  });
});

describe('parseDraftVersion', () => {
  it('parseDraftVersion accepts whole numbers from 1 and rejects everything else', () => {
    expect(parseDraftVersion('1')).toBe(1);
    expect(parseDraftVersion(' 9 ')).toBe(9);
    expect(parseDraftVersion(3)).toBe(3);

    for (const bad of ['0', '1.5', '', 'abc', '-2']) {
      expect(parseDraftVersion(bad)).toBeNull();
    }
  });
});

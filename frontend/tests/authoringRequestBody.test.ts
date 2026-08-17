// What actually goes on the wire.
//
// Written after a mutation survived that should not have. cardEntryDefects
// asserts that NewCardPage and EditCardPage pass `revision` to createCard and
// updateCard, and those assertions read the arguments of a mocked function. So
// deleting `body.revision = params.revision` from authoring.ts left all 280
// tests green: the page hands the value over, and the layer below drops it on
// the floor with nobody watching.
//
// That is the same defect the pages had — a value collected and discarded —
// one level down, and the test that was supposed to catch it stopped at the
// boundary where it happens. Page-level tests can only see as far as the seam
// they mock. This file mocks the seam below instead, so the two together cover
// the whole chain: form -> function arguments -> request body.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpMock = vi.hoisted(() => ({
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../src/api/http', () => ({ http: httpMock }));

const { createCard, updateCard } = await import('../src/api/authoring');

/** The envelope every endpoint returns; the value is irrelevant here. */
function response() {
  return {
    data: {
      success: true,
      data: { id: 1, deckId: 7, stableUid: 'cs-a-001', question: 'q' },
      error: null,
      traceId: 't',
    },
  };
}

function bodyOf(mock: typeof httpMock.post): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  httpMock.post.mockResolvedValue(response());
  httpMock.put.mockResolvedValue(response());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createCard puts the fields it accepts into the request', () => {
  it('sends every optional field that was supplied', async () => {
    await createCard({
      deckId: 7,
      question: 'What is a span?',
      explanation: 'A view over memory.',
      realWorldUsage: 'Parsing without allocating.',
      codeSnippet: 'var s = span[1..];',
      codeLanguage: 'csharp',
      difficulty: 3,
      orderInDeck: 30,
      revision: 3,
      stableUid: 'cs-span-001',
    });

    expect(bodyOf(httpMock.post)).toMatchObject({
      deckId: 7,
      question: 'What is a span?',
      explanation: 'A view over memory.',
      realWorldUsage: 'Parsing without allocating.',
      codeSnippet: 'var s = span[1..];',
      codeLanguage: 'csharp',
      difficulty: 3,
      orderInDeck: 30,
      revision: 3,
      stableUid: 'cs-span-001',
    });
  });

  it('leaves out what was not supplied, rather than sending undefined', async () => {
    await createCard({ deckId: 7, question: 'q', stableUid: 'cs-a-001' });

    const body = bodyOf(httpMock.post);
    // Omission is how a partial update says "do not change this". Sending an
    // explicit undefined would serialise away to the same thing here, but the
    // two stop being equivalent the moment anything reads Object.keys.
    for (const absent of ['explanation', 'realWorldUsage', 'codeSnippet', 'codeLanguage', 'difficulty', 'orderInDeck', 'revision']) {
      expect(Object.hasOwn(body, absent)).toBe(false);
    }
  });
});

describe('updateCard puts the fields it accepts into the request', () => {
  it('sends every optional field that was supplied', async () => {
    await updateCard({
      id: 101,
      deckId: 7,
      question: 'q',
      explanation: 'e',
      realWorldUsage: 'u',
      codeSnippet: 'c',
      codeLanguage: 'csharp',
      difficulty: 2,
      orderInDeck: 20,
      revision: 7,
      stableUid: 'cs-a-001',
      expectedVersion: 4,
    });

    expect(bodyOf(httpMock.put)).toMatchObject({
      id: 101,
      deckId: 7,
      question: 'q',
      explanation: 'e',
      realWorldUsage: 'u',
      codeSnippet: 'c',
      codeLanguage: 'csharp',
      difficulty: 2,
      orderInDeck: 20,
      revision: 7,
      stableUid: 'cs-a-001',
      expectedVersion: 4,
    });
  });

  it('omits the fields the caller left alone', async () => {
    await updateCard({ id: 101, deckId: 7, question: 'q', expectedVersion: 4 });

    const body = bodyOf(httpMock.put);
    // This is what makes a partial edit safe: EditCardPage does not send
    // fields the form has no control for, and the server keeps whatever it had.
    for (const absent of ['explanation', 'realWorldUsage', 'codeSnippet', 'codeLanguage', 'difficulty', 'orderInDeck', 'revision', 'stableUid']) {
      expect(Object.hasOwn(body, absent)).toBe(false);
    }
    expect(body.expectedVersion).toBe(4);
  });
});

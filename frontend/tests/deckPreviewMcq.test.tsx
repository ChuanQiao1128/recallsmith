// @vitest-environment jsdom
//
// F28 / CFE-08. The Deck Preview page rebuilds deck.json in the browser as an
// approximate preview. It used to drop every card's Topic and Mcq, so an author
// validating an MCQ deck saw a plain Q/A file that is not what mobile installs.
// buildDeckExportPreview now appends Topic and Mcq the way the publish worker
// writes them (CardExportData order: after Revision, omitted when null), and the
// page says plainly that it is an approximate preview.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import type { McqBlob } from '../src/types/mcq';
import { buildDeckExportPreview } from '../src/lib/deckExportPreview';
import { signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ok } from './support/apiResult';
import { queryClient } from '../src/api/queryClient';

const DECK_ID = 7;

// A valid McqBlob: three options a/b/c, one correct, a why on each wrong option,
// v: 1. Copied from tests/cardMcqConsole.test.tsx. The keys are deliberately not
// alphabetical, so the "as received" test proves the object is passed through
// rather than rebuilt into some sorted shape.
const MCQ: McqBlob = {
  options: [
    { key: 'a', text: 'First option', why: 'Why the first option is wrong.', correct: false },
    { key: 'b', text: 'Second option', why: null, correct: true },
    { key: 'c', text: 'Third option', why: 'Why the third option is wrong.', correct: false },
  ],
  v: 1,
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};

const deck: Deck = {
  id: DECK_ID,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
  author: 'console-tests',
  locale: 'en',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function card(over: Partial<Card> = {}): Card {
  return {
    id: 101,
    deckId: DECK_ID,
    stableUid: 'cs-mcq-001',
    question: 'Which storage option has the LEAST operational overhead?',
    explanation: 'Because it is fully managed.',
    realWorldUsage: null,
    codeSnippet: null,
    codeLanguage: null,
    difficulty: 2,
    orderInDeck: 10,
    revision: 4,
    version: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  } as Card;
}

describe('the approximate preview carries the MCQ shape', () => {
  it('puts Topic and Mcq on a card that has them, after Revision', () => {
    const mcqCard = card({ topic: 'Storage', mcq: MCQ, revision: 4 });
    const model = buildDeckExportPreview(deck, [mcqCard]);

    const keys = Object.keys(model.Cards[0]);
    expect(keys.slice(-3)).toEqual(['Revision', 'Topic', 'Mcq']);
    expect(model.Cards[0].Topic).toBe('Storage');
  });

  it('leaves Topic and Mcq off a plain Q/A card', () => {
    const explicitNulls = card({ id: 1, stableUid: 'cs-a-001', orderInDeck: 10, topic: null, mcq: null });
    const absent = card({ id: 2, stableUid: 'cs-b-001', orderInDeck: 20 });
    const model = buildDeckExportPreview(deck, [explicitNulls, absent]);

    for (const c of model.Cards) {
      expect(Object.hasOwn(c, 'Topic')).toBe(false);
      expect(Object.hasOwn(c, 'Mcq')).toBe(false);
    }
  });

  it('copies the server mcq object as received', () => {
    const mcqCard = card({ topic: 'Storage', mcq: MCQ });
    const model = buildDeckExportPreview(deck, [mcqCard]);

    expect(JSON.stringify(model.Cards[0].Mcq)).toBe(JSON.stringify(MCQ));
  });
});

// --- page label -----------------------------------------------------------
// The F3b harness from cardEntryDefects.test.tsx: hoisted api mock, the page
// mounted bare through the app query singleton.

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  fetchCardById: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckPreviewPage } = await import('../src/pages/DeckPreviewPage');

describe('the page tells the author the preview is approximate', () => {
  beforeEach(() => {
    signOut();
    signInAsSuperAdmin();
    api.fetchDeckById.mockResolvedValue(ok(deck));
    api.fetchCardsByDeck.mockResolvedValue(ok([card({ topic: 'Storage', mcq: MCQ })]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    queryClient.clear();
    signOut();
  });

  function mountPreview() {
    return render(
      <MemoryRouter initialEntries={[`/decks/preview?deckId=${DECK_ID}`]}>
        <DeckPreviewPage />
      </MemoryRouter>,
    );
  }

  it('labels the page as an approximate preview', async () => {
    mountPreview();

    expect(await screen.findByText('Approximate preview')).not.toBeNull();

    const pre = document.querySelector('pre')!;
    expect(pre.textContent).toContain('"Mcq"');

    const download = await screen.findByRole('button', { name: /download deck\.json/i });
    expect((download as HTMLButtonElement).disabled).toBe(false);
  });
});

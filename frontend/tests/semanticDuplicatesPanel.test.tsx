// @vitest-environment jsdom
//
// R20 V10: the "Semantic duplicates" panel on the AI QA page (contract §5).
// It reads a deck's semantic-duplicate pairs and the embeddings status; a
// server without pgvector answers VECTOR_NOT_READY and the panel explains the
// owner steps in a neutral callout. src/api/embeddings is mocked, so nothing
// here can leave the process.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { deferred, ok, refused } from './support/apiResult';
import type { ApiResult } from '../src/types/api';
import type { EmbeddingsStatus, SemanticDuplicates } from '../src/api/embeddings';

const api = vi.hoisted(() => ({
  fetchEmbeddingsStatus: vi.fn(),
  fetchSemanticDuplicates: vi.fn(),
}));

vi.mock('../src/api/embeddings', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/embeddings')>();
  return { ...actual, ...api };
});

const { SemanticDuplicatesPanel } = await import('../src/features/qa/SemanticDuplicatesPanel');

const STATUS: EmbeddingsStatus = { engine: 'vector', model: 'BAAI/bge-small-en-v1.5', cards: 120, embedded: 118, stale: 2 };

const DUPLICATES: SemanticDuplicates = {
  engine: 'vector',
  minCosine: 0.9,
  pairs: [
    {
      cosine: 0.9731,
      a: { cardId: 11, stableUid: 'aws-0011', question: 'What is S3?' },
      b: { cardId: 12, stableUid: 'aws-0012', question: 'What does Amazon S3 do?' },
    },
    {
      cosine: 0.912,
      a: { cardId: 21, stableUid: 'aws-0021', question: '' },
      b: { cardId: 22, stableUid: 'aws-0022', question: 'What is an EC2 instance?' },
    },
  ],
};

function mount(deckId = 7) {
  return render(
    <MemoryRouter>
      <SemanticDuplicatesPanel deckId={deckId} />
    </MemoryRouter>,
  );
}

async function settled() {
  await act(async () => {});
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchEmbeddingsStatus.mockResolvedValue(ok(STATUS));
  api.fetchSemanticDuplicates.mockResolvedValue(ok(DUPLICATES));
});

afterEach(() => {
  cleanup();
});

describe('SemanticDuplicatesPanel', () => {
  it('lists each pair with its cosine and both questions linked to the editor', async () => {
    mount();
    const table = await screen.findByRole('table', { name: 'Semantic duplicate pairs' });
    expect(api.fetchSemanticDuplicates).toHaveBeenCalledWith(7);
    expect(api.fetchEmbeddingsStatus).toHaveBeenCalledWith(7);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Semantic duplicates');

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByRole('cell')[0].textContent).toBe('0.973');
    expect(within(rows[0]).getByRole('link', { name: 'Open in editor: What is S3?' }).getAttribute('href')).toBe(
      '/decks/cards/edit?deckId=7&cardId=11',
    );
    expect(
      within(rows[0]).getByRole('link', { name: 'Open in editor: What does Amazon S3 do?' }).getAttribute('href'),
    ).toBe('/decks/cards/edit?deckId=7&cardId=12');
    // A card without a question is named by its stable uid.
    expect(within(rows[1]).getByRole('link', { name: 'Open in editor: aws-0021' })).toBeTruthy();
  });

  it('shows the embeddings status', async () => {
    mount();
    expect((await screen.findByTestId('qa-semantic-status')).textContent).toBe(
      '118 of 120 card(s) embedded, 2 stale (the card changed since it was embedded) · model BAAI/bge-small-en-v1.5.',
    );
  });

  it('says so when no pair reaches the floor', async () => {
    api.fetchSemanticDuplicates.mockResolvedValue(ok({ ...DUPLICATES, pairs: [] }));
    mount();
    expect(await screen.findByText('No pair at or above cosine 0.90.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains the owner steps in a neutral callout on VECTOR_NOT_READY', async () => {
    api.fetchEmbeddingsStatus.mockResolvedValue(refused('VECTOR_NOT_READY', 'Vector search is not set up.'));
    api.fetchSemanticDuplicates.mockResolvedValue(refused('VECTOR_NOT_READY', 'Vector search is not set up.'));
    mount();
    const callout = await screen.findByTestId('qa-semantic-not-ready');
    expect(callout.textContent).toContain('Semantic search is not set up yet');
    const steps = within(callout).getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('Install the pgvector extension');
    expect(steps[1]).toContain('Run the database migration');
    expect(steps[2]).toContain('Push the embeddings');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('treats a status engine of none as not ready too', async () => {
    api.fetchEmbeddingsStatus.mockResolvedValue(ok({ ...STATUS, engine: 'none', model: null, embedded: 0 }));
    api.fetchSemanticDuplicates.mockResolvedValue(refused('VECTOR_NOT_READY', 'x'));
    mount();
    expect(await screen.findByTestId('qa-semantic-not-ready')).toBeTruthy();
  });

  it('shows any other failure as an error', async () => {
    api.fetchSemanticDuplicates.mockResolvedValue(refused('FORBIDDEN', 'No read access to this deck.'));
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('No read access to this deck.');
    await settled();
    expect(screen.getByTestId('qa-semantic-status')).toBeTruthy();
  });

  it('reloads for a new deck and drops an answer for the old one', async () => {
    const slow = deferred<ApiResult<SemanticDuplicates>>();
    api.fetchSemanticDuplicates.mockReturnValueOnce(slow.promise);
    const view = mount(7);
    expect(screen.getByText('Loading semantic duplicates…')).toBeTruthy();

    view.rerender(
      <MemoryRouter>
        <SemanticDuplicatesPanel deckId={9} />
      </MemoryRouter>,
    );
    await screen.findByRole('table', { name: 'Semantic duplicate pairs' });
    expect(api.fetchSemanticDuplicates).toHaveBeenLastCalledWith(9);
    await act(async () => slow.resolve(ok({ ...DUPLICATES, pairs: [] })));
    // Deck 7's late, empty answer does not replace deck 9's pairs.
    expect(screen.getByRole('table', { name: 'Semantic duplicate pairs' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in editor: What is S3?' }).getAttribute('href')).toBe(
      '/decks/cards/edit?deckId=9&cardId=11',
    );
  });
});

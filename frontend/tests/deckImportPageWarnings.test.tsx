// @vitest-environment jsdom
//
// DeckImportPage, the amber suggestions panel: it sits below the error panel,
// outside the five-badge strip, never blocks the run, and never disturbs the
// "N problem(s)" count. Harness copied from deckImportPageRun.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Card } from '../src/types/card';
import type { Deck } from '../src/types/deck';
import { ok } from './support/apiResult';
import { renderAt } from './support/routerProbe';

const api = vi.hoisted(() => ({
  fetchDeckById: vi.fn(),
  fetchCardsByDeck: vi.fn(),
  createCard: vi.fn(),
  updateCard: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckImportPage } = await import('../src/pages/DeckImportPage');

const DECK_ID = 7;
const DECK_SLUG = 'csharp-backend-fundamentals';

const deck: Deck = {
  id: DECK_ID,
  slug: DECK_SLUG,
  title: 'C# Backend Fundamentals',
  author: 'console-tests',
  description: 'Interview prep',
  locale: 'en-US',
  deckType: 1,
  version: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function body(slug: string): string {
  return [
    `# deck: ${slug}`,
    '',
    '## cs-a-001 | d2',
    'Q:',
    'Alpha question',
    'A:',
    'Alpha answer v2',
    '',
    '## cs-b-002 | d3',
    'Q:',
    'Beta question',
    'A:',
    'Beta answer',
    '',
  ].join('\n');
}

// plan §4.3 card 1 (docs/mcq-card-type-plan-2026-09-18.md:177-217), copied verbatim.
const MCQ_CARD_1 = [
  '## aws-sqs-order-buffer-mcq-01 | d2',
  'QUALIFIER: LEAST operational overhead',
  'Q:',
  'An order API runs on Amazon EC2 instances behind an Application Load Balancer.',
  'During flash sales the downstream fulfilment service is overwhelmed and orders',
  'are lost. The company wants the API to keep accepting orders while fulfilment',
  'catches up, with the LEAST operational overhead. Which solution meets these',
  'requirements?',
  'OPT: a',
  'Increase the instance size of the fulfilment service and enable detailed',
  'CloudWatch monitoring.',
  'WHY:',
  'Vertical scaling raises the ceiling but does not buffer a burst; once the larger',
  'instance saturates, orders are lost again, and someone has to keep resizing it.',
  'OPT: b *',
  'Publish each order to an Amazon SQS standard queue and run the fulfilment',
  'service in an Auto Scaling group that scales on',
  'ApproximateNumberOfMessagesVisible.',
  'OPT: c',
  'Write each order to an Amazon Kinesis Data Streams stream with one shard and',
  'process it with AWS Lambda.',
  'WHY:',
  'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard',
  'count right is exactly the operational work the question asks to avoid.',
  'OPT: d',
  'Insert each order into an Amazon RDS table and have the fulfilment service poll',
  'for unprocessed rows every second.',
  'WHY:',
  'Polling a relational table turns the database into a queue: extra load, locking',
  'logic, and the two services stay coupled.',
  'A:',
  'Put an SQS standard queue between the API and fulfilment and scale the',
  'fulfilment fleet on queue depth. The queue stores the burst durably and the',
  'Auto Scaling group drains it with no manual work. Resizing the instance only',
  'raises the ceiling, a one-shard Kinesis stream caps throughput and adds shard',
  'management, and polling RDS makes the database a queue.',
  'USAGE:',
  'In my own checkout side project the checkout Lambda drops a message on SQS and',
  'the email sender consumes it, so an email-provider outage never blocks a',
  'purchase.',
].join('\n');

const DOC_WARN_ONLY = ['# deck: csharp-backend-fundamentals', '', MCQ_CARD_1].join('\n');
const DOC_CLEAN = body(DECK_SLUG);
const DOC_WARN_AND_PROBLEM = DOC_WARN_ONLY + '\n\n## cs-c-003 | d1\nQ:\nGamma question\n';

// ---------------------------- handles ----------------------------

function sourceBox(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('no textarea on the page');
  return el;
}

function importButton(): HTMLButtonElement {
  const el = screen.getByRole('button', { name: /^Import \d+ card/ });
  if (!(el instanceof HTMLButtonElement)) throw new Error('import control is not a button');
  return el;
}

/** The badge row containing `anchor`, read left to right as the user sees it. */
function badgeStrip(anchor: string): string[] {
  const label = screen.getByText(anchor);
  const strip = label.parentElement?.parentElement;
  if (!(strip instanceof HTMLElement)) throw new Error(`no badge strip around "${anchor}"`);
  return Array.from(strip.children).map(c => c.textContent ?? '');
}

function badgeStripElement(): HTMLElement {
  const label = screen.getByText('parse errors');
  const strip = label.parentElement?.parentElement;
  if (!(strip instanceof HTMLElement)) throw new Error('no badge strip');
  return strip;
}

async function toPreview(
  user: ReturnType<typeof userEvent.setup>,
  doc: string,
  existing: Card[],
): Promise<void> {
  api.fetchCardsByDeck.mockResolvedValue(ok(existing));
  renderAt(<DeckImportPage />, [`/decks/import?deckId=${DECK_ID}`]);
  await screen.findByText('1 · Source');
  await user.click(sourceBox());
  await user.paste(doc);
  await user.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('2 · Preview');
}

beforeEach(() => {
  api.fetchDeckById.mockResolvedValue(ok(deck));
  api.fetchCardsByDeck.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the suggestions panel', () => {
  it('lists suggestions below the errors without blocking the run', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_WARN_ONLY, []);

    const panel = screen.getByTestId('import-warnings');
    expect(panel).not.toBeNull();
    expect(screen.queryByText('1 suggestion — not blocking')).not.toBeNull();
    expect(within(panel).getByText('MCQ_WARN_CORRECT_LONGEST (1)')).not.toBeNull();

    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent ?? '').toMatch(/^line 3:/);

    expect(badgeStrip('parse errors')).toEqual([
      '1create',
      '0update',
      '0unchanged',
      '0conflict',
      '0parse errors',
    ]);
    expect(screen.queryByText(/problems? in the document/)).toBeNull();
    expect(importButton().disabled).toBe(false);

    const strip = badgeStripElement();
    expect(strip.contains(panel)).toBe(false);
    expect(strip.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no panel for a document without suggestions', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_CLEAN, []);

    expect(screen.queryByTestId('import-warnings')).toBeNull();
    expect(screen.queryByText(/suggestion/)).toBeNull();
  });

  it('keeps the problem count and the gate untouched beside suggestions', async () => {
    const user = userEvent.setup();
    await toPreview(user, DOC_WARN_AND_PROBLEM, []);

    expect(screen.queryByText('1 problem in the document')).not.toBeNull();
    expect(screen.queryByText('1 suggestion — not blocking')).not.toBeNull();
    expect(importButton().disabled).toBe(true);
    expect(badgeStrip('parse errors')[4]).toBe('1parse errors');
  });
});

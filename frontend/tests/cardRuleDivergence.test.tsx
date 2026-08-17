// @vitest-environment jsdom
//
// The two doors a card can enter this console through disagree about what a
// valid card is. This file makes that disagreement a fact you can read, run,
// and eventually rule on — it does NOT repair it.
//
// ---------------------------------------------------------------------------
// WHY THE TWO ASSERTIONS SIT IN THE SAME it()
// ---------------------------------------------------------------------------
// Each case pushes ONE fixture value through BOTH doors and asserts on both
// results side by side. Splitting them into two files would leave the divergence
// alive only in a reader's head: either half could be deleted and nothing would
// notice. Side by side, the day someone unifies the rules exactly one expect
// goes red, and the name of that expect is the decision they just made.
//
// ---------------------------------------------------------------------------
// WHY THE IMPORT SIDE CALLS parseDeckMarkdown AND NOT validateCards
// ---------------------------------------------------------------------------
// validateCards is exported, so it is tempting to call it directly with a
// hand-built ParsedCard. That would overstate what the import door actually
// enforces. Three of its branches are unreachable through the only production
// entry point:
//
//   BAD_DIFFICULTY     - the card header regex is /^d(\d+)$/ and the range
//                        check runs at header-parse time (deckImport.ts:~305),
//                        which `continue`s before a draft exists. A card with
//                        an out-of-range difficulty never reaches validateCards.
//   MISSING_QUESTION   - finishCard returns early when the Q body is empty, so
//   MISSING_ANSWER       the card is dropped before validateCards sees it. Both
//                        codes are emitted, but by finishCard, with different
//                        message text ("has no Q: content", not "has an empty
//                        question").
//
// Calling validateCards would therefore produce a divergence table describing
// rules the import door does not really run. Going through parseDeckMarkdown
// costs a few lines of fixture markdown and buys a table that is true. (That
// unreachability is itself recorded as F7 in docs/console-refactor-plan.md; it
// is pinned here, not fixed.)
//
// ---------------------------------------------------------------------------
// WHY THE FORM SIDE MOUNTS THE REAL CardForm
// ---------------------------------------------------------------------------
// CardForm's validation lives inside handleSubmit, an inner function of the
// component. Any "conditional copy" of it in a test would be a second
// implementation that drifts silently. So the component is rendered and its
// submit button is really clicked, and what is asserted is what onSubmit
// receives — the exact payload the page would have sent to the server.
//
// ---------------------------------------------------------------------------
// THE DIVERGENCE IS BIDIRECTIONAL
// ---------------------------------------------------------------------------
// D1-D5 are cases where import is stricter. D6-D7 are cases where the FORM is
// stricter. That asymmetry is the reason "just tighten the form to match the
// importer" is not a complete answer, and it is why those two cases are in this
// file even though they are the reverse shape of the others.
//
// NOTHING HERE MAY BE "FIXED" BY MAKING A SIDE STRICTER. Tightening the form is
// a product decision with a real cost (see the unification options in
// docs/console-refactor-plan.md) and it needs a human. If a change makes a D1-D5
// form-side assertion go red, that change silently narrowed what the owner of
// this project can type into his own card form.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { parseDeckMarkdown } from '../src/lib/deckImport';
import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import type { Deck } from '../src/types/deck';

afterEach(() => {
  cleanup();
});

/** The one fixture shape both adapters read. */
interface CardShape {
  stableUid: string;
  difficulty: number;
  question: string;
  explanation: string;
  /**
   * Form-side only. The import door computes orderInDeck itself
   * (`cards.length * 10`), which is the whole point of D6.
   */
  orderInDeck?: number;
}

const BASE: CardShape = {
  stableUid: 'cs-async-001',
  difficulty: 2,
  question: 'What does await actually suspend?',
  explanation: 'The async function, not the thread.',
};

/** Adapter 1: a fixture as the markdown the import door reads. */
function docFor(...shapes: readonly CardShape[]): string {
  const blocks = shapes.map(shape => {
    const lines = [`## ${shape.stableUid} | d${shape.difficulty}`, 'Q:'];
    if (shape.question) lines.push(shape.question);
    lines.push('A:');
    if (shape.explanation) lines.push(shape.explanation);
    return lines.join('\n');
  });
  return ['# deck: divergence-demo', '', ...blocks].join('\n') + '\n';
}

/** Adapter 2: the same fixture as the values the form door starts from. */
function valuesFor(shape: CardShape): CardFormValues {
  return {
    question: shape.question,
    stableUid: shape.stableUid,
    explanation: shape.explanation,
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: shape.difficulty,
    orderInDeck: shape.orderInDeck ?? 10,
    revision: 1,
  };
}

const DECK: Deck = {
  id: 1,
  slug: 'divergence-demo',
  title: 'Divergence Demo',
  author: 'tests',
  locale: 'en',
  deckType: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

interface FormOutcome {
  /** True when the form ran onSubmit, i.e. it did not refuse the values. */
  accepted: boolean;
  /** Exactly what onSubmit received; this is what would reach the server. */
  submitted: CardFormValues | null;
  /** The rendered error banner text, or null when there is no banner. */
  error: string | null;
}

/** Mount the real CardForm on a fixture and really click Create Card. */
async function submitThroughForm(shape: CardShape): Promise<FormOutcome> {
  const received: CardFormValues[] = [];
  const onSubmit = vi.fn(async (values: CardFormValues) => {
    received.push(values);
    return { ok: true };
  });

  const { container } = render(
    <CardForm
      mode="create"
      deck={DECK}
      initialValues={valuesFor(shape)}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );

  await act(async () => {
    screen.getByText('Create Card').click();
  });

  const banner = container.querySelector('.bg-red-50');
  return {
    accepted: received.length > 0,
    submitted: received[0] ?? null,
    error: banner ? banner.textContent : null,
  };
}

describe('D1: an empty Explanation', () => {
  it('is dropped by the import door and stored by the form door', async () => {
    const shape: CardShape = { ...BASE, explanation: '' };

    // Import side: the card never makes it into the deck at all.
    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('MISSING_ANSWER');
    expect(parsed.cards).toHaveLength(0);

    // Form side: accepted, and the empty string is what gets sent.
    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(true);
    expect(outcome.submitted?.explanation).toBe('');
  });
});

describe('D2: a stableUid the uid pattern rejects', () => {
  it('is refused by the import door and stored verbatim by the form door', async () => {
    const shape: CardShape = { ...BASE, stableUid: 'A_B' };

    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('BAD_UID_FORMAT');

    // The card is still parsed — the issue is advisory to the operator — but
    // DeckImportPage refuses to run a plan while errors exist.
    expect(parsed.cards).toHaveLength(1);

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(true);
    expect(outcome.submitted?.stableUid).toBe('A_B');
  });
});

describe('D3: a stableUid past MAX_UID_LENGTH', () => {
  it('is refused by the import door and stored at full length by the form door', async () => {
    const overlong = 'a'.repeat(129);
    const shape: CardShape = { ...BASE, stableUid: overlong };

    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('BAD_UID_FORMAT');

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(true);
    expect(outcome.submitted?.stableUid).toBe(overlong);
    expect(outcome.submitted?.stableUid).toHaveLength(129);
  });
});

describe('D4: a difficulty outside 0..4', () => {
  it('costs the import door the whole card and reaches the server from the form door', async () => {
    const shape: CardShape = { ...BASE, difficulty: 9 };

    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('BAD_DIFFICULTY');
    // Rejected at header-parse time, so no draft is ever opened for it.
    expect(parsed.cards).toHaveLength(0);

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(true);
    // Deliberately asserts the SUBMITTED value, not the <select> display value:
    // jsdom and real browsers disagree about selectedIndex for a controlled
    // select whose value matches no option (the spec says -1, jsdom answers 0),
    // so asserting on the widget would pin a jsdom quirk instead of a rule.
    expect(outcome.submitted?.difficulty).toBe(9);
  });
});

describe('D5: the same stableUid used twice', () => {
  it('is a named error at the import door and has no code path at the form door', async () => {
    const shape: CardShape = { ...BASE };
    const twin: CardShape = { ...BASE, question: 'A different question, same uid.' };

    const parsed = parseDeckMarkdown(docFor(shape, twin));
    expect(parsed.errors.map(issue => issue.code)).toContain('DUPLICATE_UID');
    expect(parsed.cards).toHaveLength(2);

    // The form holds one card and never asks whether the uid is taken, so both
    // submissions succeed. Uniqueness is a property of a set; answering it in
    // the form would take a network call, which is a behaviour change.
    const first = await submitThroughForm(shape);
    cleanup();
    const second = await submitThroughForm(twin);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.submitted?.stableUid).toBe(second.submitted?.stableUid);
  });
});

describe('D6 (reversed): orderInDeck = 0', () => {
  it('is what the import door assigns and what the form door refuses', async () => {
    // Import side: every document's first card gets orderInDeck 0.
    const parsed = parseDeckMarkdown(docFor(BASE));
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].orderInDeck).toBe(0);
    expect(parsed.errors.map(issue => issue.code)).not.toContain('BAD_CARD_HEADER');

    // Form side: the identical value is refused outright.
    const outcome = await submitThroughForm({ ...BASE, orderInDeck: 0 });
    expect(outcome.accepted).toBe(false);
    expect(outcome.error).toBe('orderInDeck must be a positive number (e.g. 10, 20, 30).');
  });
});

// ---------------------------------------------------------------------------
// C1-C2: WHAT THE TWO DOORS AGREE ON
// ---------------------------------------------------------------------------
// Not divergences. These are here because they are the only tests that exercise
// hasContent through CardForm, and without them the form's half of the shared
// module would have no coverage at all: D1-D7 never submit an empty question or
// an empty uid, so replacing hasContent with `return true` would leave the
// form-side assertions green and the extraction would be unverified on the side
// that matters most to the person using it daily.
//
// They also mark the boundary of the agreement. Everything below is shared;
// everything in D1-D5 is not.

describe('C1: an empty question', () => {
  it('is refused by both doors', async () => {
    const shape: CardShape = { ...BASE, question: '' };

    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('MISSING_QUESTION');
    expect(parsed.cards).toHaveLength(0);

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(false);
    expect(outcome.error).toBe('Question is required.');
  });

  it('is refused by both doors when it is only whitespace', async () => {
    const shape: CardShape = { ...BASE, question: '   ' };

    // The importer drops whitespace-only bodies during lexing, before a card
    // exists; the form trims at submit. Different mechanisms, same verdict.
    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.cards).toHaveLength(0);

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(false);
    expect(outcome.error).toBe('Question is required.');
  });
});

describe('C2: an empty stableUid', () => {
  it('is refused by both doors', async () => {
    const shape: CardShape = { ...BASE, stableUid: '' };

    // `## | d2` has no uid, so the header itself is rejected.
    const parsed = parseDeckMarkdown(docFor(shape));
    expect(parsed.errors.map(issue => issue.code)).toContain('BAD_CARD_HEADER');
    expect(parsed.cards).toHaveLength(0);

    const outcome = await submitThroughForm(shape);
    expect(outcome.accepted).toBe(false);
    expect(outcome.error).toBe('StableUid is required.');
  });
});

describe('D7 (reversed): difficulty 0 and 4', () => {
  it('are legal at the import door and unreachable in the form door widget', async () => {
    for (const difficulty of [0, 4]) {
      const parsed = parseDeckMarkdown(docFor({ ...BASE, difficulty }));
      expect(parsed.errors.map(issue => issue.code)).not.toContain('BAD_DIFFICULTY');
      expect(parsed.cards).toHaveLength(1);
      expect(parsed.cards[0].difficulty).toBe(difficulty);
    }

    // Form side: the widget only offers 1/2/3, so a human at the keyboard can
    // never choose the two extremes the importer accepts.
    render(
      <CardForm
        mode="create"
        deck={DECK}
        initialValues={valuesFor(BASE)}
        onSubmit={async () => ({ ok: true })}
        onCancel={() => {}}
      />,
    );
    const select = screen.getByLabelText('Difficulty') as HTMLSelectElement;
    const offered = Array.from(select.options).map(option => option.value);
    expect(offered).toEqual(['1', '2', '3']);
  });
});

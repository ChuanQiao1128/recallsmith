// @vitest-environment jsdom
//
// The form door's half of "one kernel, two severities".
//
// tests/cardRuleDivergence.test.tsx records that a card can enter this console
// two ways and that the two doors ask different questions. The ruling on that
// divergence (docs/console-refactor-plan.md 8.2, option 3) was: keep the import
// door blocking, and let the form door say the same thing without blocking.
// This file is the second half of that ruling — the divergence file keeps
// guarding what the form ACCEPTS, and this one guards what the form SAYS.
//
// ---------------------------------------------------------------------------
// WHY EVERY QUERY GOES THROUGH data-card-hint AND NEVER THROUGH THE WORDING
// ---------------------------------------------------------------------------
// The importer's messages carry line numbers and address a deck author;
// tests/deckImport.test.ts asserts those literally. The form's address a person
// mid-keystroke and are deliberately NOT shared with the importer. Asserting on
// the form's wording here would re-create the coupling the split exists to
// avoid, and would make a copy-edit look like a behaviour change. The attribute
// is the contract; the sentence is not.
//
// ---------------------------------------------------------------------------
// THE THREE HINTS ARE NOWHERE NEAR EQUALLY REACHABLE
// ---------------------------------------------------------------------------
// Only the explanation hint fires in ordinary daily use. The uid hint is
// unreachable while creating a card — the field re-slugifies on every keypress
// and blur strips the trailing separator, so the value is legal by the time
// anything is allowed to look at it — and its real audience is a historical uid
// sitting in a card being edited, where the field is readOnly. The difficulty
// hint is nearly unreachable from either direction: the widget offers 1/2/3 and
// the importer rejects out-of-range values at header-parse time, so only a value
// already in the database can light it. Cases 3, 4 and 6 below reach them by
// planting the value in initialValues, which is exactly how they arise in
// production. Do not read three cases of equal length as three risks of equal
// size.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import type { Deck } from '../src/types/deck';
import { MAX_UID_LENGTH } from '../src/lib/cardRules';

const deck = {
  id: 7,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
} as Deck;

/** A card that raises no hint at all, so each case turns on exactly one field. */
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
    ...over,
  };
}

let submitted: CardFormValues[] = [];

function mount(mode: 'create' | 'edit', initial: CardFormValues) {
  submitted = [];
  return render(
    <CardForm
      mode={mode}
      deck={deck}
      initialValues={initial}
      onSubmit={async v => {
        submitted.push(v);
        return { ok: true };
      }}
      onCancel={() => {}}
    />,
  );
}

function uidField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[placeholder="js-basics-let-const-var"]');
  expect(field).not.toBeNull();
  return field!;
}

/** The hint attached to one field, or null when that field is not hinting. */
function hint(container: HTMLElement, field: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-card-hint="${field}"]`);
}

/** Every field currently hinting, sorted, so a case reads as a set not an order. */
function hintFields(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-card-hint]')]
    .map(node => node.getAttribute('data-card-hint') ?? '')
    .sort();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1-2: explanation, the only hint an ordinary day reaches
// ---------------------------------------------------------------------------

describe('an empty Explanation', () => {
  it('says so once the field has been left, because import drops such a card', async () => {
    const user = userEvent.setup();
    const { container } = mount('create', values({ explanation: '' }));

    // Nothing yet: the field has not been visited, so there is nothing to
    // report about it.
    expect(hint(container, 'explanation')).toBeNull();

    await user.click(screen.getByLabelText('Explanation'));
    await user.tab();

    expect(hint(container, 'explanation')).not.toBeNull();
  });

  it('stays quiet when the field has content', async () => {
    const user = userEvent.setup();
    const { container } = mount('create', values());

    await user.click(screen.getByLabelText('Explanation'));
    await user.tab();

    expect(hint(container, 'explanation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3-5: stableUid, where the length rule and the shape rule share one hint
// ---------------------------------------------------------------------------

describe('a stableUid the import door would refuse', () => {
  it('reports a uid past MAX_UID_LENGTH, reading the limit from cardRules', async () => {
    const user = userEvent.setup();
    const overlong = 'a'.repeat(MAX_UID_LENGTH + 1);
    const { container } = mount('create', values({ stableUid: overlong }));

    await user.click(uidField());
    await user.tab();

    // The value is untouched by the blur normaliser — it is already lowercase
    // alphanumeric — so the only thing wrong with it is its length.
    expect(uidField().value).toBe(overlong);
    expect(hint(container, 'stableUid')).not.toBeNull();
  });

  it('reports a historical uid the moment an edit form opens on it', () => {
    // `A_B` is the shape case, not the length case: the underscore is legal,
    // the capitals are not. In edit mode the field is readOnly, so this hint
    // states a consequence rather than asking for a change.
    const { container } = mount('edit', values({ stableUid: 'A_B' }));

    expect(hint(container, 'stableUid')).not.toBeNull();
  });

  it('stays quiet on a uid both doors accept', async () => {
    const user = userEvent.setup();
    const { container } = mount('create', values({ stableUid: 'cs-async-001' }));

    await user.click(uidField());
    await user.tab();

    expect(hint(container, 'stableUid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6: difficulty, reachable only from a value already stored
// ---------------------------------------------------------------------------

describe('a difficulty outside the range the import door accepts', () => {
  it('reports 9 and stays quiet on 2', () => {
    const outOfRange = mount('edit', values({ difficulty: 9 }));
    expect(hint(outOfRange.container, 'difficulty')).not.toBeNull();

    cleanup();

    const inRange = mount('edit', values({ difficulty: 2 }));
    expect(hint(inRange.container, 'difficulty')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7: the failure mode a naive implementation of all of the above would have
// ---------------------------------------------------------------------------

describe('a uid being typed right now', () => {
  it('is not hinted mid-keystroke, because every hyphen is briefly trailing', async () => {
    const user = userEvent.setup();
    const { container } = mount('create', values({ stableUid: '' }));

    // Visit and leave once, so the field counts as touched and the only thing
    // still holding the hint back is the caret sitting in it.
    await user.click(uidField());
    await user.type(uidField(), 'cs');
    await user.tab();
    expect(uidField().value).toBe('cs');
    expect(hint(container, 'stableUid')).toBeNull();

    await user.click(uidField());
    await user.type(uidField(), '-async-');

    // `cs-async-` fails UID_PATTERN, and it is a value the typist passes through
    // on the way to `cs-async-001`. Hinting here would light up on the way to
    // every correct uid this form can produce.
    expect(uidField().value).toBe('cs-async-');
    expect(hint(container, 'stableUid')).toBeNull();

    await user.tab();

    // Blur repairs the value, so leaving the field does not light it either.
    expect(uidField().value).toBe('cs-async');
    expect(hint(container, 'stableUid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8: the whole point of option 3
// ---------------------------------------------------------------------------

describe('a card that trips all three hints', () => {
  it('is still submitted verbatim, because hints advise and do not block', async () => {
    const user = userEvent.setup();
    const initial = values({ stableUid: 'A_B', explanation: '', difficulty: 9 });
    const { container } = mount('create', initial);

    await user.click(screen.getByText('Create Card'));

    expect(hintFields(container)).toEqual(['difficulty', 'explanation', 'stableUid']);

    // Not "was called" — was called with the same values, so a hint cannot grow
    // into a quiet normaliser either.
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(initial);
  });
});

// ---------------------------------------------------------------------------
// 9-10: a hint has to be announced, and must not impersonate the blocking banner
// ---------------------------------------------------------------------------

describe('every hint on screen', () => {
  it('is named by the aria-describedby of the control it belongs to', () => {
    const { container } = mount('edit', values({ stableUid: 'A_B', explanation: '', difficulty: 9 }));

    const hints = [...container.querySelectorAll<HTMLElement>('[data-card-hint]')];
    expect(hints).toHaveLength(3);

    for (const node of hints) {
      const field = node.getAttribute('data-card-hint') ?? '';
      expect(node.id).not.toBe('');

      const control = document.getElementById(field);
      expect(control).not.toBeNull();

      const described = (control!.getAttribute('aria-describedby') ?? '').split(/\s+/);
      expect(described).toContain(node.id);
    }
  });

  it('never wears the blocking banner class, so the two cannot be confused', () => {
    const { container } = mount('edit', values({ stableUid: 'A_B', explanation: '', difficulty: 9 }));

    // .bg-red-50 is how tests/cardRuleDivergence.test.tsx locates the refusal
    // banner. A hint sharing that class would make an advisory note read as a
    // refusal to every one of those assertions while they all stayed green.
    expect(container.querySelectorAll('[data-card-hint]')).toHaveLength(3);
    expect(container.querySelectorAll('.bg-red-50')).toHaveLength(0);
  });
});

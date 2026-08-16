// @vitest-environment jsdom
//
// The two ways the stable uid field lies to the person typing into it.
//
// stableUid is not a label, it is the identity of a card everywhere downstream:
// the backend groups review progress by (user_sub, deck_slug, stable_uid) and
// keys scheduler state on `deck_slug || ':' || stable_uid`, and deckImport
// reconciles on uid alone — never on question text or row id — because that is
// what identity means here. Two consequences follow, and the form got both
// wrong in opposite directions.
//
//   Editing it cannot work. Changing a card's uid strands every user's review
//   history under the old one and re-creates the card as a stranger. The submit
//   path already knew this and quietly sent the original value; what was broken
//   was the input that invited the edit and then threw it away without a word.
//
//   Typing it must work. The field slugified on every keystroke including the
//   strip of a trailing hyphen, so a hyphen vanished the instant it was typed
//   and the next character closed the gap: `cs-async-001` typed by hand became
//   `csasync001`, while the same string pasted stayed intact. The .md file says
//   the hyphenated one, so the next import saw a stranger and made a duplicate
//   instead of an update.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardForm } from '../src/components/CardForm';
import type { CardFormValues } from '../src/components/CardForm';
import type { Deck } from '../src/types/deck';

const deck = {
  id: 7,
  slug: 'csharp-fundamentals',
  title: 'C# Fundamentals',
} as Deck;

function values(over: Partial<CardFormValues> = {}): CardFormValues {
  return {
    question: '',
    stableUid: '',
    explanation: '',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: '',
    difficulty: 1,
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
  // The only monospaced text input on the form, and the only one whose
  // placeholder is a uid.
  const field = document.querySelector<HTMLInputElement>('input[placeholder="js-basics-let-const-var"]');
  expect(field).not.toBeNull();
  return field!;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('typing a uid produces the same string as pasting it', () => {
  it('keeps the hyphens the person typed', async () => {
    const user = userEvent.setup();
    mount('create', values());

    await user.type(uidField(), 'cs-async-001');

    // Typed one key at a time. Before the fix each hyphen was stripped as a
    // trailing character the moment it appeared, giving 'csasync001'.
    expect(uidField().value).toBe('cs-async-001');
  });

  it('agrees with what the same string does when pasted', async () => {
    const user = userEvent.setup();
    mount('create', values());

    await user.click(uidField());
    await user.paste('cs-async-001');
    const pasted = uidField().value;

    await user.clear(uidField());
    await user.type(uidField(), 'cs-async-001');

    // The two routes to the same uid have to agree, because the .md file and
    // the console are two routes to the same card.
    expect(uidField().value).toBe(pasted);
  });

  it('still refuses the characters a uid may not contain', async () => {
    const user = userEvent.setup();
    mount('create', values());

    await user.type(uidField(), 'CS Async 001');

    // Loosening the trailing-hyphen strip must not loosen anything else: the
    // import door rejects a uid outside [a-z0-9] plus separators, and a form
    // that let one through would just move the failure later. Case folds,
    // spaces become separators, and a run of them collapses to one.
    expect(uidField().value).toBe('cs-async-001');

    await user.clear(uidField());
    await user.type(uidField(), 'a@@@b');
    expect(uidField().value).toBe('a-b');
  });

  it('never lets a uid begin with a separator', async () => {
    const user = userEvent.setup();
    mount('create', values());

    // Leading is stripped while typing and trailing is not, and the asymmetry
    // is the whole fix: a leading hyphen is never wanted, so removing it costs
    // the typist nothing, while a trailing one is every hyphen at the moment it
    // is typed.
    await user.type(uidField(), '-cs');
    expect(uidField().value).toBe('cs');
  });

  it('drops a dangling hyphen once the person leaves the field', async () => {
    const user = userEvent.setup();
    mount('create', values());

    await user.type(uidField(), 'cs-async-');
    await user.tab();

    // Mid-word the hyphen has to survive; left dangling at the end it is not
    // part of any uid the importer would accept, so blur is where it goes.
    expect(uidField().value).toBe('cs-async');
  });
});

describe('the uid of a card that already exists is not offered for editing', () => {
  it('shows the value but does not accept changes to it', async () => {
    const user = userEvent.setup();
    mount('edit', values({ question: 'What does volatile guarantee?', stableUid: 'cs-volatile-001' }));

    expect(uidField().value).toBe('cs-volatile-001');
    expect(uidField().readOnly).toBe(true);

    await user.type(uidField(), 'x');

    // The submit path always sent the original. An input that accepted the
    // keystroke and discarded it was the whole defect: the user believed the
    // rename happened.
    expect(uidField().value).toBe('cs-volatile-001');
  });

  it('says why, because a silently inert field is the bug in a quieter form', () => {
    mount('edit', values({ stableUid: 'cs-volatile-001' }));

    // Whatever the wording, it has to name the consequence rather than just
    // report that the field is locked.
    const help = screen.getByText(/复习进度|学习记录|历史/);
    expect(help).not.toBeNull();
  });

  it('still lets a new card choose its uid', async () => {
    const user = userEvent.setup();
    mount('create', values());

    expect(uidField().readOnly).toBe(false);
    await user.type(uidField(), 'cs-new-001');
    expect(uidField().value).toBe('cs-new-001');
  });
});

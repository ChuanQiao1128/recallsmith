// @vitest-environment jsdom
//
// Everything window.confirm gave away for free, asserted one clause at a time.
//
// Replacing a browser dialog with a div is not a styling change. The browser's
// dialog is modal at the level of the whole window: focus cannot leave it, the
// page behind it cannot be typed into, Escape dismisses it, and when it closes
// the browser puts focus back where it was. A div does none of that, and the
// only thing standing between "looks like a dialog" and "is a dialog" is the
// code in ConfirmDialog.tsx plus this file.
//
// Every case below was written against exactly one mutation of that component,
// applied on its own and reverted before the next. The mutations are named in
// each case. One claim in the component — the isConnected guard on the focus
// restore — is deliberately NOT asserted anywhere here: it was measured to be
// unobservable (focus() on a detached node is a no-op, so removing the guard
// changes nothing), and a case written for it would be decoration.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';
import { useConfirm, type ConfirmOptions } from '../src/components/ui/ConfirmDialogContext';

/**
 * What each confirm() call resolved to, in order.
 *
 * A plain array rather than component state on purpose: a promise settling in a
 * microtask that then calls setState lands outside act(), and the resulting
 * warnings would be noise on top of every case. Nothing here needs the value
 * rendered — it needs the value *observed*, and an unsettled promise shows up
 * as a missing entry rather than as a suite timeout.
 */
const answers: boolean[] = [];

const DESTRUCTIVE: ConfirmOptions = {
  title: 'Delete this card?',
  body: 'This cannot be undone.',
  destructive: true,
  confirmLabel: 'Delete card',
};

const PLAIN: ConfirmOptions = {
  title: 'Publish deck "x"?',
  body: 'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json',
  confirmLabel: 'Publish',
};

const GATED: ConfirmOptions = {
  title: 'Reset the database?',
  body: 'There is no undo.',
  destructive: true,
  confirmLabel: 'Reset & migrate',
  confirmPhrase: 'RESET',
};

function Harness({ options, second }: { options: ConfirmOptions; second?: ConfirmOptions }) {
  const confirm = useConfirm();
  return (
    <div>
      <button type="button" onClick={() => void confirm(options).then(v => answers.push(v))}>
        Open
      </button>
      {second && (
        <button type="button" onClick={() => void confirm(second).then(v => answers.push(v))}>
          Open second
        </button>
      )}
      {/* Somewhere for focus to go if the trap ever stops holding. Placed
          before the overlay in DOM order, which is where Shift+Tab escapes to. */}
      <button type="button">Outside</button>
    </div>
  );
}

/** A trigger that removes itself once the answer is yes, like a deleted row. */
function DisappearingTrigger() {
  const confirm = useConfirm();
  const [gone, setGone] = useState(false);
  return (
    <div>
      {!gone && (
        <button
          type="button"
          onClick={() =>
            void confirm(DESTRUCTIVE).then(v => {
              answers.push(v);
              if (v) setGone(true);
            })
          }
        >
          Row delete
        </button>
      )}
      <button type="button">Outside</button>
    </div>
  );
}

function mount(options: ConfirmOptions, second?: ConfirmOptions) {
  return render(
    <ConfirmDialogProvider>
      <Harness options={options} second={second} />
    </ConfirmDialogProvider>,
  );
}

/** Open the dialog through the button, the way a page does. */
async function open(options: ConfirmOptions, second?: ConfirmOptions): Promise<HTMLElement> {
  mount(options, second);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  // alertdialog for destructive, dialog otherwise — and getByRole does not
  // resolve one from the other, which is the whole reason this is a branch.
  return screen.getByRole(options.destructive ? 'alertdialog' : 'dialog');
}

function cancelButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: 'Cancel' });
}

function confirmButton(dialog: HTMLElement, options: ConfirmOptions): HTMLElement {
  return within(dialog).getByRole('button', { name: options.confirmLabel as string });
}

beforeEach(() => {
  answers.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('opening focus', () => {
  it('moves focus off the page and into the dialog', async () => {
    // Mutation: delete the opening-focus effect. Focus then stays on the
    // trigger, behind the overlay, and a keyboard user has no way in.
    const dialog = await open(DESTRUCTIVE);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('lands on Cancel when the action destroys something', async () => {
    // Mutation: put the opening focus on the confirm button — which is what
    // the component did before this step, via autoFocus. One stray Space or
    // Enter on a dialog the user has not read yet completes the deletion.
    const dialog = await open(DESTRUCTIVE);
    expect(document.activeElement).toBe(cancelButton(dialog));
    expect(document.activeElement).not.toBe(confirmButton(dialog, DESTRUCTIVE));
  });

  it('lands on the confirm button when nothing is destroyed', async () => {
    // The mirror of the case above, and the reason the rule is "least
    // destructive control" rather than "always Cancel": publishing again is
    // free, so making every user Tab past a Cancel they do not want is friction
    // charged for nothing.
    const dialog = await open(PLAIN);
    expect(document.activeElement).toBe(confirmButton(dialog, PLAIN));
  });

  it('lands on the input when a phrase has to be typed', async () => {
    // Mutation: drop the gated branch from initialFocusTarget. Focus then
    // opens on Cancel and the user has to find the box that the dialog exists
    // to make them use.
    const dialog = await open(GATED);
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox'));
  });
});

describe('focus cannot leave while the dialog is open', () => {
  it('wraps from the last control back to the first', async () => {
    // Mutation: delete handlePanelKeyDown. Measured, not assumed: Tab from the
    // last button in the document moves focus to <body> in jsdom, so this
    // assertion goes red rather than passing on a technicality.
    const dialog = await open(DESTRUCTIVE);
    await userEvent.tab(); // Cancel -> Delete card
    expect(document.activeElement).toBe(confirmButton(dialog, DESTRUCTIVE));

    await userEvent.tab(); // Delete card -> wraps
    expect(document.activeElement).toBe(cancelButton(dialog));
  });

  it('wraps backwards from the first control to the last', async () => {
    // Mutation: drop the shiftKey branch. Shift+Tab then escapes backwards to
    // the page's own buttons, which sit before the overlay in DOM order — and
    // the focusin guard catches it and parks focus on the panel, so the naive
    // "focus is still inside" assertion would pass. Naming the exact element is
    // what separates the two.
    const dialog = await open(DESTRUCTIVE);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(confirmButton(dialog, DESTRUCTIVE));
  });

  it('pulls focus back when something outside takes it anyway', async () => {
    // Mutation: delete the focusin listener. The Tab handler cannot help here —
    // no Tab is pressed. This is the path a stray programmatic focus() takes,
    // and the recovery target is the panel rather than a button so that it
    // stays distinguishable from the wrap above.
    const dialog = await open(DESTRUCTIVE);
    const outside = screen.getByRole('button', { name: 'Outside' });

    outside.focus();

    expect(document.activeElement).not.toBe(outside);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('the two ways to back out', () => {
  it('closes on Escape and answers no', async () => {
    // Mutation: delete the document keydown effect.
    await open(DESTRUCTIVE);
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(answers).toEqual([false]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('hears Escape even when the key event never enters the React tree', async () => {
    // Mutation: move the Escape handler back onto the overlay div as a React
    // onKeyDown, which is where it used to live. A keydown dispatched on
    // document.body does not pass through the container React is listening on,
    // so the overlay version never sees it. That version only ever worked
    // because autoFocus happened to put focus inside its own subtree.
    await open(DESTRUCTIVE);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(answers).toEqual([false]));
  });

  it('closes on a press that starts on the overlay, and answers no', async () => {
    // Mutation: resolve true on cancel. Escape and the overlay have to agree,
    // because the caller cannot tell which one the user used.
    const dialog = await open(DESTRUCTIVE);
    const overlay = dialog.parentElement as HTMLElement;

    await userEvent.click(overlay);

    await waitFor(() => expect(answers).toEqual([false]));
  });

  it('survives a text selection that began inside and ended on the overlay', async () => {
    // Mutation: swap onMouseDown for onClick on the overlay. A click fires when
    // press and release land on a common ancestor, so dragging out of the panel
    // to finish selecting the body text would cancel the action mid-read.
    const dialog = await open(DESTRUCTIVE);
    const overlay = dialog.parentElement as HTMLElement;
    const title = within(dialog).getByText('Delete this card?');

    fireEvent.mouseDown(title);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);

    expect(answers).toEqual([]);
    expect(screen.queryByRole('alertdialog')).not.toBeNull();
  });
});

describe('answers reach the caller', () => {
  it('resolves true when the confirm button is pressed', async () => {
    const dialog = await open(DESTRUCTIVE);
    await userEvent.click(confirmButton(dialog, DESTRUCTIVE));

    await waitFor(() => expect(answers).toEqual([true]));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resolves false when Cancel is pressed', async () => {
    // Mutation: settle(true) in handleCancel. Nothing on screen would look
    // different; the deck would just be gone.
    const dialog = await open(DESTRUCTIVE);
    await userEvent.click(cancelButton(dialog));

    await waitFor(() => expect(answers).toEqual([false]));
  });
});

describe('what a screen reader is told', () => {
  it('calls a destructive dialog an alertdialog, and a modal one modal', async () => {
    // Mutation: role="dialog" unconditionally. alertdialog is the role for an
    // interruption that has to be answered before anything else happens, which
    // is what destroying data is; downgrading it is silent, because the box
    // still looks the same.
    const dialog = await open(DESTRUCTIVE);
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The subclass really is not resolved by the query layer, which is the
    // trap this assertion also documents.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('calls a reversible one an ordinary dialog, still modal', async () => {
    // Mutation: role="alertdialog" unconditionally — the other direction, and
    // the one a test written only against the delete path would never notice.
    const dialog = await open(PLAIN);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('names itself by its own title', async () => {
    const dialog = await open(PLAIN);
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Publish deck "x"?');
  });

  it('points aria-describedby at text that exists, or omits it', async () => {
    // Mutation: emit aria-describedby unconditionally, as the old markup did.
    // The paragraph it named was rendered only when body was set, so a
    // title-only dialog shipped a dangling IDREF — an attribute that reads as
    // "there is a description" and resolves to nothing.
    const withBody = await open(PLAIN);
    const id = withBody.getAttribute('aria-describedby');
    expect(id).not.toBeNull();
    expect(document.getElementById(id as string)).not.toBeNull();

    cleanup();

    mount({ title: 'Title only' });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const bare = screen.getByRole('dialog');
    expect(bare.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('the typed-phrase gate', () => {
  it('keeps the confirm button disabled until the phrase matches exactly', async () => {
    // Mutation: replace `phrase === confirmPhrase` with `true`. This is the
    // only case that dies; every other gated case still passes, because they
    // type the right phrase anyway.
    const dialog = await open(GATED);
    const input = within(dialog).getByRole('textbox');
    const confirmBtn = confirmButton(dialog, GATED) as HTMLButtonElement;

    expect(confirmBtn.disabled).toBe(true);

    await userEvent.type(input, 'reset');
    expect(confirmBtn.disabled).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, 'RESET');
    expect(confirmBtn.disabled).toBe(false);
  });

  it('cannot be answered yes by pressing a button that is disabled', async () => {
    const dialog = await open(GATED);
    await userEvent.click(confirmButton(dialog, GATED));

    expect(answers).toEqual([]);
    expect(screen.queryByRole('alertdialog')).not.toBeNull();
  });
});

describe('a second dialog opened while one is already up', () => {
  it('answers the caller it replaced instead of leaving it waiting', async () => {
    // Mutation: delete `pendingRef.current?.(false)` from confirm(). The first
    // caller's promise then never settles, and `await` in an async handler that
    // never returns keeps that handler's continuation alive for the life of the
    // page while the user sees nothing happen at all.
    await open(DESTRUCTIVE, PLAIN);
    await userEvent.click(screen.getByRole('button', { name: 'Open second' }));

    await waitFor(() => expect(answers).toEqual([false]));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('starts the replacement with an empty phrase box', async () => {
    // Mutation: drop `key={open.seq}` from the provider. React then reuses the
    // mounted instance, and the phrase typed into the dialog that was replaced
    // is still in the box of the one replacing it — with the confirm button
    // already enabled. The friction would be visible and entirely spent.
    await open(GATED, GATED);
    const first = screen.getByRole('alertdialog');
    await userEvent.type(within(first).getByRole('textbox'), 'RESET');
    expect((confirmButton(first, GATED) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Open second' }));

    const second = screen.getByRole('alertdialog');
    expect((within(second).getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect((confirmButton(second, GATED) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('closing hands focus back', () => {
  it('returns it to the button that opened the dialog', async () => {
    // Mutation: delete the cleanup half of the trigger-capture effect. Focus
    // then lands on <body> when the dialog unmounts, and the next Tab starts
    // from the top of the page — the classic "where did I just lose my place"
    // that window.confirm never had.
    mount(DESTRUCTIVE);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('does not pretend to restore a trigger that the action removed', async () => {
    // Not a guard test — see the file header. This records the outcome of the
    // real delete shape: confirming removes the row the trigger lived in, so
    // there is nothing to hand focus back to and focus ends on <body>. It is
    // here so that a future change which *does* address this (moving focus to a
    // heading or a status banner) has something to contradict.
    render(
      <ConfirmDialogProvider>
        <DisappearingTrigger />
      </ConfirmDialogProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Row delete' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(confirmButton(dialog, DESTRUCTIVE));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Row delete' })).toBeNull());
    expect(document.activeElement).toBe(document.body);
  });
});

describe('under StrictMode, which is how the application actually runs', () => {
  it('still opens on Cancel and still returns focus to the real trigger', async () => {
    // main.tsx wraps the tree in React.StrictMode, so in development every
    // effect here runs mount / unmount / mount. The shape that breaks under it
    // is a capture guarded by "only the first time": the second mount would
    // then read activeElement while the dialog already holds focus and record
    // the dialog's own Cancel button as the trigger — so closing would hand
    // focus to a button that no longer exists, and this assertion would find
    // <body>. It passes only because capture and restore share one effect.
    render(
      <StrictMode>
        <ConfirmDialogProvider>
          <Harness options={DESTRUCTIVE} />
        </ConfirmDialogProvider>
      </StrictMode>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(trigger);

    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(cancelButton(dialog));

    await userEvent.keyboard('{Escape}');

    // Exactly one answer: a keydown listener added twice and removed once would
    // still resolve only the first time, but the extra listener would outlive
    // the dialog and cancel the *next* one on the first Escape it saw.
    await waitFor(() => expect(answers).toEqual([false]));
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// The contract the next refactor depends on.
//
// Step three of this refactor adds four test files that mount DeckListPage bare
// — <MemoryRouter><DeckListPage /></MemoryRouter>, no application shell — and
// tests/deckListPagePolling.test.tsx, which may not be edited at all, is mounted
// the same way. If useConfirm threw the customary "must be used within a
// provider", all of them would be red before a line of that step was written.
//
// So the degradation is an assertion rather than a comment. That the real app
// never takes this path is asserted elsewhere, and much more loudly:
// tests/appConfirmWiring.test.ts and tests/confirmWiring.test.tsx.
describe('a page mounted with no provider above it', () => {
  it('falls back to the browser dialog instead of throwing', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Harness options={DESTRUCTIVE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(answers).toEqual([true]));
    expect(spy).toHaveBeenCalledTimes(1);
    // Title and body both survive the trip; the browser dialog has one string.
    expect(spy).toHaveBeenCalledWith('Delete this card?\n\nThis cannot be undone.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('carries an answer of no back to the caller', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<Harness options={DESTRUCTIVE} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(answers).toEqual([false]));
  });
});

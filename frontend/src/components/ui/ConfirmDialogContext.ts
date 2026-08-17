import { createContext, useContext } from 'react';

export interface ConfirmOptions {
  title: string;
  /** Consequence, in a sentence. Optional: a title-only dialog is legitimate. */
  body?: string;
  /**
   * Destroys something a user cannot get back. Chooses `alertdialog` over
   * `dialog`, the danger button variant, and — the part that matters most —
   * moves the opening focus onto Cancel.
   */
  destructive?: boolean;
  /**
   * Names the action on the confirm button. Not decoration: with the default
   * label a delete dialog opened from a row's "Delete" button puts a second
   * button called "Delete" on screen, which is both a screen-reader ambiguity
   * ("Delete" — which one?) and a test-selector ambiguity that a query scoped
   * to the wrong subtree resolves the wrong way, silently.
   */
  confirmLabel?: string;
  /**
   * Requires the user to type this exact string before the confirm button is
   * enabled. Reserved for the one action whose blast radius is other people's
   * data; see AdminUsersPage for the argument against spending it more widely.
   */
  confirmPhrase?: string;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * What `useConfirm()` returns when no provider is above it.
 *
 * A thrown "useConfirm must be used within a ConfirmDialogProvider" is the
 * usual shape here and it is the wrong one for this repository. Page-level
 * tests mount pages bare — `<MemoryRouter><DeckListPage /></MemoryRouter>` with
 * no application shell — on purpose, because the shell is not what they are
 * asserting. Throwing would turn every one of those files red for a reason
 * unrelated to what it tests, and the cheapest way back to green would be to
 * wrap them all, which quietly deletes the distinction between "this page works
 * on its own" and "this page works inside the app".
 *
 * So a missing provider degrades to the browser dialog: the behaviour that was
 * there before this component existed. That the real application never takes
 * this path is a separate claim, asserted separately and much more loudly — see
 * tests/appConfirmWiring.test.ts (the provider is an ancestor of <Routes/>) and
 * tests/confirmWiring.test.tsx (mounts the real <App/> with window.confirm
 * stubbed to throw, so a regression here is an exception rather than a silent
 * fallback to a dialog nobody asked for).
 *
 * confirmPhrase cannot survive the trip; window.confirm has no input. That is a
 * loss of friction, not a loss of the gate, and it only exists in a tree that
 * the wiring tests prove the app does not have.
 */
export const windowConfirmFallback: ConfirmFn = options =>
  Promise.resolve(
    window.confirm([options.title, options.body].filter(Boolean).join('\n\n')),
  );

/**
 * The confirm function for the tree above this component, or the browser's.
 *
 * Kept in this .ts module rather than beside the provider in ConfirmDialog.tsx
 * because eslint-plugin-react-refresh's only-export-components fires on a file
 * that exports both a component and something else, and this repository's lint
 * gate is "exactly one known warning". A second one would either be normalised
 * or silenced with a disable comment, and both are worse than one import.
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? windowConfirmFallback;
}

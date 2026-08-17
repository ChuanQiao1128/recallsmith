import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { ConfirmContext, type ConfirmOptions } from './ConfirmDialogContext';

/**
 * Everything a dialog of this shape can contain that takes focus.
 *
 * `:not([disabled])` on the button matters: while a confirmPhrase gate is
 * unsatisfied the confirm button is disabled, and a trap that still counted it
 * would park focus on a control that cannot be pressed.
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The dialog itself: markup, focus, and the two keyboard gestures.
 *
 * There is deliberately no `open` prop any more. Mounting is opening. The old
 * signature took `open` and did `if (!open) return null` on the first line,
 * which is a hooks trap by construction — every hook this component now needs
 * (useId, the focus effects, the phrase state) would sit after a conditional
 * return and break the rules of hooks. Changing the exported prop type is free:
 * nothing imported it.
 *
 * It also used to exist twice. ConfirmDialogProvider carried its own copy of
 * the same overlay markup, and the exported ConfirmDialog below it was never
 * referenced from anywhere. Two copies of an accessibility implementation is
 * two places to fix and two places to test, and the copy with no callers is
 * where the fixes stop being applied — which is the exact defect this step was
 * opened to remove, reproduced inside the component meant to remove it.
 */
export function ConfirmDialog({
  title,
  body,
  destructive = false,
  confirmLabel,
  confirmPhrase,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const phraseRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  const [phrase, setPhrase] = useState('');

  // useId rather than the fixed "confirm-title"/"dialog-title" strings the two
  // old copies used. Those were duplicate ids the moment both copies rendered,
  // and a duplicate id makes aria-labelledby resolve to whichever came first.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const phraseInputId = `${baseId}-phrase`;

  const gated = confirmPhrase !== undefined;
  const unlocked = !gated || phrase === confirmPhrase;

  /**
   * The least destructive control on offer.
   *
   * The previous version put `autoFocus` on the confirm button, so a delete
   * dialog opened with focus already on "Delete" and one stray Space or Enter
   * completed the deletion. That is the opposite of what a confirmation step
   * is for. Cancel is the safe default for a destructive dialog; a
   * non-destructive one may reasonably open on its confirm button, and a gated
   * one opens on the input because typing is the only thing to do there.
   */
  const initialFocusTarget = useCallback((): HTMLElement | null => {
    if (gated) return phraseRef.current;
    return destructive ? cancelRef.current : confirmRef.current;
  }, [gated, destructive]);

  // ---------------------------------------------------------------------
  // Declared FIRST on purpose. React runs effect cleanups in declaration
  // order, so this listener is detached before the effect below restores
  // focus to the trigger — otherwise the guard would see focus land outside
  // the panel and yank it back into a dialog that is being unmounted.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;
      // Focus reached something behind the overlay — a programmatic focus(),
      // or the browser's own tab order if the key handler ever stops running.
      // The panel itself takes it (tabIndex -1) rather than a button, so this
      // recovery is distinguishable from the Tab wrap below.
      panel.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Capture the trigger on open, hand focus back on close. One effect, because
  // the capture has to happen before anything inside the dialog is focused and
  // exactly once per open — under StrictMode the pair runs mount/unmount/mount
  // and this shape survives it: the cleanup returns focus to the trigger, so
  // the second mount captures the same element rather than the dialog's own
  // Cancel button.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    return () => {
      const trigger = triggerRef.current;
      // The isConnected check is documentation, not a behaviour gate, and the
      // difference was measured rather than assumed. A confirmed delete
      // unmounts the row the trigger lived in, and the guess going in was that
      // focus() on the detached node would dump focus on <body>. It does not:
      // in jsdom (and per spec) focus() on a disconnected element is a no-op —
      // removing the node had already moved activeElement, and the call changes
      // nothing either way. So this line cannot be given teeth by a test, and
      // no test here claims to; it is kept because "restore focus only to
      // something still on the page" is the intent, and the next reader should
      // not have to rediscover that calling it anyway is harmless.
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  // Opening focus. Separate from the capture above so that its dependencies —
  // which decide *which* control opens focused — cannot make the capture run
  // again.
  useEffect(() => {
    (initialFocusTarget() ?? panelRef.current)?.focus();
  }, [initialFocusTarget]);

  // Escape at the document, not on the overlay. The old handler was a React
  // onKeyDown on the overlay div, which only ever fired because autoFocus had
  // put focus inside that subtree; with focus anywhere else — and with the
  // autoFocus removed — the key never reached it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      // Escape and a click on the overlay are the same gesture: "I did not
      // mean to open this." Resolving them to different values is a trap,
      // because the caller cannot tell which one the user used.
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey ? active === first : active === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // From mousedown, and only when the press started on the overlay itself.
    // A click handler would also fire when a text selection that began inside
    // the dialog happened to end out here, cancelling an action the user was
    // in the middle of reading.
    if (event.target !== event.currentTarget) return;
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"
      onMouseDown={handleOverlayMouseDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg max-w-sm w-full p-6 focus:outline-none"
        onKeyDown={handlePanelKeyDown}
        // alertdialog is for an interruption that needs an answer before the
        // user can go on, which is what destroying something is; a publish that
        // can be run again is an ordinary dialog. Note for anyone writing a
        // test against this: getByRole('dialog') does NOT match alertdialog —
        // dom-testing-library does not resolve ARIA subclasses — and the
        // natural "fix" of making everything role="dialog" throws the
        // distinction away.
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        // Only when there is something to point at. The old markup emitted
        // aria-describedby unconditionally while the paragraph it named was
        // rendered only when `body` was set, leaving a dangling IDREF.
        aria-describedby={body ? bodyId : undefined}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h2>
        {body && (
          <p
            id={bodyId}
            className="mt-2 text-sm text-slate-600 dark:text-slate-400 whitespace-pre-line"
          >
            {body}
          </p>
        )}

        {gated && (
          <div className="mt-4">
            <label
              htmlFor={phraseInputId}
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Type <span className="font-mono font-semibold">{confirmPhrase}</span> to continue
            </label>
            <input
              id={phraseInputId}
              ref={phraseRef}
              type="text"
              autoComplete="off"
              value={phrase}
              onChange={event => setPhrase(event.target.value)}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <Button ref={cancelRef} variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            size="md"
            disabled={!unlocked}
            onClick={onConfirm}
          >
            {confirmLabel ?? (destructive ? 'Delete' : 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface ConfirmDialogProviderProps {
  children: ReactNode;
}

interface OpenDialog {
  /** Bumped on every open; used as the dialog's key. See below. */
  seq: number;
  options: ConfirmOptions;
}

/**
 * Promise plumbing, and nothing else. All markup and focus behaviour lives in
 * ConfirmDialog above, so there is one implementation to fix and one to test.
 */
export function ConfirmDialogProvider({ children }: ConfirmDialogProviderProps) {
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const pendingRef = useRef<((value: boolean) => void) | null>(null);
  const seqRef = useRef(0);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      // A second confirm() while one is already open used to overwrite the
      // stored resolve, and the first caller's promise then never settled. An
      // `await` that never returns is not a no-op: the async handler waiting on
      // it keeps its continuation, its locals and whatever it captured, for the
      // lifetime of the page, and the user sees an action that neither happened
      // nor reported a failure. Answering the superseded caller "no" is the
      // only outcome that is both definite and safe.
      pendingRef.current?.(false);
      pendingRef.current = resolve;
      seqRef.current += 1;
      setOpen({ seq: seqRef.current, options });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setOpen(null);
    resolve?.(value);
  }, []);

  const handleConfirm = useCallback(() => settle(true), [settle]);
  const handleCancel = useCallback(() => settle(false), [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {open && (
        /* The key is what resets the dialog on every open. Without it, a
           supersede reuses the mounted instance, and a phrase typed into the
           dialog that was replaced is still sitting in the input of the one
           that replaced it — with the confirm button already enabled. The
           friction would be visibly present and completely spent. */
        <ConfirmDialog
          key={open.seq}
          {...open.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  );
}

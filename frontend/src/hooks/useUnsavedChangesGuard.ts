// src/hooks/useUnsavedChangesGuard.ts
//
// The unsaved-changes guard for the card and deck editors. It stops a stray
// Back, Cancel or nav click from throwing away an in-progress edit without a
// word, and warns the browser before a reload or tab close does the same.
//
// It needs the DATA ROUTER that src/main.tsx mounts
// (createBrowserRouter/RouterProvider): useBlocker only works under a data
// router, and a page test that exercises this hook must mount under
// createMemoryRouter (see tests/support/routerProbe.tsx), NOT a plain
// <MemoryRouter> — the latter throws "useBlocker must be used within a data
// router".

import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useConfirm } from '../components/ui/ConfirmDialogContext';

/**
 * Guards a page against discarding unsaved edits.
 *
 * @param dirty whether the page holds edits that would be lost on navigation.
 * @returns `allowNextNavigation`, a stable callback a page calls immediately
 *   before the navigation that follows a successful save (or a discard the page
 *   already confirmed itself), so that navigation does not trip the guard. It
 *   lets exactly one navigation through.
 */
export function useUnsavedChangesGuard(dirty: boolean): { allowNextNavigation: () => void } {
  const confirm = useConfirm();

  // Set true for the one navigation that follows a successful save; read inside
  // the blocker so that save is not treated as a discard. It is one-shot: the
  // next navigation attempt clears it, moving or not, so a page that stays mounted after
  // the save (the review queue) is guarded again for the next edit.
  const allowRef = useRef(false);

  // beforeunload only while dirty, so a reload or tab close gets the browser's
  // own "Leave site?" prompt. Nothing is registered while clean.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const moves =
      currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search;
    // The allowance is spent by the very next navigation attempt, whether or
    // not it moves: a setSearchParams that lands on the same URL must not
    // leave it armed for a later, unrelated navigation (frontend-console-19).
    const allow = allowRef.current;
    allowRef.current = false;
    if (!moves || allow) return false;
    return dirty;
  });

  // When a navigation is blocked, ask through the console's own confirm dialog.
  // Discard -> proceed, keep -> reset. The `active` flag drops a late answer if
  // the effect was cleaned up before the user chose.
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void confirm({
      title: 'Discard unsaved changes?',
      body: 'Your edits on this page have not been saved.',
      destructive: true,
      confirmLabel: 'Discard changes',
    }).then(discard => {
      if (!active) return;
      if (discard) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, confirm]);

  const allowNextNavigation = useCallback(() => {
    allowRef.current = true;
  }, []);

  return { allowNextNavigation };
}

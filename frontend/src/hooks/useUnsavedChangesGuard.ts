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
 *   before the navigation that follows a successful save, so that save does not
 *   trip the guard.
 */
export function useUnsavedChangesGuard(dirty: boolean): { allowNextNavigation: () => void } {
  const confirm = useConfirm();

  // Set true for the one navigation that follows a successful save; read inside
  // the blocker so that save is not treated as a discard.
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

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowRef.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

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

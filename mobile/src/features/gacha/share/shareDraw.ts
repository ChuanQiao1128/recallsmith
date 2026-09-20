import type React from 'react';

// C4 — capture the DrawResult card and hand the PNG to the sharing package.
//
// The view-shot and sharing packages ship in the binary (B01) but are optional
// at runtime and absent from the test environment, so each is loaded through a
// guarded dynamic import() inside a function — never a static `import … from`
// and never a CommonJS require. Under this repo's vitest a dynamic import() is
// intercepted by the test's module factory, whereas a CommonJS require would
// skip the mock and reach Node's own resolver (see B00-contracts §2.15).
//
// The sharing package cannot report whether the user dismissed the share sheet,
// so a 'cancelled' status is only ever the re-entrant tap guarded by `inFlight`.

export type ShareDrawResult = { status: 'shared' | 'unavailable' | 'cancelled' | 'failed' };
export const SHARE_DRAW_TESTID = 'draw-result-share-button';

type ViewShotModule = { captureRef: (view: unknown, options?: Record<string, unknown>) => Promise<string> };
type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, options?: Record<string, unknown>) => Promise<unknown>;
};

async function loadViewShot(): Promise<ViewShotModule | null> {
  try {
    const mod = (await import('react-native-view-shot')) as
      | { captureRef?: ViewShotModule['captureRef']; default?: { captureRef?: ViewShotModule['captureRef'] } }
      | undefined;
    const captureRef = mod?.captureRef ?? mod?.default?.captureRef;
    return typeof captureRef === 'function' ? { captureRef } : null;
  } catch {
    return null;
  }
}

async function loadSharing(): Promise<SharingModule | null> {
  try {
    const mod = (await import('expo-sharing')) as
      | (Partial<SharingModule> & { default?: Partial<SharingModule> })
      | undefined;
    const isAvailableAsync = mod?.isAvailableAsync ?? mod?.default?.isAvailableAsync;
    const shareAsync = mod?.shareAsync ?? mod?.default?.shareAsync;
    return typeof isAvailableAsync === 'function' && typeof shareAsync === 'function'
      ? { isAvailableAsync, shareAsync }
      : null;
  } catch {
    return null;
  }
}

// One share at a time: a second tap while the sheet is open is the cancelled one.
let inFlight = false;

/** Never throws — resolves to a status on every path. */
export async function shareDrawImage(
  viewRef: React.RefObject<unknown>,
  opts: { slug: string; deckTitle?: string },
): Promise<ShareDrawResult> {
  if (inFlight) return { status: 'cancelled' };
  inFlight = true;
  try {
    if (!viewRef.current) return { status: 'unavailable' };
    const [viewShot, sharing] = await Promise.all([loadViewShot(), loadSharing()]);
    if (!viewShot || !sharing) return { status: 'unavailable' };
    if (!(await sharing.isAvailableAsync())) return { status: 'unavailable' };
    const uri = await viewShot.captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
    if (typeof uri !== 'string' || uri.length === 0) return { status: 'failed' };
    await sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: `${opts.deckTitle?.trim() || opts.slug} pull`,
    });
    return { status: 'shared' };
  } catch {
    return { status: 'failed' };
  } finally {
    inFlight = false;
  }
}

// mobile/src/features/gacha/session/useScrollToTopOnChange.ts
// The session keeps one ScrollView mounted and swaps the card in place, so a
// tall next card would open scrolled to the previous card's offset (MCORE-03).
// This hook resets the surface to the top whenever the card (the reset key)
// changes — but never on the first render, so the initial card is left where the
// user opened it.

import { useEffect, useRef } from 'react';

type ScrollableRef = {
  current: { scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void } | null;
};

export function useScrollToTopOnChange(ref: ScrollableRef, resetKey: string | null): void {
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    ref.current?.scrollTo?.({ y: 0, animated: false });
  }, [resetKey]);
}

export default useScrollToTopOnChange;

// src/hooks/useDocumentTitle.ts
//
// Tiny hook to set document.title per page so each browser tab is identifiable
// instead of every tab saying "Vite + React + TS". Restores the previous title
// on unmount so SSR / fast navigations don't leave stale chrome.
//
// Usage:
//   useDocumentTitle('Decks');
//   useDocumentTitle(`${deck.title} · Cards`);
import { useEffect } from 'react';

const SUFFIX = ' · RecallSmith Console';

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title.endsWith(SUFFIX) ? title : `${title}${SUFFIX}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

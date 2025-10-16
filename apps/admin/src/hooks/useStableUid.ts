import { useMemo } from 'react';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function useStableUid(deckSlug: string | undefined, frontMd: string, version = 'v1') {
  return useMemo(() => {
    const base = slugify(frontMd.split(/\s+/).slice(0, 6).join(' ')) || 'item';
    const head = deckSlug ? `${slugify(deckSlug)}.${base}` : base;
    return `${head}.${version}`;
  }, [deckSlug, frontMd, version]);
}
// Short display titles for the narrow surfaces (the caption and dots under
// Home's cover carousel, the Draw 60pt neighbour rail, the session header)
// where the manifest title truncates to "AWS As…" / "Claude…". The manifest
// title stays the canonical name everywhere there is room for it; this is a
// display alias, derived in one place so the three surfaces never disagree
// about what a pack is called.
//
// Keyed by the exact manifest slug on purpose: the palette/cover canonicaliser
// in theme/packArt.ts folds "aws-*" and "claude-*" families together, which is
// right for a colour and wrong for a name (a second Claude deck would not be
// "Claude CCDV-F"). Unknown slugs fall back to the title they came with.
const SHORT_TITLES: Readonly<Record<string, string>> = {
  'aws-saa-c03': 'AWS SAA-C03',
  'aws-saa-fundamentals': 'AWS Basics',
  'claude-ccdv-f': 'Claude CCDV-F',
  'csharp-basics': 'C# / .NET',
};

export function deckShortTitle(slug: string | null | undefined, title: string | null | undefined): string {
  const safeSlug = String(slug ?? '').trim().toLowerCase();
  const fallback = String(title ?? '').trim() || safeSlug;
  return SHORT_TITLES[safeSlug] ?? fallback;
}

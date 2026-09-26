// Shared user-visible copy for the collection surfaces (draw result pill and
// eyebrow, Library header). One module so the "Collection" wording stays
// consistent and never drifts back toward a trademarked term.
export const COLLECTION_COPY = {
  resultPill: (count: number) => `Collection +${count}`,
  resultEyebrow: (count: number) => `+${count} TO YOUR COLLECTION`,
  libraryEyebrow: 'COLLECTION',
  libraryEmptyEyebrow: 'YOUR COLLECTION IS EMPTY',
} as const;

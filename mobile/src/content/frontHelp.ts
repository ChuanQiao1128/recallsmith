export interface FrontHelpEntry { term: string; definition: string }

/** null/undefined and [] mean no help; undefined from this parser means invalid. */
export function parseFrontHelp(raw: unknown): FrontHelpEntry[] | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > 2) return undefined;
  const result: FrontHelpEntry[] = [];
  const terms = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    if (Object.keys(entry).length !== 2 || !Object.keys(entry).every((key) => key === 'term' || key === 'definition')) return undefined;
    if (typeof entry.term !== 'string' || typeof entry.definition !== 'string') return undefined;
    const term = entry.term.trim();
    const definition = entry.definition.trim();
    if (!term || term.length > 80 || !definition || definition.length > 240 || terms.has(term.toLowerCase())) return undefined;
    terms.add(term.toLowerCase());
    result.push({ term, definition });
  }
  return result.length ? result : null;
}

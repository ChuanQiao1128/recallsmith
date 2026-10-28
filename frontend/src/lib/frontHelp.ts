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

/** Keep JSON duplicate keys visible: JSON.parse alone silently overwrites them. */
export function parseFrontHelpJson(text: string): FrontHelpEntry[] {
  const raw: unknown = JSON.parse(text);
  const help = parseFrontHelp(raw);
  if (!Array.isArray(raw) || help === undefined) throw new Error('HELP must be a JSON array of up to two unique {term, definition} entries (term 1..80, definition 1..240 characters).');
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/g) ?? [];
  const keys = tokens.filter((token, index) => token.startsWith('"') && tokens[index + 1] === ':');
  if (keys.length !== raw.length * 2) throw new Error('HELP entries must use unique term and definition keys.');
  return help ?? [];
}

export function normalizeFrontHelpForCompare(raw: unknown): string {
  return JSON.stringify(parseFrontHelp(raw) ?? null);
}

// mobile/src/features/gacha/mcq/stemAsk.ts
// Split an MCQ stem into the scenario lead-in and the actual ask, so the options
// stage can clamp only the lead-in while the question sentence (and any
// MOST/LEAST qualifier) always stays fully visible (MCORE-02). Purely textual —
// no measurement, no react, no layout. See content/decks/FORMAT.md §1.5.

/**
 * Split a stem into `{ leadIn, ask }`.
 *
 * - Sentence starts are index `0` plus every index right after a sentence-ending
 *   `.`/`!`/`?` followed by whitespace and an opening capital or quote/paren.
 * - The ask starts at the last sentence start. A trailing `(Choose two.)`-style
 *   directive is not itself the question, so when the last sentence is only that
 *   suffix the ask is pulled back to the sentence before it.
 * - When a non-empty qualifier occurs before the ask, the ask is pulled back to
 *   the sentence that holds it, so the constraint reads with its question.
 * - A one-sentence stem returns `leadIn: ''`, `ask: <stem>`.
 */
export function splitStemForOptions(
  stem: string,
  qualifier: string | null,
): { leadIn: string; ask: string } {
  const starts: number[] = [0];
  const re = /[.!?]\s+(?=[A-Z("'])/g;
  let match: RegExpExecArray | null = re.exec(stem);
  while (match !== null) {
    starts.push(match.index + match[0].length);
    match = re.exec(stem);
  }

  let askStart = starts[starts.length - 1];

  // A trailing "(Choose two.)" is a directive, not the question it belongs to.
  if (/^\(choose \w+\.?\)$/i.test(stem.slice(askStart).trim()) && starts.length > 1) {
    askStart = starts[starts.length - 2];
  }

  const trimmedQualifier = qualifier === null ? '' : qualifier.trim();
  if (trimmedQualifier.length > 0) {
    const q = stem.toLowerCase().indexOf(trimmedQualifier.toLowerCase());
    if (q >= 0 && q < askStart) {
      let pulled = 0;
      for (const start of starts) {
        if (start <= q) pulled = start;
      }
      askStart = pulled;
    }
  }

  return {
    leadIn: stem.slice(0, askStart).trim(),
    ask: stem.slice(askStart).trim(),
  };
}

export default splitStemForOptions;

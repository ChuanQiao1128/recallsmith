// The key line of a card answer (2026-10-14 learning flow, B3).
//
// The aws-saa-fundamentals deck writes every answer as three lines, in English
// with a built-in Chinese translation (2026-10-18 rewrite):
//
//   Answer: <the one-line conclusion>      答：<the one-line conclusion>
//   Because: <why>                         因为：<why>
//   Exam: <how the exam asks it>           考法：<how the exam asks it>
//
// The first line is what the learner judges themselves against; the other two
// explain it. splitKeyLine separates that line so the answer sections can
// highlight it and the rating hint can point at it.
//
// Rules (pure, no React):
//   • A split is returned only when the trimmed explanation's first line starts
//     with 答： / 答: or with Answer: / Answer： (case-sensitive, colon right after
//     the word). Anything else — every other deck's single-paragraph answer
//     included — returns null, so those cards render exactly as before.
//   • keyLine is that first line, trimmed, prefix kept (the learner sees 答： or Answer:).
//   • rest is every later line, joined with \n and trimmed; '' for a one-line
//     answer.

export type AnswerKeyLine = { keyLine: string; rest: string };

const KEY_LINE_PREFIX = /^(?:答|Answer)[：:]/;

export function splitKeyLine(explanation: string | null | undefined): AnswerKeyLine | null {
  if (typeof explanation !== 'string') return null;
  const trimmed = explanation.trim();
  if (!KEY_LINE_PREFIX.test(trimmed)) return null;
  const [first, ...later] = trimmed.split(/\r?\n/);
  return { keyLine: first.trim(), rest: later.join('\n').trim() };
}

/** True when the card's answer opens with a key line (the hint then points at it). */
export function hasKeyLine(explanation: string | null | undefined): boolean {
  return splitKeyLine(explanation) !== null;
}

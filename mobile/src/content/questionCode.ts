// Code inside a card question (R22 follow-up, Y01).
//
// The rebuilt C#/.NET deck puts the code a learner must read to answer INSIDE
// the question text, as one fenced block:
//
//   What does this print?
//   ```csharp
//   var xs = new[] { 1, 2, 3 };
//       Console.WriteLine(xs.Length);
//   ```
//
// Every surface used to print card.Question as plain text, so the learner saw
// raw backticks. splitQuestionCode separates the prose from the code so the
// full-question surfaces can render the code with CodeBlock and the title/row
// surfaces can show the prose alone.
//
// Rules (pure, no React):
//   • A well-formed fence is an opening line ```lang (a language word is
//     required) and a later closing line ``` (fence lines may carry
//     surrounding spaces). Anything else — no fence, no language word, no
//     closing line, an empty body — returns the question unchanged with
//     code null, so every existing AWS / Claude card renders exactly as today.
//   • Only the first fence is extracted; text after it is kept as written.
//   • Code lines keep their indentation; leading/trailing blank lines inside
//     the fence are dropped.
//   • text = the question with the fenced block removed: the prose before and
//     after it joined by one blank line, outer whitespace trimmed and runs of
//     blank lines collapsed.
//   • A fence-only question (no prose around the fence) gets the neutral prose
//     FENCE_ONLY_QUESTION_TEXT, so no title, row or spoken label is ever empty
//     (F01, r22yx).

export type QuestionCode = { language: string; source: string };

export type SplitQuestion = { text: string; code: QuestionCode | null };

const OPEN_FENCE = /^\s*```([A-Za-z0-9_+#.-]+)\s*$/;
const CLOSE_FENCE = /^\s*```\s*$/;

export const QUESTION_CODE_A11Y_SUFFIX = ', code sample follows';

export const FENCE_ONLY_QUESTION_TEXT = 'What does this code do?';

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

export function splitQuestionCode(question: string): SplitQuestion {
  const unchanged: SplitQuestion = { text: question, code: null };
  if (typeof question !== 'string' || !question.includes('```')) return unchanged;

  const lines = question.split(/\r?\n/);
  const open = lines.findIndex((line) => OPEN_FENCE.test(line));
  if (open < 0) return unchanged;
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (CLOSE_FENCE.test(lines[i])) {
      close = i;
      break;
    }
  }
  if (close < 0) return unchanged;

  const body = lines.slice(open + 1, close);
  let start = 0;
  let end = body.length;
  while (start < end && isBlank(body[start])) start++;
  while (end > start && isBlank(body[end - 1])) end--;
  if (start === end) return unchanged;

  const language = (OPEN_FENCE.exec(lines[open]) as RegExpExecArray)[1];
  const source = body.slice(start, end).join('\n');
  const before = tidy(lines.slice(0, open).join('\n'));
  const after = tidy(lines.slice(close + 1).join('\n'));
  const text = [before, after].filter((part) => part.length > 0).join('\n\n') || FENCE_ONLY_QUESTION_TEXT;

  return { text, code: { language, source } };
}

/** Prose only — what title and row surfaces print (never backticks from a well-formed fence). */
export function questionText(question: string): string {
  return splitQuestionCode(question).text;
}

/** Spoken label for a full-question surface: the prose, plus a cue when a code sample follows. */
export function questionA11yLabel(split: SplitQuestion): string {
  return split.code === null ? split.text : `${split.text}${QUESTION_CODE_A11Y_SUFFIX}`;
}

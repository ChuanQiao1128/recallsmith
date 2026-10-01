// Inline code spans in card text (R22 follow-up, Z01).
//
// The rebuilt .NET deck writes code identifiers as markdown inline code spans —
// `List<int>`, `Add(4)`, `ConfigureAwait(false)` — in questions, explanations,
// REAL USAGE, MCQ options and WHY texts. Every surface used to print them as raw
// text with visible backticks. splitInlineCode separates the spans so the
// full-text surfaces can render them in monospace (InlineCodeText), and
// stripInlineCode drops the backticks for title, row and spoken-label surfaces.
//
// Rules (pure, no React):
//   • A span is one backtick, at least one non-backtick character, and a closing
//     single backtick on the same line.
//   • A run of two or more backticks (a ``` fence, an empty span ``) is never a
//     span delimiter: it stays literal text, so fenced blocks are left to
//     splitQuestionCode and `` renders as written.
//   • An unmatched backtick stays literal text.
//   • Text without a well-formed span comes back as a single text segment (or
//     no segment for ''), so every AWS card renders exactly as today.

export type InlineSegment = { kind: 'text' | 'code'; value: string };

const TICK = '`';

// Index of the closing backtick of a span opened at `open`, or -1: the next
// backtick on the same line, with at least one character before it and not
// followed by another backtick (a run is never a closing delimiter).
function closingTick(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') return -1;
    if (ch === TICK) return i > open + 1 && text[i + 1] !== TICK ? i : -1;
  }
  return -1;
}

export function splitInlineCode(text: string): InlineSegment[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  if (!text.includes(TICK)) return [{ kind: 'text', value: text }];

  const segments: InlineSegment[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== TICK) {
      plain += text[i];
      i++;
      continue;
    }
    let run = 1;
    while (text[i + run] === TICK) run++;
    const close = run === 1 ? closingTick(text, i) : -1;
    if (close < 0) {
      plain += text.slice(i, i + run);
      i += run;
      continue;
    }
    if (plain.length > 0) segments.push({ kind: 'text', value: plain });
    plain = '';
    segments.push({ kind: 'code', value: text.slice(i + 1, close) });
    i = close + 1;
  }
  if (plain.length > 0) segments.push({ kind: 'text', value: plain });
  return segments;
}

export function hasInlineCode(text: string): boolean {
  return splitInlineCode(text).some((segment) => segment.kind === 'code');
}

/** The text with the backticks of well-formed spans removed — for titles, rows and labels. */
export function stripInlineCode(text: string): string {
  if (typeof text !== 'string' || !text.includes(TICK)) return text;
  return splitInlineCode(text)
    .map((segment) => segment.value)
    .join('');
}

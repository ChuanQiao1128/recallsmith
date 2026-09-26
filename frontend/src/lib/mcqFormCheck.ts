// src/lib/mcqFormCheck.ts
//
// The card form's read of the MCQ rules (CFE-24). Pure, no React and no DOM: it
// runs validateMcq over what the author is typing (question, explanation,
// difficulty) plus the card's stored blob, and splits the result the way the
// form needs it — into what the SERVER would refuse (blocking) and what only the
// importer refuses (advisory).
//
// The server re-canonicalises the stored mcq against the edited stem on every
// PUT (src_C/Vpc/Authoring/Cards.cs), so a stem that drops its qualifier, an
// out-of-range difficulty, an empty explanation and the option-shape codes all
// become a save that fails after submit with a server code. Surfacing the same
// verdict before submit is the whole point of this module.
//
// It imports only from ./mcqRules (validateMcq and the code type) and the blob
// type — deliberately NOT cardRules, whose consumer table a wiring test pins.

import { validateMcq, type McqIssueCode } from './mcqRules';
import type { McqBlob } from '../types/mcq';

export interface McqFormIssue {
  code: string;
  message: string;
}

/**
 * The two validateMcq codes the server does NOT enforce: they are importer-only
 * rules (a letter reference in a WHY/explanation, and forbidden option text like
 * "all of the above"). A save carrying either still succeeds at the API, so the
 * form shows them as advice rather than refusing the submit.
 */
export const ADVISORY_MCQ_CODES: readonly McqIssueCode[] = [
  'MCQ_LETTER_REFERENCE',
  'MCQ_FORBIDDEN_OPTION_TEXT',
];

/**
 * Runs the MCQ rules over the form's live values and the stored blob, and splits
 * the issues into blocking (what a PUT would refuse) and advisory (importer-only).
 *
 * An empty explanation is checked first and lands in `blocking`, mirroring the
 * server's MCQ_EXPLANATION_REQUIRED, which validateMcq itself does not emit.
 */
export function checkMcqForm(
  values: { question: string; explanation: string; difficulty: number },
  mcq: McqBlob,
): { blocking: McqFormIssue[]; advisory: McqFormIssue[] } {
  const blocking: McqFormIssue[] = [];
  const advisory: McqFormIssue[] = [];

  if (values.explanation.trim() === '') {
    blocking.push({ code: 'MCQ_EXPLANATION_REQUIRED', message: 'An MCQ card needs an explanation.' });
  }

  const issues = validateMcq({
    question: values.question,
    explanation: values.explanation,
    difficulty: values.difficulty,
    mcq,
  });

  for (const issue of issues) {
    if (ADVISORY_MCQ_CODES.includes(issue.code)) {
      advisory.push({ code: issue.code, message: issue.message });
    } else {
      blocking.push({ code: issue.code, message: issue.message });
    }
  }

  return { blocking, advisory };
}

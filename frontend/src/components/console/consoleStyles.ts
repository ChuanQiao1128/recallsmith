// src/components/console/consoleStyles.ts
//
// The class strings the HITL pages (Review queue, AI QA, Automation ledger,
// Webhooks) share. They used to be redefined on each page and had drifted: the
// primary action was outlined on two pages and filled on the other two, and
// the H1 differed. One module keeps the console's look the same everywhere.
//
// Buttons are not here: every action renders ui/Button (primary, or outline at
// size xs), which carries the console's focus-visible ring. Page-level errors
// render ui/Callout tone="danger" role="alert". What stays here is what has no
// primitive yet: headings, inputs, cards, table cells and the one-line error
// under a field.

/** The page heading every console page uses (matches CardListPage). */
export const H1_CLASS = 'text-xl font-semibold text-slate-800';
export const H2_CLASS = 'text-sm font-semibold text-slate-900';

/** The same indigo focus ring CardForm and CardListPage inputs use. */
const INPUT_FOCUS = 'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export const INPUT_CLASS = `w-full rounded-md border border-slate-300 px-3 py-2 text-sm ${INPUT_FOCUS}`;
/** An input whose value failed validation (pair it with aria-invalid). */
export const INPUT_INVALID_CLASS =
  'w-full rounded-md border border-red-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500';
export const LABEL_CLASS = 'block text-xs font-medium text-slate-700 mb-1';

/** The one-line message under a field that failed validation (pair it with aria-describedby). */
export const FIELD_ERROR_CLASS = 'text-sm text-red-800';

export const CARD_CLASS = 'bg-white border border-slate-200 rounded-lg shadow-sm p-4';

export const TH_CLASS = 'px-4 py-2 text-left font-semibold text-slate-600';
export const TD_CLASS = 'px-4 py-2';

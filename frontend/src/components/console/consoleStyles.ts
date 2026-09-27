// src/components/console/consoleStyles.ts
//
// The class strings the HITL pages (Review queue, AI QA, Automation ledger,
// Webhooks) share. They used to be redefined on each page and had drifted: the
// primary action was outlined on two pages and filled on the other two, and
// the H1 differed. One module keeps the console's look the same everywhere.

/** The page heading every console page uses (matches CardListPage). */
export const H1_CLASS = 'text-xl font-semibold text-slate-800';
export const H2_CLASS = 'text-sm font-semibold text-slate-900';

export const BUTTON_CLASS =
  'text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed';
/** The one primary action style: filled indigo. */
export const PRIMARY_BUTTON_CLASS =
  'text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed';

export const INPUT_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
/** An input whose value failed validation (pair it with aria-invalid). */
export const INPUT_INVALID_CLASS = 'w-full rounded-md border border-red-400 px-3 py-2 text-sm';
export const LABEL_CLASS = 'block text-xs font-medium text-slate-700 mb-1';

export const CARD_CLASS = 'bg-white border border-slate-200 rounded-lg shadow-sm p-4';

export const TH_CLASS = 'px-4 py-2 text-left font-semibold text-slate-600';
export const TD_CLASS = 'px-4 py-2';

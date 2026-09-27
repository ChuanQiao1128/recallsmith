// Renders prompts/queue-item.md for one claimed item (A00 §11.5). One pass over the
// template: every value is flattened to one line and capped, and a `{{…}}` inside a
// value is never expanded.

import { readFileSync } from 'node:fs';
import type { ClaimedItem } from './api';

export const PROMPT_TEMPLATE_URL = new URL('../prompts/queue-item.md', import.meta.url);

export function readPromptTemplate(): string {
  return readFileSync(PROMPT_TEMPLATE_URL, 'utf8');
}

export type PromptValues = Pick<ClaimedItem, 'url' | 'deckSlug' | 'kind' | 'title' | 'sectionHint' | 'maxCards' | 'note'>;

const CAPS: Record<string, number> = { url: 2048, title: 300, sectionHint: 300, note: 500 };

function value(raw: unknown, cap: number | undefined): string {
  if (raw === null || raw === undefined) return '(none)';
  const text = typeof raw === 'number' ? String(Math.trunc(raw)) : String(raw);
  const flat = text.replace(/[\r\n]/g, ' ');
  return cap === undefined ? flat : flat.slice(0, cap);
}

export function renderPrompt(template: string, item: PromptValues): string {
  const values: Record<string, string> = {};
  for (const key of ['url', 'deckSlug', 'kind', 'title', 'sectionHint', 'maxCards', 'note'] as const) {
    values[key] = value(item[key], CAPS[key]);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

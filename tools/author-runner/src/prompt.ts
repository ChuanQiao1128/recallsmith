// Renders prompts/queue-item.md for one claimed item (A00 §11.5). One pass over the
// template: every value is flattened to one line and capped, and a `{{…}}` inside a
// value is never expanded. The feed-derived title, section hint and note go only into
// the fenced <queue_item_metadata> block, as JSON the fence cannot be closed from (ai-agent-8).

import { readFileSync } from 'node:fs';
import type { ClaimedItem } from './api';

export const PROMPT_TEMPLATE_URL = new URL('../prompts/queue-item.md', import.meta.url);

export function readPromptTemplate(): string {
  return readFileSync(PROMPT_TEMPLATE_URL, 'utf8');
}

export type PromptValues = Pick<ClaimedItem, 'url' | 'deckSlug' | 'kind' | 'title' | 'sectionHint' | 'maxCards' | 'note'> & {
  /** The pinned skill version (ai-agent-3); `(none)` when not given. */
  skillVersion?: string;
};

const CAPS: Record<string, number> = { url: 2048, title: 300, sectionHint: 300, note: 500 };

function flat(raw: unknown, cap: number | undefined): string {
  const text = typeof raw === 'number' ? String(Math.trunc(raw)) : String(raw);
  const oneLine = text.replace(/[\r\n]/g, ' ');
  return cap === undefined ? oneLine : oneLine.slice(0, cap);
}

function value(raw: unknown, cap: number | undefined): string {
  return raw === null || raw === undefined ? '(none)' : flat(raw, cap);
}

/** The untrusted metadata as one line of JSON; `<`, `>` and `&` are escaped so no value can close the fence. */
export function metadataJson(item: Pick<PromptValues, 'title' | 'sectionHint' | 'note'>): string {
  const field = (key: 'title' | 'sectionHint' | 'note'): string | null => {
    const raw = item[key];
    return raw === null || raw === undefined ? null : flat(raw, CAPS[key]);
  };
  const json = JSON.stringify({ title: field('title'), sectionHint: field('sectionHint'), note: field('note') });
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function renderPrompt(template: string, item: PromptValues): string {
  const values: Record<string, string> = {};
  for (const key of ['url', 'deckSlug', 'kind', 'maxCards', 'skillVersion'] as const) {
    values[key] = value(item[key], CAPS[key]);
  }
  values.metadata = metadataJson(item);
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

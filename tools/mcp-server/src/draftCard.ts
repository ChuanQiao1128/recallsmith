// DraftCard (contract §8.1) as a strict zod object. The schema checks shape only;
// content rules (uid pattern, blank fields, limits, citation) belong to the lint,
// which is why `source` is optional here: a missing source must come back as the
// lint's SOURCE_REQUIRED, not as an input-validation error.

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const mcqOptionSchema = z.strictObject({
  key: z.string(),
  text: z.string(),
  why: z.string().nullable(),
  correct: z.boolean(),
});

export const mcqSchema = z.strictObject({
  v: z.literal(1),
  qualifier: z.string().nullable(),
  shuffle: z.boolean(),
  options: z.array(mcqOptionSchema),
});

export const draftSourceSchema = z.strictObject({
  url: z.string(),
  quote: z.string(),
});

export const draftCardSchema = z.strictObject({
  stableUid: z.string(),
  difficulty: z.number().int().min(0).max(4),
  topic: z.string().nullable().optional(),
  question: z.string(),
  explanation: z.string(),
  codeSnippet: z.string().nullable().optional(),
  codeLanguage: z.string().nullable().optional(),
  realWorldUsage: z.string().nullable().optional(),
  mcq: mcqSchema.nullable().optional(),
  source: draftSourceSchema.optional(),
});

export type DraftCard = z.infer<typeof draftCardSchema>;

/** Keys sorted recursively, `undefined` values dropped, `null` kept, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(',')}}`;
}

/** Lowercase hex SHA-256 of the canonical card JSON; the server's idempotency key per (deck, draft). */
export function clientDraftKey(card: DraftCard): string {
  return createHash('sha256').update(canonicalJson(card), 'utf8').digest('hex');
}

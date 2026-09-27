// Citation grounding for submit_draft (audit finding ai-agent-7). The server remembers
// every document read_source returned in this process, keyed by its citable url, and
// submit_draft accepts a draft only when its source.url is such a document and its
// source.quote occurs (whitespace-normalised) in one of that document's chunks.

import { normaliseWhitespace } from './lint';

export interface IngestedChunk {
  id: string;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface IngestedSource {
  sourceId: string;
  url: string;
  chunks: IngestedChunk[];
}

/** Where a grounded quote was found; returned with the submit result for the reviewer. */
export interface GroundingLocation {
  stableUid: string;
  clientDraftKey: string;
  sourceId: string;
  url: string;
  chunkId: string;
  chunkCharStart: number;
  chunkCharEnd: number;
}

export type GroundingCheck =
  | { ok: true; chunk: IngestedChunk }
  | { ok: false; code: 'SOURCE_QUOTE_NOT_IN_CHUNK' };

function isChunk(value: unknown): value is IngestedChunk {
  if (typeof value !== 'object' || value === null) return false;
  const chunk = value as Record<string, unknown>;
  return (
    typeof chunk.id === 'string' &&
    typeof chunk.text === 'string' &&
    typeof chunk.charStart === 'number' &&
    typeof chunk.charEnd === 'number'
  );
}

/** The documents read_source returned in this process, newest last, at most `limit` of them. */
export class SourceStore {
  private readonly byUrl = new Map<string, IngestedSource>();

  constructor(private readonly limit = 50) {}

  /** Records one read_source result; a result without a citable url (a local file without canonicalUrl) is skipped. */
  remember(doc: unknown): IngestedSource | undefined {
    if (typeof doc !== 'object' || doc === null) return undefined;
    const record = doc as Record<string, unknown>;
    if (typeof record.url !== 'string' || record.url.trim() === '' || typeof record.sourceId !== 'string') return undefined;
    if (!Array.isArray(record.chunks) || !record.chunks.every(isChunk)) return undefined;
    const source: IngestedSource = {
      sourceId: record.sourceId,
      url: record.url.trim(),
      chunks: record.chunks.map(({ id, text, charStart, charEnd }) => ({ id, text, charStart, charEnd })),
    };
    this.byUrl.delete(source.url);
    this.byUrl.set(source.url, source);
    while (this.byUrl.size > this.limit) {
      const oldest = this.byUrl.keys().next().value;
      if (oldest === undefined) break;
      this.byUrl.delete(oldest);
    }
    return source;
  }

  get(url: string): IngestedSource | undefined {
    return this.byUrl.get(url.trim());
  }
}

/** The first chunk whose text contains the quote, comparing with whitespace runs collapsed (case-sensitive). */
export function groundQuote(source: IngestedSource, quote: string): GroundingCheck {
  const needle = normaliseWhitespace(quote);
  if (needle !== '') {
    const chunk = source.chunks.find((c) => normaliseWhitespace(c.text).includes(needle));
    if (chunk !== undefined) return { ok: true, chunk };
  }
  return { ok: false, code: 'SOURCE_QUOTE_NOT_IN_CHUNK' };
}

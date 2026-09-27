// read_source paging (audit finding ai-agent-23). A long guide or whitepaper yields far
// more chunk text than one MCP tool result can carry, so read_source returns an outline
// page (chunk metadata plus a short preview) by default and the full text only of the
// chunks asked for by id, within a per-call character budget. The ingested document is
// kept in this process so later pages and chunk reads do not run dc-ingest again.

/** Outline entries per read_source call (default and maximum). */
export const OUTLINE_PAGE_MAX = 100;
/** Characters of chunk text shown in an outline entry. */
export const PREVIEW_CHARS = 200;
/** Chunk ids per read_source call. */
export const CHUNK_IDS_MAX = 20;
/** Total chunk text per read_source call; the chunks that do not fit come back under remainingChunkIds. */
export const CHUNK_TEXT_BUDGET = 40_000;

type Doc = Record<string, unknown>;
type Chunk = Record<string, unknown>;

function chunksOf(doc: Doc): Chunk[] {
  return Array.isArray(doc.chunks) ? (doc.chunks as Chunk[]) : [];
}

function textOf(chunk: Chunk): string {
  return typeof chunk.text === 'string' ? chunk.text : '';
}

/** The document fields other than `chunks`, plus the chunk count and the total text length. */
function header(doc: Doc): Doc {
  const { chunks: _chunks, ...rest } = doc;
  const chunks = chunksOf(doc);
  return { ...rest, chunkCount: chunks.length, totalChars: chunks.reduce((sum, c) => sum + textOf(c).length, 0) };
}

/** One page of the outline: every chunk field except `text`, plus `textChars` and `preview`. */
export function outlinePage(doc: Doc, offset: number, limit: number): Doc {
  const chunks = chunksOf(doc);
  const page = chunks.slice(offset, offset + limit).map((chunk) => {
    const { text: _text, ...meta } = chunk;
    const text = textOf(chunk);
    const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    return { ...meta, textChars: text.length, preview };
  });
  const next = offset + page.length;
  return { ...header(doc), offset, nextOffset: next < chunks.length ? next : null, chunks: page };
}

export type ChunkRead = { ok: true; value: Doc } | { ok: false; message: string };

/** The full chunks with the given ids, in the order asked, as many as fit in CHUNK_TEXT_BUDGET (always at least one). */
export function chunksById(doc: Doc, chunkIds: string[]): ChunkRead {
  const chunks = chunksOf(doc);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const ids = [...new Set(chunkIds)];
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    const range = chunks.length > 0 ? `${String(chunks[0]?.id)}..${String(chunks[chunks.length - 1]?.id)}` : 'none';
    return { ok: false, message: `UNKNOWN_CHUNK_ID: ${unknown.join(', ')} (this source has chunks ${range})` };
  }
  const selected: Chunk[] = [];
  let used = 0;
  for (const id of ids) {
    const chunk = byId.get(id) as Chunk;
    const size = textOf(chunk).length;
    if (selected.length > 0 && used + size > CHUNK_TEXT_BUDGET) break;
    selected.push(chunk);
    used += size;
  }
  return { ok: true, value: { ...header(doc), chunks: selected, remainingChunkIds: ids.slice(selected.length) } };
}

/** The last documents read_source ingested, keyed by the read request, newest last. */
export class ReadCache {
  private readonly byRequest = new Map<string, Doc>();

  constructor(private readonly limit = 20) {}

  static key(source: string, canonicalUrl: string | undefined, maxChunkChars: number | undefined): string {
    return JSON.stringify([source, canonicalUrl ?? null, maxChunkChars ?? null]);
  }

  get(key: string): Doc | undefined {
    return this.byRequest.get(key);
  }

  set(key: string, doc: Doc): void {
    this.byRequest.delete(key);
    this.byRequest.set(key, doc);
    while (this.byRequest.size > this.limit) {
      const oldest = this.byRequest.keys().next().value;
      if (oldest === undefined) break;
      this.byRequest.delete(oldest);
    }
  }
}

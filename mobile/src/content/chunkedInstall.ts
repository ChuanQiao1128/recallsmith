// mobile/src/content/chunkedInstall.ts
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

/**
 * Content Delivery v3 — chunked package installer (free live decks).
 *
 * Downloads `package.json` (schemaVersion 1), fetches its chunks with 3-way
 * concurrency into a per-version chunk cache dir (resumable: a cached chunk
 * that sha256-verifies is reused; a corrupt one is deleted and re-downloaded
 * once), assembles the flat deck json and atomically moves it to `finalPath`.
 *
 * NEVER throws — any failure returns `{ ok: false, reason }` so the caller
 * can fall back to the whole-file download path.
 */

// Runtime-safe "utf8" encoding without relying on FileSystem.EncodingType types
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

const CHUNK_DOWNLOAD_CONCURRENCY = 3;

export type ChunkedCard = {
  stableUid: string;
  question: string;
  explanation?: string | null;
  codeSnippet?: string | null;
  codeLanguage?: string | null;
  realWorldUsage?: string | null;
  difficulty?: number | null;
  orderInDeck?: number | null;
  revision?: number | null;
  version?: number | null;
  updatedAt?: string | null;
};

type ChunkedPackageChunk = {
  seq: number;
  path: string;
  bytes: number;
  sha256: string;
  cardCount: number;
};

type ChunkedPackage = {
  schemaVersion: number;
  slug: string;
  version: string;
  deck: {
    slug: string;
    title: string;
    locale: string;
    deckType: number;
    version: string | number;
    totalCards?: number;
  };
  totalCards: number;
  chunks: ChunkedPackageChunk[];
};

export type ChunkedInstallArgs = {
  slug: string;
  packageUrl: string;
  remoteVersion: string;
  /** User deck dir with a trailing slash (same dir installDeckFromUrl writes to). */
  deckDir: string;
  finalPath: string;
  /** Resolves a manifest-relative path (same joinUrl semantics as patch edges). */
  resolveRelativeUrl: (relativePath: string) => string;
};

export type ChunkedInstallResult =
  | { ok: true; cardCount: number }
  | { ok: false; reason: string };

function safeFileName(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function sha256HexLower(text: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
  return String(hex || '').toLowerCase();
}

async function hashMatches(expectedSha256: string, text: string): Promise<boolean> {
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!expected) return false;
  return expected === (await sha256HexLower(text));
}

/** Mirror of deckRepository's ensureDir (makeDirectoryAsync is concurrency-safe). */
async function ensureDir(dir: string): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    return;
  } catch {
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (info.exists && info.isDirectory) return;
    } catch {}
    throw new Error(`ensureDir_failed: ${dir}`);
  }
}

function parsePackage(raw: any, slug: string, remoteVersion: string): ChunkedPackage | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== 1) return null;
  if (String(raw.slug || '').trim() !== slug) return null;
  if (String(raw.version ?? '').trim() !== remoteVersion) return null;

  const deck = raw.deck;
  if (
    !deck ||
    typeof deck !== 'object' ||
    typeof deck.title !== 'string' ||
    !deck.title.trim() ||
    typeof deck.locale !== 'string' ||
    typeof deck.deckType !== 'number' ||
    !Number.isFinite(deck.deckType)
  ) {
    return null;
  }

  if (typeof raw.totalCards !== 'number' || !Number.isFinite(raw.totalCards) || raw.totalCards < 0) {
    return null;
  }

  const chunks = raw.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  const seen = new Set<number>();
  for (const c of chunks) {
    if (
      !c ||
      typeof c !== 'object' ||
      typeof c.seq !== 'number' ||
      !Number.isFinite(c.seq) ||
      typeof c.path !== 'string' ||
      !c.path.trim() ||
      typeof c.bytes !== 'number' ||
      typeof c.sha256 !== 'string' ||
      !c.sha256.trim() ||
      typeof c.cardCount !== 'number' ||
      !Number.isFinite(c.cardCount)
    ) {
      return null;
    }
    if (seen.has(c.seq)) return null;
    seen.add(c.seq);
  }

  return raw as ChunkedPackage;
}

type ChunkFetchResult = { ok: true; seq: number; text: string } | { ok: false; reason: string };

async function ensureChunk(
  chunk: ChunkedPackageChunk,
  chunkDir: string,
  resolveRelativeUrl: (relativePath: string) => string,
): Promise<ChunkFetchResult> {
  const filePath = `${chunkDir}${chunk.seq}.json`;

  // Resume: reuse a cached chunk that still hash-verifies; delete a corrupt one.
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      const cached = await FileSystem.readAsStringAsync(filePath, { encoding: UTF8_ENCODING });
      if (await hashMatches(chunk.sha256, cached)) {
        return { ok: true, seq: chunk.seq, text: cached };
      }
      try {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      } catch {}
    }
  } catch {}

  const url = /^https?:\/\//i.test(chunk.path)
    ? chunk.path
    : resolveRelativeUrl(chunk.path);

  // Download, verify; on failure re-download once.
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string | null = null;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'cache-control': 'no-cache' },
      });
      if (!resp.ok) continue;
      text = await resp.text();
    } catch {
      continue;
    }

    if (text == null) continue;
    if (!(await hashMatches(chunk.sha256, text))) continue;

    // Persist verified chunk so an interrupted install can resume.
    try {
      await FileSystem.writeAsStringAsync(filePath, text, { encoding: UTF8_ENCODING });
    } catch {}

    return { ok: true, seq: chunk.seq, text };
  }

  return { ok: false, reason: `chunk_${chunk.seq}_verify_failed` };
}

async function cleanupChunkDirs(
  chunksRoot: string,
  slugFile: string,
  versionFile: string,
): Promise<void> {
  // Current version's dir first.
  try {
    await FileSystem.deleteAsync(`${chunksRoot}${slugFile}.${versionFile}`, { idempotent: true });
  } catch {}

  // Stale chunk dirs of the same slug at other versions.
  try {
    const entries = await FileSystem.readDirectoryAsync(chunksRoot);
    const prefix = `${slugFile}.`;
    const current = `${slugFile}.${versionFile}`;
    for (const name of entries || []) {
      if (typeof name !== 'string') continue;
      if (!name.startsWith(prefix)) continue;
      if (name === current) continue;
      try {
        await FileSystem.deleteAsync(`${chunksRoot}${name}`, { idempotent: true });
      } catch {}
    }
  } catch {}
}

export async function installDeckFromChunkedPackage(
  args: ChunkedInstallArgs,
): Promise<ChunkedInstallResult> {
  try {
    return await runChunkedInstall(args);
  } catch (e: any) {
    return { ok: false, reason: `exception:${e?.message ?? String(e)}` };
  }
}

async function runChunkedInstall(args: ChunkedInstallArgs): Promise<ChunkedInstallResult> {
  const slug = String(args?.slug || '').trim();
  const packageUrl = String(args?.packageUrl || '').trim();
  const remoteVersion = String(args?.remoteVersion || '').trim();
  const deckDir = String(args?.deckDir || '');
  const finalPath = String(args?.finalPath || '');
  const resolveRelativeUrl = args?.resolveRelativeUrl;

  if (!slug || !packageUrl || !remoteVersion || !deckDir || !finalPath) {
    return { ok: false, reason: 'bad_args' };
  }
  if (typeof resolveRelativeUrl !== 'function') {
    return { ok: false, reason: 'bad_args_no_url_resolver' };
  }

  // 1) Fetch + validate package.json
  let pkgText: string;
  try {
    const resp = await fetch(packageUrl, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!resp.ok) return { ok: false, reason: `package_http_${resp.status}` };
    pkgText = await resp.text();
  } catch (e: any) {
    return { ok: false, reason: `package_fetch_failed:${e?.message ?? String(e)}` };
  }

  let pkgRaw: any = null;
  try {
    pkgRaw = JSON.parse(pkgText);
  } catch {
    return { ok: false, reason: 'package_parse_failed' };
  }

  const pkg = parsePackage(pkgRaw, slug, remoteVersion);
  if (!pkg) return { ok: false, reason: 'package_invalid' };

  // 2) Chunk cache dir (per slug + version)
  const slugFile = safeFileName(slug);
  const versionFile = safeFileName(remoteVersion);
  const chunksRoot = `${deckDir}chunks/`;
  const chunkDir = `${chunksRoot}${slugFile}.${versionFile}/`;
  await ensureDir(chunkDir);

  // 3) Download chunks (batches of CHUNK_DOWNLOAD_CONCURRENCY), resume-aware
  const sortedChunks = [...pkg.chunks].sort((a, b) => a.seq - b.seq);
  const textsBySeq = new Map<number, string>();

  for (let i = 0; i < sortedChunks.length; i += CHUNK_DOWNLOAD_CONCURRENCY) {
    const batch = sortedChunks.slice(i, i + CHUNK_DOWNLOAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map((c) => ensureChunk(c, chunkDir, resolveRelativeUrl)),
    );
    for (const r of results) {
      if (!r.ok) return { ok: false, reason: r.reason };
      textsBySeq.set(r.seq, r.text);
    }
  }

  // 4) Assemble cards in seq order, then stable-sort by orderInDeck
  const cards: ChunkedCard[] = [];
  for (const c of sortedChunks) {
    const text = textsBySeq.get(c.seq);
    if (typeof text !== 'string') return { ok: false, reason: `chunk_${c.seq}_missing` };

    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: `chunk_${c.seq}_parse_failed` };
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
      return { ok: false, reason: `chunk_${c.seq}_cards_invalid` };
    }
    if (String(parsed.slug ?? '').trim() !== slug) {
      return { ok: false, reason: `chunk_${c.seq}_slug_mismatch` };
    }
    if (String(parsed.version ?? '').trim() !== remoteVersion) {
      return { ok: false, reason: `chunk_${c.seq}_version_mismatch` };
    }
    if (parsed.cards.length !== c.cardCount) {
      return { ok: false, reason: `chunk_${c.seq}_card_count_mismatch` };
    }

    for (const card of parsed.cards) {
      cards.push(card as ChunkedCard);
    }
  }

  cards.sort((a, b) => {
    const ao = typeof a?.orderInDeck === 'number' ? a.orderInDeck : 999999;
    const bo = typeof b?.orderInDeck === 'number' ? b.orderInDeck : 999999;
    return ao - bo;
  });

  const seenUids = new Set<string>();
  for (const c of cards) {
    if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) {
      return { ok: false, reason: 'card_bad_stable_uid' };
    }
    if (seenUids.has(c.stableUid)) {
      return { ok: false, reason: 'card_duplicate_stable_uid' };
    }
    seenUids.add(c.stableUid);
  }

  if (cards.length !== pkg.totalCards) {
    return {
      ok: false,
      reason: `total_cards_mismatch:expected_${pkg.totalCards}_got_${cards.length}`,
    };
  }

  // 5) Build the flat deck json (same shape the full download produces)
  const flatDeck = {
    slug,
    title: String(pkg.deck.title),
    locale: String(pkg.deck.locale),
    deckType: Number(pkg.deck.deckType),
    version: remoteVersion,
    totalCards: cards.length,
    cards,
  };

  // 6) Unique tmp write + atomic-ish replace (mirrors installDeckFromUrl)
  const rnd = Math.random().toString(16).slice(2);
  const tmpPath = `${deckDir}${slugFile}.${versionFile}.${Date.now()}.${rnd}.chunked.tmp.json`;

  try {
    await FileSystem.writeAsStringAsync(tmpPath, JSON.stringify(flatDeck), {
      encoding: UTF8_ENCODING,
    });
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });
  } catch (e: any) {
    try {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    } catch {}
    return { ok: false, reason: `finalize_failed:${e?.message ?? String(e)}` };
  }

  // 7) Best-effort chunk cache cleanup (this version + stale sibling versions)
  await cleanupChunkDirs(chunksRoot, slugFile, versionFile);

  console.log('[chunkedInstall] success', {
    slug,
    version: remoteVersion,
    chunks: sortedChunks.length,
    cardCount: cards.length,
  });

  return { ok: true, cardCount: cards.length };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PityState } from './pity';

// One deck's whole draw-mutable state lives under one key, and a draw
// writes it exactly once. AsyncStorage has no BEGIN/COMMIT, so the only
// transaction boundary we can build is "make the post-draw state a
// single value and setItem it once". Before this, a draw wrote the
// owned set and the pity counter as two independent setItem calls; a
// kill between them left the deck torn: a card sitting in the Library
// that never counted toward pity, or a pity counter reset with nothing
// to show for it. Neither is recoverable, because nothing on disk says
// which half is stale.
//
// The cost is real and worth naming: owned and pity are now coupled
// (touching either rewrites both), and every draw rewrites the entire
// owned list instead of appending a delta, so write size grows with
// deck size. We take write amplification over torn state because the
// bytes are cheap and the corruption is user-visible and permanent.
const DRAW_STATE_PREFIX = 'devcards:draw-state:';

// Draw history is deliberately NOT part of the atomic value. It is
// diagnostics, not state: keeping it out means the write that must
// survive a kill stays small, and a fat or corrupt history can never
// endanger someone's collection.
const DRAW_HISTORY_PREFIX = 'devcards:draw-history:';

// Pre-merge layout. Read once as a fallback when the merged key is
// missing so existing installs do not lose their collection. The
// migration deliberately does not write or delete anything: a
// read-only fallback keeps load paths free of side effects, and the
// first successful draw persists the merged shape anyway.
const LEGACY_OWNED_PREFIX = 'devcards:draw-owned:';
const LEGACY_PITY_PREFIX = 'devcards:draw-pity:';

// Ring buffer size. 50 draws is enough to replay any "this pull was
// wrong" report that arrives while the user still remembers it, and
// small enough that the history key stays a few KB.
export const DRAW_HISTORY_LIMIT = 50;

export type DrawStateRecord = {
  owned: string[];
  // null means "never persisted for this deck"; the caller applies its
  // own default rather than this layer inventing one, which keeps the
  // pity defaults in exactly one place (pity.ts).
  pity: PityState | null;
};

export type DrawHistoryEntry = {
  drawId: string;
  slug: string;
  // The seed that drove selectDrawCards. Persisting it is what turns a
  // testable draw into a reproducible one: a seed passed as a parameter
  // only lets us write tests, a seed written to disk lets us replay the
  // exact pull a user is complaining about.
  seed: number;
  // drawCount is stored separately from drawnUids.length because an
  // exhausted pool returns fewer cards than requested, and replay must
  // feed selectDrawCards the request, not the outcome.
  drawCount: number;
  ownedBefore: string[];
  pityBefore: PityState;
  drawnUids: string[];
  ts: number;
};

function stateKey(slug: string): string {
  return `${DRAW_STATE_PREFIX}${slug}`;
}

function historyKey(slug: string): string {
  return `${DRAW_HISTORY_PREFIX}${slug}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toPityState(value: unknown): PityState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { draws?: unknown; threshold?: unknown };
  if (typeof raw.draws !== 'number' || !Number.isFinite(raw.draws)) return null;
  const threshold =
    typeof raw.threshold === 'number' && raw.threshold > 0 ? raw.threshold : undefined;
  return {
    draws: Math.max(0, Math.floor(raw.draws)),
    // 0 means "no usable threshold was stored". The default lives in
    // pity.ts and is applied there, so this layer never has to guess a
    // gameplay constant it does not own.
    threshold: threshold ?? 0,
  };
}

async function loadLegacyDrawState(slug: string): Promise<DrawStateRecord> {
  const [ownedRaw, pityRaw] = await Promise.all([
    AsyncStorage.getItem(`${LEGACY_OWNED_PREFIX}${slug}`),
    AsyncStorage.getItem(`${LEGACY_PITY_PREFIX}${slug}`),
  ]);

  let owned: string[] = [];
  let pity: PityState | null = null;

  if (ownedRaw) {
    try {
      owned = toStringArray(JSON.parse(ownedRaw));
    } catch {
      owned = [];
    }
  }

  if (pityRaw) {
    try {
      pity = toPityState(JSON.parse(pityRaw));
    } catch {
      pity = null;
    }
  }

  return { owned, pity };
}

export async function loadDrawState(slug: string): Promise<DrawStateRecord> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(stateKey(slug));
  } catch {
    return { owned: [], pity: null };
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { owned?: unknown; pity?: unknown };
      return { owned: toStringArray(parsed?.owned), pity: toPityState(parsed?.pity) };
    } catch {
      // A corrupt merged key falls through to the legacy read rather
      // than to empty: an old collection is a better answer than none.
    }
  }

  try {
    return await loadLegacyDrawState(slug);
  } catch {
    return { owned: [], pity: null };
  }
}

/**
 * The single write that a draw is allowed to make. Anything that must
 * be true together after a draw belongs in `record`, not in a second
 * setItem next to this call.
 */
export async function saveDrawState(slug: string, record: DrawStateRecord): Promise<void> {
  await AsyncStorage.setItem(
    stateKey(slug),
    JSON.stringify({ owned: record.owned, pity: record.pity }),
  );
}

export async function loadDrawHistory(slug: string): Promise<DrawHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DrawHistoryEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<DrawHistoryEntry>;
      return typeof candidate.drawId === 'string' && typeof candidate.seed === 'number';
    });
  } catch {
    return [];
  }
}

/**
 * Appends one draw to the ring buffer. Callers run this *after* the
 * state write: a lost record is a missing diagnostic, whereas a record
 * written before a failed state write would describe a draw that never
 * happened, which is worse than having nothing. Failures are swallowed
 * for the same reason: history must never be able to fail a draw.
 */
export async function appendDrawHistory(slug: string, entry: DrawHistoryEntry): Promise<void> {
  try {
    const existing = await loadDrawHistory(slug);
    const next = [...existing, entry].slice(-DRAW_HISTORY_LIMIT);
    await AsyncStorage.setItem(historyKey(slug), JSON.stringify(next));
  } catch {
    // Diagnostics are best-effort by design.
  }
}

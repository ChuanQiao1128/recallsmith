import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserScopedKey } from '../../../review/storage';
import { getCachedDrawState, setCachedDrawState, invalidateDrawStateCache } from './drawStateCache';
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

// The reserved partition getUserScopedKey() builds while signed out.
// Mirrors review/storage.ts:24 (USER_SCOPE_PREFIX) plus the 'anon'
// fallback at :65. It is defined here rather than imported from
// review/storage so this module does not depend on that module's
// internal scope constants; the unit test in drawStateAdoption.test.ts
// pins it to getUserScopedKey('') so the two definitions cannot drift.
export const ANON_USER_SCOPE_PREFIX = 'devcards:u:anon:';

// Draw history is deliberately NOT part of the atomic value. It is
// diagnostics, not state: keeping it out means the write that must
// survive a kill stays small, and a fat or corrupt history can never
// endanger someone's collection.
const DRAW_HISTORY_PREFIX = 'devcards:draw-history:';

// Pre-merge layout, from before owned and pity shared one key.
const LEGACY_OWNED_PREFIX = 'devcards:draw-owned:';
const LEGACY_PITY_PREFIX = 'devcards:draw-pity:';

// Both prefixes above, and the merged prefix, used to be written
// unscoped: one collection per device rather than one per account. The
// keys are now built through getUserScopedKey(), and the leftover
// unscoped keys are treated as legacy data belonging to whoever is
// signed in the first time we look for them.
//
// That migration writes and deletes, which the previous read-only
// fallback deliberately did not. It has to: a read-only fallback to an
// unscoped key hands every future account on this device the previous
// account's collection, which is precisely the bug the partitioning
// fixes. So the legacy value is copied into the current scope and the
// unscoped key is removed, the same claim-then-delete shape
// review/storage.ts uses for its own pre-partition keys.
//
// If the first load after upgrading happens while signed out, the
// collection lands in the "anon" partition. That partition is no longer
// stranded: adoptAnonDrawState() below unions it into the account that
// next signs in (driven through adoptAnonGachaState in
// sync/drawStateSync.ts, ahead of the first cloud push), so this key
// migration only has to reason about the unscoped legacy keys.

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

function stateKey(slug: string): Promise<string> {
  return getUserScopedKey(`${DRAW_STATE_PREFIX}${slug}`);
}

function historyKey(slug: string): Promise<string> {
  return getUserScopedKey(`${DRAW_HISTORY_PREFIX}${slug}`);
}

// Unscoped keys: migration sources only, never written after the claim.
function globalStateKey(slug: string): string {
  return `${DRAW_STATE_PREFIX}${slug}`;
}

function globalHistoryKey(slug: string): string {
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

function parseDrawStateRecord(raw: string): DrawStateRecord {
  const parsed = JSON.parse(raw) as { owned?: unknown; pity?: unknown };
  return { owned: toStringArray(parsed?.owned), pity: toPityState(parsed?.pity) };
}

/**
 * Reads whatever an unscoped install left behind for this deck: the
 * merged key first, then the older split owned/pity pair. `found`
 * reports whether any unscoped key existed at all, corrupt included,
 * because a corrupt legacy key still has to be claimed and removed or
 * every future load re-reads the same garbage.
 */
async function readGlobalDrawState(
  slug: string,
): Promise<{ record: DrawStateRecord; found: boolean }> {
  const [mergedRaw, ownedRaw, pityRaw] = await Promise.all([
    AsyncStorage.getItem(globalStateKey(slug)),
    AsyncStorage.getItem(`${LEGACY_OWNED_PREFIX}${slug}`),
    AsyncStorage.getItem(`${LEGACY_PITY_PREFIX}${slug}`),
  ]);

  const found = mergedRaw != null || ownedRaw != null || pityRaw != null;

  if (mergedRaw) {
    try {
      return { record: parseDrawStateRecord(mergedRaw), found };
    } catch {
      // A corrupt merged key falls through to the split layout rather
      // than to empty: an old collection is a better answer than none.
    }
  }

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

  return { record: { owned, pity }, found };
}

/**
 * Moves unscoped draw state into the current user's partition, once.
 * Returns null when there was nothing left over, so the caller can tell
 * "migrated an empty collection" from "no legacy data at all".
 */
async function claimGlobalDrawState(slug: string): Promise<DrawStateRecord | null> {
  const { record, found } = await readGlobalDrawState(slug);
  if (!found) return null;

  try {
    // Copy before delete. A kill in between leaves the legacy keys in
    // place for the next load to claim again, which is a repeat of work
    // already done; deleting first would lose the collection outright.
    await saveDrawState(slug, record);
    await AsyncStorage.removeItem(globalStateKey(slug));
    await AsyncStorage.removeItem(`${LEGACY_OWNED_PREFIX}${slug}`);
    await AsyncStorage.removeItem(`${LEGACY_PITY_PREFIX}${slug}`);
  } catch {
    // The value we already read is still the right answer for this
    // load; the claim retries on the next one.
  }

  return record;
}

/**
 * The read model. Backed by memory after the first read of a partition.
 *
 * Uncached, this was an AsyncStorage getItem plus a JSON.parse per call, and
 * a *miss* cost four reads: the scoped key plus the three pre-partition keys
 * the legacy claim looks for. That was affordable while the only readers were
 * a draw and the draw screen. The ownership gate makes every card list a
 * reader, so the same call now happens per screen render rather than per
 * pull, and the amplification is what would have shown up as jank.
 *
 * Nothing about the answer changes: the cache is only ever filled with what
 * storage just returned. saveDrawState is the only writer and writes through;
 * the three paths that *delete* these keys without passing through it each
 * call invalidateDrawStateCache (the debug progress reset, the sync debug
 * reset, and the deck-retire purge). Anything new that removes a
 * `devcards:draw-state:` key has to do the same, or its deletion will be
 * undone by the next read-modify-write.
 */
export async function loadDrawState(slug: string): Promise<DrawStateRecord> {
  let key: string;
  let raw: string | null = null;
  try {
    key = await stateKey(slug);
    const cached = getCachedDrawState(key);
    if (cached) return cached;
    raw = await AsyncStorage.getItem(key);
  } catch {
    // Deliberately not cached. A transient read failure must not pin an empty
    // collection in memory for the rest of the session -- that would turn one
    // bad read into "your cards are gone until you restart the app".
    return { owned: [], pity: null };
  }

  if (raw) {
    try {
      const record = parseDrawStateRecord(raw);
      setCachedDrawState(key, record);
      return record;
    } catch {
      // A corrupt scoped key falls through to the legacy claim rather
      // than to empty: an old collection is a better answer than none.
    }
  }

  try {
    const claimed = await claimGlobalDrawState(slug);
    // A successful claim is cached by the saveDrawState inside it, and a
    // failed one is deliberately left uncached so the next load retries the
    // migration -- the write-through *is* the signal that the copy is
    // durable. Only "there was nothing to claim" is cached here, and it has
    // to be: without it every load of a never-drawn deck re-runs the
    // three-key legacy scan forever.
    if (claimed) return claimed;
    const empty: DrawStateRecord = { owned: [], pity: null };
    setCachedDrawState(key, empty);
    return empty;
  } catch {
    return { owned: [], pity: null };
  }
}

/**
 * Every deck this account has draw state for on this device.
 *
 * Exists for the cloud sync (sync/drawStateSync.ts), which has to push
 * whatever is here without being told which decks to look at: the set of
 * played decks is not written down anywhere else, and asking the deck
 * repository instead would miss a deck whose files were uninstalled
 * while its collection stayed.
 *
 * Scans keys inside the current user's partition only, so it can never
 * report another account's decks.
 */
export async function listDrawStateSlugs(): Promise<string[]> {
  try {
    const prefix = await stateKey('');
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((slug) => slug.length > 0);
  } catch {
    return [];
  }
}

/**
 * The single write that a draw is allowed to make. Anything that must
 * be true together after a draw belongs in `record`, not in a second
 * setItem next to this call.
 */
export async function saveDrawState(slug: string, record: DrawStateRecord): Promise<void> {
  const key = await stateKey(slug);
  await AsyncStorage.setItem(key, JSON.stringify({ owned: record.owned, pity: record.pity }));
  // After the write, never before. A cache primed ahead of a setItem that
  // then throws would serve a collection that does not exist on disk -- the
  // draw would look committed until the next launch silently took it back.
  // In this order a failed write leaves memory and disk agreeing on the old
  // value, which is the state the caller's error handling already expects.
  setCachedDrawState(key, record);
}

function samePityState(a: PityState | null, b: PityState | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.draws === b.draws && a.threshold === b.threshold;
}

export type AnonDrawStateAdoption = { decks: number; ownedAdded: number; pityRaised: number };

/**
 * Unions the "anon" partition's draw state into the current account, once,
 * at sign-in. A collection drawn before signing in lands in the reserved
 * anon partition (see the note above stateKey); without this it would be
 * invisible to the account -- and, because listDrawStateSlugs only scans the
 * current partition, invisible to the server's union too.
 *
 * Owned is unioned (a reveal is forever, so the merge cannot lose), pity keeps
 * the higher counter, and the anon key is removed afterwards. The removal is
 * the "adopted" marker: a second run finds nothing and returns zeros, and a
 * collection drawn after a later sign-out is adopted afresh by the next
 * sign-in. Copy-then-clear, never the reverse. Never throws: a storage failure
 * during adoption must not fail sign-in, so it returns the counts so far.
 */
export async function adoptAnonDrawState(): Promise<AnonDrawStateAdoption> {
  const result: AnonDrawStateAdoption = { decks: 0, ownedAdded: 0, pityRaised: 0 };
  try {
    const userPrefix = await stateKey('');
    // Signed out: the current partition IS the anon partition, so there is
    // nothing to adopt into. (init() reaches here too, before a sub is known.)
    if (userPrefix.startsWith(ANON_USER_SCOPE_PREFIX)) return result;

    const anonPrefix = `${ANON_USER_SCOPE_PREFIX}${DRAW_STATE_PREFIX}`;
    const keys = await AsyncStorage.getAllKeys();
    const slugs = keys
      .filter((key) => key.startsWith(anonPrefix))
      .map((key) => key.slice(anonPrefix.length))
      .filter((slug) => slug.length > 0);

    for (const slug of slugs) {
      const anonKey = `${anonPrefix}${slug}`;

      // A corrupt anon value adopts nothing but its key is still removed, the
      // same reasoning as the legacy claim: a corrupt key left behind is
      // re-scanned on every future adoption forever.
      let anon: DrawStateRecord = { owned: [], pity: null };
      const raw = await AsyncStorage.getItem(anonKey);
      if (raw) {
        try {
          anon = parseDrawStateRecord(raw);
        } catch {
          anon = { owned: [], pity: null };
        }
      }

      const current = await loadDrawState(slug);

      // Union: user order first, anon uids appended in anon order, no dupes,
      // empty strings skipped. Same semantics as unionOwned in
      // sync/drawStateSync, re-implemented locally because this module must
      // not import from sync/ -- that would be an import cycle.
      const seen = new Set(current.owned);
      const mergedOwned = [...current.owned];
      for (const uid of anon.owned) {
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        mergedOwned.push(uid);
      }
      const grew = mergedOwned.length - current.owned.length;

      let mergedPity: PityState | null;
      if (current.pity == null || anon.pity == null) {
        mergedPity = current.pity ?? anon.pity;
      } else {
        mergedPity = {
          draws: Math.max(current.pity.draws, anon.pity.draws),
          threshold: current.pity.threshold > 0 ? current.pity.threshold : anon.pity.threshold,
        };
      }
      const drawsRose = (mergedPity?.draws ?? 0) > (current.pity?.draws ?? 0);

      if (grew > 0 || !samePityState(current.pity, mergedPity)) {
        await saveDrawState(slug, { owned: mergedOwned, pity: mergedPity });
        result.ownedAdded += grew;
        if (drawsRose) result.pityRaised += 1;
      }

      // User partition written first, anon key removed second. Removing the
      // draw-state key without going through saveDrawState means its cache
      // entry has to be dropped by hand (see loadDrawState's cache note).
      await AsyncStorage.removeItem(anonKey);
      invalidateDrawStateCache(anonKey);
      result.decks += 1;
    }
  } catch {
    // Return whatever was adopted before the failure; the next sign-in retries
    // any anon keys still present.
  }
  return result;
}

function parseDrawHistory(raw: string): DrawHistoryEntry[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is DrawHistoryEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const candidate = entry as Partial<DrawHistoryEntry>;
    return typeof candidate.drawId === 'string' && typeof candidate.seed === 'number';
  });
}

export async function loadDrawHistory(slug: string): Promise<DrawHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(await historyKey(slug));
    if (raw) return parseDrawHistory(raw);

    // Same claim-then-delete migration as the state key, kept separate
    // so a history read never has to load state first to be correct.
    const globalRaw = await AsyncStorage.getItem(globalHistoryKey(slug));
    if (!globalRaw) return [];

    const entries = parseDrawHistory(globalRaw);
    try {
      await AsyncStorage.setItem(await historyKey(slug), JSON.stringify(entries));
      await AsyncStorage.removeItem(globalHistoryKey(slug));
    } catch {
      // Diagnostics are best-effort; the claim retries next load.
    }
    return entries;
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
    await AsyncStorage.setItem(await historyKey(slug), JSON.stringify(next));
  } catch {
    // Diagnostics are best-effort by design.
  }
}

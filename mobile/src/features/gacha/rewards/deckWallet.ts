import AsyncStorage from '@react-native-async-storage/async-storage';

import { getUserScopedKey, loadAllProgress } from '../../../review/storage';
import { loadActiveDeckSlug } from '../../../content/activeDeck';
import { ANON_USER_SCOPE_PREFIX, loadDrawState } from '../draw/drawStateStore';
import {
  applyRewardToWallet,
  consumePullsFromWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  type AppliedRewardWalletState,
  type RewardWalletState,
} from './rewardWallet';
import { countPaidEntriesBySlug } from './newCardLedger';
import { isStarterLessonOpen } from '../starter/starterGate';
import { isLearnedProgress } from '../selectors/progressSelectors';

// Release 1.7, owner option A: pulls belong to the pack that earned them, and a
// pull earned in a pack can only open that pack. This module is that per-pack
// wallet. It keeps the same caps as the legacy global wallet (60 + 5 per pack,
// always through applyRewardToWallet / consumePullsFromWallet) and the same
// write-order discipline the legacy wallet uses, but every balance now lives in
// ONE record keyed by slug instead of the single global key. The legacy global
// wallet (rewardWallet.ts) still exists and still syncs so 1.6.1 keeps working;
// on a 1.7 client it only ever drains into packs (migrateLegacyWalletIfNeeded).

/** The one key per partition that holds every pack's wallet. Resolved through
 *  getUserScopedKey(), so a signed-in user and the anon period each get their own. */
export const DECK_WALLETS_KEY = 'recallsmith:deck-wallets:v1';

/** The first-visit bootstrap grant, replacing the global 3-pull starter grant. */
export const DECK_BOOTSTRAP_GRANT = 3;

export type DeckWalletsRecord = {
  migratedAtMs: number | null;
  decks: Record<string, RewardWalletState>;
  bootstrappedAtMs: Record<string, number>;
  /** Packs re-bootstrapped once after a content replacement left every owned card outside the
   *  deck (ensureDeckBootstrap). Absent on records that never needed it. */
  rebootstrappedAtMs?: Record<string, number>;
};

function emptyRecord(): DeckWalletsRecord {
  return { migratedAtMs: null, decks: {}, bootstrappedAtMs: {} };
}

function zeroWallet(): RewardWalletState {
  return { availablePulls: 0, reservePulls: 0 };
}

function toNonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeWallet(w: RewardWalletState | null | undefined): RewardWalletState {
  return { availablePulls: toNonNegInt(w?.availablePulls), reservePulls: toNonNegInt(w?.reservePulls) };
}

// Tolerant parse: non-object values, non-finite numbers and negatives read as
// absent or 0, and a corrupt top-level value reads as the empty record. A
// storage READ error is a different thing and is thrown by readRecord() below;
// each exported function catches it per its own contract.
function parseRecord(raw: string | null): DeckWalletsRecord {
  if (raw == null) return emptyRecord();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRecord();
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRecord();
  const rec = parsed as Record<string, unknown>;

  const migratedRaw = rec.migratedAtMs;
  const migratedAtMs =
    typeof migratedRaw === 'number' && Number.isFinite(migratedRaw) && migratedRaw >= 0
      ? Math.floor(migratedRaw)
      : null;

  const decks: Record<string, RewardWalletState> = {};
  if (rec.decks != null && typeof rec.decks === 'object' && !Array.isArray(rec.decks)) {
    for (const [slug, w] of Object.entries(rec.decks as Record<string, unknown>)) {
      if (!slug) continue;
      const wr = w as Record<string, unknown> | null;
      decks[slug] = {
        availablePulls: toNonNegInt(wr?.availablePulls),
        reservePulls: toNonNegInt(wr?.reservePulls),
      };
    }
  }

  const bootstrappedAtMs = parseMarks(rec.bootstrappedAtMs);
  const rebootstrappedAtMs = parseMarks(rec.rebootstrappedAtMs);

  return {
    migratedAtMs,
    decks,
    bootstrappedAtMs,
    ...(Object.keys(rebootstrappedAtMs).length > 0 ? { rebootstrappedAtMs } : {}),
  };
}

function parseMarks(raw: unknown): Record<string, number> {
  const marks: Record<string, number> = {};
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [slug, ms] of Object.entries(raw as Record<string, unknown>)) {
      if (!slug) continue;
      const n = Number(ms);
      if (Number.isFinite(n) && n >= 0) marks[slug] = Math.floor(n);
    }
  }
  return marks;
}

function walletsKey(): Promise<string> {
  return getUserScopedKey(DECK_WALLETS_KEY);
}

/** Reads the record for the given resolved key. Throws on a storage read error. */
async function readRecord(key: string): Promise<DeckWalletsRecord> {
  const raw = await AsyncStorage.getItem(key);
  return parseRecord(raw);
}

// One module-level promise-chain lock. Every mutation (grant, consume, refund,
// save, bootstrap, migration/sweep, anon adoption, the floor's write, sync
// adoption) runs through it: inside the lock it re-reads the record, applies the
// change and writes it with a single setItem, so two writes in the same JS
// process never lose each other's changes. Helpers that already hold the lock
// must NOT call the exported locked functions -- that would deadlock.
let _lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _lock.then(fn, fn);
  _lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The single read-modify-write primitive. Under the lock it re-reads the record,
 * hands it to `apply`, and writes exactly once when `apply` returns a non-null
 * `next`.
 */
async function withRecordWrite<T>(
  apply: (record: DeckWalletsRecord, key: string) =>
    | Promise<{ next: DeckWalletsRecord | null; result: T }>
    | { next: DeckWalletsRecord | null; result: T },
): Promise<T> {
  return withLock(async () => {
    const key = await walletsKey();
    const record = await readRecord(key);
    const { next, result } = await apply(record, key);
    if (next) await AsyncStorage.setItem(key, JSON.stringify(next));
    return result;
  });
}

/** Every pack's wallet in this partition. On a read error returns {}. */
export async function loadDeckWallets(): Promise<Record<string, RewardWalletState>> {
  try {
    const record = await readRecord(await walletsKey());
    return record.decks;
  } catch {
    return {};
  }
}

/** One pack's wallet. An absent pack is {0, 0}; a read error returns {0, 0}. */
export async function loadDeckWallet(slug: string): Promise<RewardWalletState> {
  try {
    const record = await readRecord(await walletsKey());
    return record.decks[slug] ?? zeroWallet();
  } catch {
    return zeroWallet();
  }
}

/** Writes one pack's wallet, leaving every other pack and the flags untouched. */
export async function saveDeckWallet(slug: string, wallet: RewardWalletState): Promise<void> {
  await withRecordWrite((record) => {
    const next: DeckWalletsRecord = {
      ...record,
      decks: { ...record.decks, [slug]: normalizeWallet(wallet) },
    };
    return { next, result: undefined as void };
  });
}

/**
 * Fresh-read update hook (the one economyFloor.ts uses). Under the lock it reads
 * the current pack wallet, calls `updater`, and writes only when the updater
 * returns a non-null wallet. Returns { before, after }.
 */
export async function updateDeckWallet(
  slug: string,
  updater: (current: RewardWalletState) => Promise<RewardWalletState | null> | RewardWalletState | null,
): Promise<{ before: RewardWalletState; after: RewardWalletState }> {
  return withRecordWrite(async (record) => {
    const before = record.decks[slug] ?? zeroWallet();
    const updated = await updater(before);
    if (updated == null) {
      return { next: null, result: { before, after: before } };
    }
    const after = normalizeWallet(updated);
    const next: DeckWalletsRecord = {
      ...record,
      decks: { ...record.decks, [slug]: after },
    };
    return { next, result: { before, after } };
  });
}

/** Read → applyRewardToWallet → write, for one pack. Same shape as grantPullsToStoredWallet. */
export async function grantDeckPulls(
  slug: string,
  count: number,
): Promise<{ walletBefore: RewardWalletState; walletAfter: RewardWalletState; applied: AppliedRewardWalletState }> {
  return withRecordWrite((record) => {
    const walletBefore = record.decks[slug] ?? zeroWallet();
    const applied = applyRewardToWallet(walletBefore, count);
    const walletAfter: RewardWalletState = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
    const next: DeckWalletsRecord = { ...record, decks: { ...record.decks, [slug]: walletAfter } };
    return { next, result: { walletBefore, walletAfter, applied } };
  });
}

/** Read → consumePullsFromWallet → write, for one pack. Same shape as consumePullsFromStoredWallet. */
export async function consumeDeckPulls(
  slug: string,
  count: number,
): Promise<{ wallet: RewardWalletState; spent: number; promotedFromReserve: number }> {
  return withRecordWrite((record) => {
    const current = record.decks[slug] ?? zeroWallet();
    const result = consumePullsFromWallet(current, count);
    const next: DeckWalletsRecord = { ...record, decks: { ...record.decks, [slug]: result.wallet } };
    return { next, result };
  });
}

/**
 * Adds `count` pulls onto what the pack holds NOW (never restores a snapshot),
 * through applyRewardToWallet so a refund obeys the same caps as a grant -- the
 * same rationale as rewardWallet.refundPullsToStoredWallet.
 */
export async function refundDeckPulls(slug: string, count: number): Promise<RewardWalletState> {
  const safeCount = Math.max(0, Math.floor(count));
  return withRecordWrite((record) => {
    const current = record.decks[slug] ?? zeroWallet();
    if (safeCount === 0) return { next: null, result: current };
    const applied = applyRewardToWallet(current, safeCount);
    const nextWallet: RewardWalletState = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
    const next: DeckWalletsRecord = { ...record, decks: { ...record.decks, [slug]: nextWallet } };
    return { next, result: nextWallet };
  });
}

/**
 * The pack's current card uids, read through the non-frozen deck cache (a guarded dynamic import,
 * like deckCache's own scope read, so suites that never touch decks do not load the deck stack).
 * Null when the deck is not installed or cannot be read.
 */
async function liveDeckUids(slug: string): Promise<Set<string> | null> {
  try {
    const { getCachedDeck } = await import('../../../content/deckCache');
    const deck = await getCachedDeck(slug);
    const uids = (deck?.Cards ?? [])
      .map((card) => card?.StableUid)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0);
    return uids.length > 0 ? new Set(uids) : null;
  } catch {
    return null;
  }
}

/**
 * True when the learner holds cards of this pack but not one of them is still in the deck: the
 * deck's content was replaced wholesale (new uids), so the old draw state and progress point at
 * cards the deck no longer has. "Holds" is drawState.owned plus learned progress -- the same two
 * sources the owned gate reads. False when nothing is held (the first-visit path covers that), when
 * any held uid is still in the deck, or when the deck cannot be read.
 */
async function ownsOnlyRetiredCards(slug: string, owned: readonly string[]): Promise<boolean> {
  const live = await liveDeckUids(slug);
  if (!live) return false;
  // The draw state first: for almost every learner an owned card is still in the deck, and that
  // answers without reading progress.
  let held = 0;
  for (const uid of owned) {
    if (typeof uid !== 'string' || !uid) continue;
    if (live.has(uid)) return false;
    held += 1;
  }
  try {
    const progress = (await loadAllProgress())[slug] ?? [];
    for (const entry of progress) {
      if (!entry?.stableUid || !isLearnedProgress(entry)) continue;
      if (live.has(entry.stableUid)) return false;
      held += 1;
    }
  } catch {
    // Progress unreadable: decide on the draw state alone.
  }
  return held > 0;
}

/**
 * Grants DECK_BOOTSTRAP_GRANT exactly once per pack per partition, and only when
 * all three hold: the pack has never been bootstrapped, its available + reserve
 * is 0, and its draw state is untouched (owned.length === 0 && pity == null). The
 * pulls and the bootstrap mark go in one record write. When the pack is not
 * eligible it writes nothing and does not mark it either. Never throws.
 *
 * R22 §4: while the starter lesson is open nothing is bootstrapped, on any pack
 * -- a new learner learns first and the first pack is the reward for finishing.
 * completeStarterLesson closes the lesson, then calls this. Every caller (Home,
 * Draw, Library) goes through here, so the rule holds wherever the learner taps.
 *
 * Re-bootstrap after a content replacement: when the pack's wallet is empty and
 * every card the learner holds in it (drawState.owned plus learned progress) has
 * left the deck, the pack is granted DECK_BOOTSTRAP_GRANT once more, marked in
 * rebootstrappedAtMs so it never repeats. A pack where even one held card is still
 * in the deck never qualifies.
 */
export async function ensureDeckBootstrap(slug: string): Promise<{ granted: number; wallet: RewardWalletState }> {
  try {
    if (await isStarterLessonOpen()) {
      return { granted: 0, wallet: await loadDeckWallet(slug) };
    }
    type FirstVisit = { granted: number; wallet: RewardWalletState; rebootstrapCandidate: boolean; owned: string[] };
    const first = await withLock(async (): Promise<FirstVisit> => {
      const key = await walletsKey();
      const record = await readRecord(key);
      const current = record.decks[slug] ?? zeroWallet();
      const alreadyMarked = Object.prototype.hasOwnProperty.call(record.bootstrappedAtMs, slug);
      const hasPulls = current.availablePulls + current.reservePulls > 0;
      if (hasPulls) {
        return { granted: 0, wallet: current, rebootstrapCandidate: false, owned: [] };
      }
      const rebootstrapped = Object.prototype.hasOwnProperty.call(record.rebootstrappedAtMs ?? {}, slug);
      const drawState = await loadDrawState(slug);
      if (alreadyMarked || drawState.owned.length !== 0 || drawState.pity != null) {
        // Not a first visit. An empty pack that was never re-bootstrapped may still qualify below.
        return { granted: 0, wallet: current, rebootstrapCandidate: !rebootstrapped, owned: [...drawState.owned] };
      }
      const applied = applyRewardToWallet(current, DECK_BOOTSTRAP_GRANT);
      const wallet: RewardWalletState = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
      const next: DeckWalletsRecord = {
        ...record,
        decks: { ...record.decks, [slug]: wallet },
        bootstrappedAtMs: { ...record.bootstrappedAtMs, [slug]: Date.now() },
      };
      await AsyncStorage.setItem(key, JSON.stringify(next));
      return { granted: DECK_BOOTSTRAP_GRANT, wallet, rebootstrapCandidate: false, owned: [] };
    });
    if (first.granted > 0 || !first.rebootstrapCandidate) return { granted: first.granted, wallet: first.wallet };

    // The deck read happens outside the lock; the grant re-checks the wallet and the mark under it.
    if (!(await ownsOnlyRetiredCards(slug, first.owned))) return { granted: 0, wallet: first.wallet };
    return await withLock(async () => {
      const key = await walletsKey();
      const record = await readRecord(key);
      const current = record.decks[slug] ?? zeroWallet();
      const marks = record.rebootstrappedAtMs ?? {};
      if (Object.prototype.hasOwnProperty.call(marks, slug) || current.availablePulls + current.reservePulls > 0) {
        return { granted: 0, wallet: current };
      }
      const applied = applyRewardToWallet(current, DECK_BOOTSTRAP_GRANT);
      const wallet: RewardWalletState = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
      const next: DeckWalletsRecord = {
        ...record,
        decks: { ...record.decks, [slug]: wallet },
        rebootstrappedAtMs: { ...marks, [slug]: Date.now() },
      };
      await AsyncStorage.setItem(key, JSON.stringify(next));
      return { granted: DECK_BOOTSTRAP_GRANT, wallet };
    });
  } catch {
    return { granted: 0, wallet: await loadDeckWallet(slug) };
  }
}

// --- Migration / sweep of the legacy global wallet into packs -----------------

export type MigrateOutcomeKind = 'migrated' | 'swept' | 'noop' | 'no-target' | 'error';
export type MigrateOutcome = { kind: MigrateOutcomeKind; moved: Record<string, number> };

/** The slug with the greatest lastReviewedAt in loadAllProgress(), ties broken by
 *  the smallest slug. Falls back to loadActiveDeckSlug(), then null. Never throws;
 *  a storage error at any step falls through to the next fallback. */
async function mostRecentlyStudiedSlug(): Promise<string | null> {
  try {
    const progress = await loadAllProgress();
    let bestSlug: string | null = null;
    let bestAt = 0;
    for (const [slug, cards] of Object.entries(progress)) {
      let maxAt = 0;
      for (const card of cards) {
        const at =
          typeof card?.lastReviewedAt === 'number' && Number.isFinite(card.lastReviewedAt) && card.lastReviewedAt > 0
            ? card.lastReviewedAt
            : 0;
        if (at > maxAt) maxAt = at;
      }
      if (maxAt <= 0) continue;
      if (maxAt > bestAt || (maxAt === bestAt && (bestSlug == null || slug < bestSlug))) {
        bestAt = maxAt;
        bestSlug = slug;
      }
    }
    if (bestSlug != null) return bestSlug;
  } catch {
    // fall through to the active-deck fallback
  }
  try {
    const active = await loadActiveDeckSlug();
    if (active) return active;
  } catch {
    // fall through to null
  }
  return null;
}

/** The slug with the largest weight, ties broken by the smallest slug. Only called
 *  when weights is non-empty. */
function largestWeightSlug(weights: Record<string, number>): string {
  let bestSlug = '';
  let bestW = -1;
  for (const [slug, w] of Object.entries(weights)) {
    if (w > bestW || (w === bestW && (bestSlug === '' || slug < bestSlug))) {
      bestW = w;
      bestSlug = slug;
    }
  }
  return bestSlug;
}

/**
 * Writes the pack shares and (optionally) the migratedAtMs flag, THEN zeroes the
 * legacy wallet -- in that order, under the lock.
 *
 * Write order is the whole safety story. The record write (1) lands the new pack
 * balances and, for a first migration, migratedAtMs; the legacy zero (2) lands
 * second. A kill between (1) and (2) leaves migratedAtMs set with a non-zero
 * legacy balance, which the next call replays as a SWEEP -- double-granting at
 * most 65 pulls in the user's favour. The other order would lose the user's
 * earned balance on a kill, which must never happen: an over-grant is recoverable
 * (and small), a vanished balance is not.
 */
async function writeSharesThenZeroLegacy(
  shares: Record<string, number>,
  setMigrated: boolean,
): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  await withLock(async () => {
    const key = await walletsKey();
    const fresh = await readRecord(key);
    const decks = { ...fresh.decks };
    for (const [slug, amount] of Object.entries(shares)) {
      if (amount <= 0) continue;
      // Add onto the pack's existing wallet, never overwrite: anon adoption may
      // already have filled it. applyRewardToWallet keeps the 60 + 5 caps.
      const current = decks[slug] ?? zeroWallet();
      const applied = applyRewardToWallet(current, amount);
      decks[slug] = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
      const got = applied.appliedToAvailable + applied.appliedToReserve;
      if (got > 0) moved[slug] = got;
    }
    const next: DeckWalletsRecord = {
      ...fresh,
      decks,
      migratedAtMs: setMigrated ? Date.now() : fresh.migratedAtMs,
    };
    // (1) record write first.
    await AsyncStorage.setItem(key, JSON.stringify(next));
    // (2) zero the legacy wallet second. See the doc comment above for why the
    // kill window between these two writes is the safe direction.
    await saveRewardWalletState(zeroWallet());
  });
  return moved;
}

// Concurrent callers share one in-flight promise so the legacy balance is never
// split twice in one process.
let _migrating: Promise<MigrateOutcome> | null = null;

/**
 * One-time split of the legacy global balance into packs, plus a sweep of any
 * legacy balance that shows up again later. Never throws.
 */
export function migrateLegacyWalletIfNeeded(): Promise<MigrateOutcome> {
  if (_migrating) return _migrating;
  _migrating = runMigrate().finally(() => {
    _migrating = null;
  });
  return _migrating;
}

async function runMigrate(): Promise<MigrateOutcome> {
  try {
    const key = await walletsKey();
    const record = await readRecord(key);
    const legacy = await loadRewardWalletState();
    const total = legacy.availablePulls + legacy.reservePulls;

    if (record.migratedAtMs != null) {
      // Already migrated. A legacy balance here is a sweep target: one earned on
      // a 1.6.1 device, or a kill between the two migration writes replayed.
      if (total === 0) return { kind: 'noop', moved: {} };
      const target = await mostRecentlyStudiedSlug();
      if (target == null) return { kind: 'no-target', moved: {} };
      const moved = await writeSharesThenZeroLegacy({ [target]: total }, false);
      return { kind: 'swept', moved };
    }

    // Not yet migrated.
    if (total === 0) {
      // Nothing to move, but the migration IS done: mark it so later earnings on
      // this client never trigger a first-migration split.
      await withLock(async () => {
        const fresh = await readRecord(key);
        const next: DeckWalletsRecord = { ...fresh, migratedAtMs: Date.now() };
        await AsyncStorage.setItem(key, JSON.stringify(next));
      });
      return { kind: 'migrated', moved: {} };
    }

    // Proportional split by each pack's R1 ledger (entries with paidAtMs > 0).
    const weights = await countPaidEntriesBySlug();
    const target = await mostRecentlyStudiedSlug();
    const W = Object.values(weights).reduce((sum, w) => sum + w, 0);

    const shares: Record<string, number> = {};
    if (W > 0) {
      let allocated = 0;
      for (const [slug, w] of Object.entries(weights)) {
        const share = Math.floor((total * w) / W);
        if (share > 0) shares[slug] = share;
        allocated += share;
      }
      const remainder = total - allocated;
      if (remainder > 0) {
        const remTarget = target ?? largestWeightSlug(weights);
        shares[remTarget] = (shares[remTarget] ?? 0) + remainder;
      }
    } else {
      // No pack has a paid ledger entry: everything goes to the target. With no
      // target, leave the legacy wallet untouched and the flag unset -- retried
      // on the next call.
      if (target == null) return { kind: 'no-target', moved: {} };
      shares[target] = total;
    }

    const moved = await writeSharesThenZeroLegacy(shares, true);
    return { kind: 'migrated', moved };
  } catch {
    return { kind: 'error', moved: {} };
  }
}

/**
 * Adopts the anonymous-period pack wallets into the account at sign-in. Field
 * names deliberately differ from AnonWalletAdoption so the two never collide when
 * merged in drawStateSync. Never throws.
 *
 * For each anon pack, adds available + reserve into the account's pack via
 * applyRewardToWallet (caps apply; overflow is counted as dropped). Unions the
 * anon bootstrap marks into the account (account value wins). Then rewrites the
 * anon record with decks:{} but keeps the anon bootstrappedAtMs and migratedAtMs,
 * so a later signed-out period cannot bootstrap the same packs again.
 *
 * Write order: account record first, anon record second. A kill between them
 * replays the add; that bounded over-grant is the same caveat as adoptAnonRewardWallet.
 */
export async function adoptAnonDeckWallets(): Promise<{
  deckWalletDecks: number;
  deckPullsAdded: number;
  deckPullsDropped: number;
}> {
  const result = { deckWalletDecks: 0, deckPullsAdded: 0, deckPullsDropped: 0 };
  try {
    const userKey = await walletsKey();
    // Signed out: the current partition IS the anon partition, nothing to do.
    if (userKey.startsWith(ANON_USER_SCOPE_PREFIX)) return result;

    const anonKey = `${ANON_USER_SCOPE_PREFIX}${DECK_WALLETS_KEY}`;
    await withLock(async () => {
      const anonRaw = await AsyncStorage.getItem(anonKey);
      if (anonRaw == null) return; // nothing to adopt
      const anonRecord = parseRecord(anonRaw);
      const account = await readRecord(userKey);

      const decks = { ...account.decks };
      for (const [slug, w] of Object.entries(anonRecord.decks)) {
        result.deckWalletDecks += 1;
        const pulls = w.availablePulls + w.reservePulls;
        if (pulls > 0) {
          const current = decks[slug] ?? zeroWallet();
          const applied = applyRewardToWallet(current, pulls);
          decks[slug] = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls };
          result.deckPullsAdded += applied.appliedToAvailable + applied.appliedToReserve;
          result.deckPullsDropped += applied.dropped;
        }
      }

      // Union bootstrap marks, account value wins when both have one.
      const bootstrappedAtMs = { ...anonRecord.bootstrappedAtMs, ...account.bootstrappedAtMs };
      const rebootstrappedAtMs = { ...anonRecord.rebootstrappedAtMs, ...account.rebootstrappedAtMs };
      const nextAccount: DeckWalletsRecord = {
        ...account,
        decks,
        bootstrappedAtMs,
        ...(Object.keys(rebootstrappedAtMs).length > 0 ? { rebootstrappedAtMs } : {}),
      };
      await AsyncStorage.setItem(userKey, JSON.stringify(nextAccount));

      // Anon record: drain the pack pulls but keep the bootstrap marks and the
      // migration flag, so a later signed-out period cannot re-bootstrap or
      // re-migrate the same packs.
      const nextAnon: DeckWalletsRecord = {
        migratedAtMs: anonRecord.migratedAtMs,
        decks: {},
        bootstrappedAtMs: anonRecord.bootstrappedAtMs,
        ...(anonRecord.rebootstrappedAtMs ? { rebootstrappedAtMs: anonRecord.rebootstrappedAtMs } : {}),
      };
      await AsyncStorage.setItem(anonKey, JSON.stringify(nextAnon));
    });
  } catch {
    // Never throw: adoption must not fail sign-in.
  }
  return result;
}

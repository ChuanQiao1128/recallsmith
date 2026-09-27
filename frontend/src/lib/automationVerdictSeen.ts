// src/lib/automationVerdictSeen.ts
//
// Which drafts' automatic verdict this person has already seen on the
// Automation page (D07 frontend-console-25, automation-4). The dry-run shadow
// agreement counts a decision as blind only when the verdict was not shown
// before it, and the review queue says so with `verdictShown` on the accept or
// reject. Revealing a hidden verdict in the Decisions tab or the decision
// drawer is recorded here, so a later decision in the review queue sends
// `verdictShown: true` instead of being counted as blind.
//
// Kept in memory and mirrored to localStorage, which every tab of the origin
// shares (E05 frontend-console-32, N5): a reveal in one tab is known to a
// review queue opened in another tab, or after the tab was closed. Every read
// looks at the stored entry again, so a reveal another tab wrote after this
// module loaded counts too. Storage can be missing or throw (private windows,
// blocked site data): the in-memory set still drives the page, and
// `verdictSeenElsewhere` then answers "shown", because another tab may have
// shown the verdict and D01's rule is to never claim a blind decision when
// unsure.

const STORAGE_KEY = 'dc.automation.verdictSeen.v1';
/** A bound on what is kept, so the entry cannot grow without end. */
const MAX_IDS = 500;

const memory = new Set<number>();
/** The stored text last merged into `memory`, so an unchanged entry is not parsed again. */
let lastRaw: string | null = null;
/** Whether round 3's per-tab sessionStorage entry was carried over. */
let legacyMerged = false;
/** Set when storage threw on a read or a write: this browser cannot share reveals. */
let storageFailed = false;

function mergeIds(raw: string | null): void {
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // A damaged entry records nothing; the next write replaces it.
  }
  if (Array.isArray(parsed)) {
    for (const id of parsed) if (typeof id === 'number' && Number.isInteger(id) && id > 0) memory.add(id);
  }
}

/** Merges the stored entry (every tab's reveals) into memory. */
function refresh(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== lastRaw) {
      lastRaw = raw;
      mergeIds(raw);
    }
  } catch {
    storageFailed = true;
  }
  if (!legacyMerged) {
    legacyMerged = true;
    // Round 3 kept the record in this tab's sessionStorage; its reveals still count, and are shared from now on.
    const before = memory.size;
    try {
      mergeIds(window.sessionStorage.getItem(STORAGE_KEY));
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // No session storage: nothing to carry over.
    }
    if (memory.size > before) save();
  }
}

function save(): void {
  try {
    const raw = JSON.stringify([...memory].slice(-MAX_IDS));
    window.localStorage.setItem(STORAGE_KEY, raw);
    lastRaw = raw;
  } catch {
    storageFailed = true;
  }
}

/** Records that the person saw the automatic verdict of these drafts. */
export function markVerdictSeen(...draftIds: number[]): void {
  refresh();
  let changed = false;
  for (const id of draftIds) {
    if (!memory.has(id)) {
      memory.add(id);
      changed = true;
    }
  }
  if (changed) save();
}

/** Whether a reveal of this draft is recorded, in this tab or another one. The Automation page hides by this. */
export function wasVerdictSeen(draftId: number): boolean {
  refresh();
  return memory.has(draftId);
}

/**
 * Whether a decision on this draft must say the verdict was shown before it:
 * a reveal is recorded, or storage is unavailable, so a reveal in another tab
 * cannot be ruled out (N5: fall back to "shown").
 */
export function verdictSeenElsewhere(draftId: number): boolean {
  refresh();
  return storageFailed || memory.has(draftId);
}

/** Test seam: forgets every recorded reveal, in memory and in storage, and the storage failure flag. */
export function clearVerdictSeen(): void {
  memory.clear();
  lastRaw = null;
  storageFailed = false;
  legacyMerged = false;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage.
  }
}

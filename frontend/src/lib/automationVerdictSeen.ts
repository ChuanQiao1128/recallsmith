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
// Kept in memory and mirrored to sessionStorage (the tab's session), so a
// reveal survives the navigation to the review queue and a reload. Storage can
// be missing or throw (private windows, blocked site data): the in-memory set
// still works, and every access is guarded.

const STORAGE_KEY = 'dc.automation.verdictSeen.v1';
/** A bound on what is kept, so the entry cannot grow without end. */
const MAX_IDS = 500;

let seen: Set<number> | null = null;

function load(): Set<number> {
  if (seen) return seen;
  seen = new Set<number>();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'number' && Number.isInteger(id) && id > 0) seen.add(id);
    }
  } catch {
    // No storage: the in-memory set is all there is.
  }
  return seen;
}

function save(ids: Set<number>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_IDS)));
  } catch {
    // No storage: the in-memory set is all there is.
  }
}

/** Records that the person saw the automatic verdict of these drafts. */
export function markVerdictSeen(...draftIds: number[]): void {
  const ids = load();
  let changed = false;
  for (const id of draftIds) {
    if (!ids.has(id)) {
      ids.add(id);
      changed = true;
    }
  }
  if (changed) save(ids);
}

export function wasVerdictSeen(draftId: number): boolean {
  return load().has(draftId);
}

/** Test seam: forgets every recorded reveal, in memory and in storage. */
export function clearVerdictSeen(): void {
  seen = new Set<number>();
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage.
  }
}

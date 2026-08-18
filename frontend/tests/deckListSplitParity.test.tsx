// @vitest-environment jsdom
//
// Three independent instruments recording what DeckListPage produces TODAY, so
// that splitting its JSX into components can be shown to have changed nothing.
//
// They are independent on purpose, because they fail for different reasons:
//
//   B1  WHAT is on screen      sha256 of document.body.innerHTML, 11 scenarios
//   B2  WHEN React committed   the Profiler phase sequence for one script
//   B3  WHETHER memo still held the buildViewRows call count for that script
//
// A split can keep all the markup and still re-render twice as often (B2), or
// keep both and quietly recompute the row model on every keystroke (B3), or
// keep the timing and drop an attribute (B1). One instrument cannot see the
// other two's failure.
//
// ---------------------------------------------------------------------------
// TWO LIMITS OF B1, STATED RATHER THAN HIDDEN
// ---------------------------------------------------------------------------
// 1. EVERY fixture row and job uses a null timestamp, so safeDateTime renders a
//    literal em dash. Real timestamps go through toLocaleString(), whose output
//    depends on the runner's timezone and ICU build, and a hash over that would
//    be a machine fingerprint rather than a fact about the page. The formatted
//    path is covered by tests/deckListManifest.test.ts instead.
// 2. A hash says "different" without saying how, so each scenario also records
//    its exact byte length. That does not add coverage — the hash already
//    implies it — it makes the failure legible: "11220 -> 11189" points at a
//    dropped attribute, while two hex strings point at nothing.
//
// The hashes were MEASURED against the unmodified page, and verified stable
// across two separate vitest processes before being written down. They are
// hard-coded here rather than written to a generated file for one reason: a
// generated baseline heals itself on the run after it breaks, so it can only
// ever catch a change that someone is already watching for.
//
// The one toMatchFileSnapshot below is DIAGNOSTIC ONLY and deliberately not
// load-bearing: it writes itself out when the file is missing, so as a gate it
// would pass on a fresh checkout no matter what the page rendered. It exists so
// that when a hash does break, `git diff` on the snapshot shows the markup.
//
// ---------------------------------------------------------------------------
// THE FOURTH GRID CELL DOES NOT EXIST
// ---------------------------------------------------------------------------
// {super_admin, editor} x {paginated, legacy} suggests four scenarios, but
// useDeckPagination seeds listMode with `superAdmin ? 'paginated' : 'legacy'`
// and only loadPagedFirst ever changes it. An editor therefore cannot reach
// paginated mode at all, and a "editor + paginated" fixture would be testing a
// state no session can produce. The three reachable cells are S1/S2/S3.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { Deck } from '../src/types/deck';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

// B3's instrument. The REAL buildViewRows is called through, so this changes
// nothing the other two instruments observe — it only counts.
const rowsSpy = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/features/deckList/deckListRows', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/deckList/deckListRows')>();
  return {
    ...actual,
    buildViewRows: (...args: Parameters<typeof actual.buildViewRows>) => {
      rowsSpy.count += 1;
      return actual.buildViewRows(...args);
    },
  };
});

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
  deleteDeck: vi.fn(),
  publishDeck: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

const SLUGS = ['alpha-deck', 'beta-deck', 'gamma-deck'];

function item(slug: string, id: number): AdminDeckListItem {
  return {
    slug,
    title: `Title ${slug}`,
    id,
    deckType: 2,
    tier: null,
    availability: null,
    totalCards: 4,
    version: 1,
    updatedAtMs: null,
    latestBuildId: 'b1',
  };
}

function fullPage() {
  return ok<AdminDecksPage>({
    items: SLUGS.map((s, i) => item(s, 10 + i)),
    nextCursor: null,
    hasMore: false,
  });
}

function emptyPage() {
  return ok<AdminDecksPage>({ items: [], nextCursor: null, hasMore: false });
}

function legacyDecks() {
  return ok<Deck[]>(
    SLUGS.map((s, i) => ({
      id: 10 + i,
      slug: s,
      title: `Title ${s}`,
      deckType: 2,
      totalCards: 4,
      updatedAt: null,
    })) as unknown as Deck[],
  );
}

function oneJob(): PublishJob {
  return {
    jobId: 'job-abcdef12',
    deckSlug: 'alpha-deck',
    status: 'SUCCESS',
    note: 'done',
    createdAt: null,
  } as unknown as PublishJob;
}

// -------------------------- recorded baselines --------------------------

interface Baseline {
  hash: string;
  bytes: number;
}

// RE-MEASURED ONCE, 2026-08-18, and this is the record of why.
//
// Nine of the eleven moved when ConsoleShell's three navigation controls became
// <Link>s inside a <nav> landmark — see src/components/console/ConsoleShell.tsx
// for the argument. That is a deliberate markup change to a component every one
// of these scenarios renders, so these hashes going red was this instrument
// working, not failing.
//
// The change was verified BEFORE the numbers were touched, by diffing the old
// recorded markup against the new: the only delta is two <button>s becoming
// <a href> inside a new <nav>, and the user pill moving after them. Nothing
// else in the page differs by one character.
//
// The two that did NOT move are the evidence that the diff was confined:
// initialLoading (147 B) and fatalErrorRetry (421 B) are the early returns,
// which never render the shell at all, and their hashes are unchanged to the
// character. editorLegacy moved by +109 B against +126 B for every super-admin
// scenario, which is exactly the Admin Management link an editor does not see.
const B1: Record<string, Baseline> = {
  // The three reachable role/mode cells.
  superAdminPaginated: { hash: 'ac1ec307f87cf5f0e187c42694f4cb85f1e24cc339f753250ae2d4738d5baf33', bytes: 11346 },
  superAdminLegacyFallback: { hash: '747ec255c12a1a4bf5b1be7ad3069f6f31a7189ea6d714801d28d7783df0e5fd', bytes: 11592 },
  editorLegacy: { hash: '81a3e47b71ee16b24a799d3c43ba6179446bd0aa37ed43c2fdb853a0cb5a4115', bytes: 8767 },
  // The two early returns, which never reach the main tree at all.
  initialLoading: { hash: 'da5e91db42c7895c31e1fba36b34c6aaeb456d4ef2efde3a425f5b5066a52974', bytes: 147 },
  fatalErrorRetry: { hash: '22809bb57f98a29737e080c405194d891a62ee389911aae33891f12b55c1c396', bytes: 421 },
  // Both halves of the empty-state ternary. These two differ by ONE WORD, and
  // the split turns that ternary into an `emptyMessage` prop — which is exactly
  // the kind of change that keeps one branch and loses the other.
  emptySearchResult: { hash: 'df44fb4505dabfe79eb4493d5fe6a8ebb2ffa7f0a0d300e5740b165e35fb767d', bytes: 5330 },
  emptyWithNoQuery: { hash: '39bc473d68c93b6058ae204e70f1c32438d9ee4982f54cf64de18d983e72b6f4', bytes: 5320 },
  // The three banners/panels that only appear in one state each.
  manifestErrorBanner: { hash: '12a1459c8b341ecfd2c3e4e8b801078739ef998494bd1c06fd28e9b325f7493b', bytes: 11844 },
  publishJobsTab: { hash: 'e35439ad985a03b5c42ee92838c5f9e6f958c608d8351efb6cf50d7b672e6890', bytes: 4229 },
  pollFailureBanner: { hash: '0de61b70fff301afc550ded6f0d569b49ab62e1c55e6ca1f77b97acfe561c9e8', bytes: 12231 },
  // A row mid-publish, so the pending markup is inside a hash too.
  publishingRow: { hash: '3ae183dc00937a0fecca0e472f66c7671ecdba95f23b1f6860db61acab55ea68', bytes: 11362 },
};

// B2: one Profiler onRender entry per commit of the profiled subtree.
const B2_AFTER_MOUNT = ['mount', 'update'];
const B2_AFTER_SEARCH = ['mount', 'update', 'update', 'update', 'update', 'update'];
const B2_AFTER_FILTER = [...B2_AFTER_SEARCH, 'update'];
const B2_FINAL = [...B2_AFTER_FILTER, 'update', 'update'];

// B3: buildViewRows calls at the same four checkpoints.
const B3_AFTER_MOUNT = 2;
const B3_AFTER_SEARCH = 4;
const B3_AFTER_FILTER = 5;
const B3_FINAL = 6;

// -------------------------- harness --------------------------

let timeline: string[] = [];

function mount(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <Profiler
          id="deckList"
          onRender={(_id, phase) => {
            timeline.push(phase);
          }}
        >
          <DeckListPage />
        </Profiler>
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

async function settle(n = 8): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function markup(): string {
  return document.body.innerHTML;
}

/**
 * Compare the live DOM against a recorded scenario.
 *
 * The length check runs FIRST so the failure message names the size change
 * before the hash mismatch drowns it, and the >120 floor is the anti-vacuity
 * guard: an unmounted page hashes to a stable value too, and without a floor
 * every scenario would agree with each other about nothing.
 */
function expectMarkup(name: keyof typeof B1): void {
  const html = markup();
  const recorded = B1[name];
  expect(html.length, `${name}: rendered nothing`).toBeGreaterThan(120);
  expect(html.length, `${name}: DOM size changed`).toBe(recorded.bytes);
  expect(createHash('sha256').update(html).digest('hex'), `${name}: DOM content changed`).toBe(
    recorded.hash,
  );
}

/** Click the button whose trimmed text is exactly `label`, within `root`. */
async function clickByText(root: ParentNode, label: string): Promise<void> {
  const button = Array.from(root.querySelectorAll('button')).find(
    b => (b.textContent ?? '').trim() === label,
  );
  expect(button, `no button labelled ${label}`).not.toBeUndefined();
  await act(async () => {
    fireEvent.click(button as HTMLButtonElement);
  });
}

function rowFor(slug: string): HTMLElement {
  const row = Array.from(document.querySelectorAll('tbody tr')).find(r =>
    (r.textContent ?? '').includes(slug),
  );
  expect(row, `no row for ${slug}`).not.toBeUndefined();
  return row as HTMLElement;
}

beforeEach(() => {
  signOut();
  timeline = [];
  rowsSpy.count = 0;
  vi.useFakeTimers();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(fullPage());
  api.fetchDecks.mockResolvedValue(ok<Deck[]>([]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
  api.publishDeck.mockResolvedValue(ok({ jobId: 'job-1' }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
  localStorage.clear();
});

// -------------------------- B1 --------------------------

describe('B1: the markup each state produces', () => {
  it('S1 super_admin on the paginated path', async () => {
    signInAsSuperAdmin();
    mount();
    await settle();
    expectMarkup('superAdminPaginated');
    // Diagnostic only — see the header. Never the gate.
    await expect(markup()).toMatchFileSnapshot('./__snapshots__/deckListSuperAdminPaginated.html');
  });

  it('S2 super_admin after the paginated endpoint refused', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(refused<AdminDecksPage>('FORBIDDEN', 'no'));
    api.fetchDecks.mockResolvedValue(legacyDecks());
    mount();
    await settle();
    expectMarkup('superAdminLegacyFallback');
  });

  it('S3 an editor, who is always on the legacy path', async () => {
    signInAsEditor();
    api.fetchDecks.mockResolvedValue(legacyDecks());
    mount();
    await settle();
    expectMarkup('editorLegacy');
  });

  it('S4 the initial loading screen', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockReturnValue(new Promise(() => {}));
    mount();
    await settle(2);
    expect(document.body.textContent).toBe('Loading console…');
    expectMarkup('initialLoading');
  });

  it('S5 the fatal error screen with its Retry', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(refused<AdminDecksPage>('SERVER_ERROR', 'warehouse down'));
    mount();
    await settle();
    expect(document.body.textContent).toBe('Failed to load deckswarehouse downRetry');
    expectMarkup('fatalErrorRetry');
  });

  it('S6 a search that matched nothing', async () => {
    signInAsSuperAdmin();
    mount();
    await settle();
    api.fetchAdminDecksPage.mockResolvedValue(emptyPage());
    fireEvent.change(document.querySelector('input') as HTMLInputElement, {
      target: { value: 'zzz-nothing' },
    });
    await advance(300);
    await settle();
    expect(document.body.textContent).toContain('No decks match your search.');
    expectMarkup('emptySearchResult');
  });

  it('S11 an empty list with the search box untouched', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(emptyPage());
    mount();
    await settle();
    // The other half of the ternary. One word apart from S6, and the two hashes
    // differ, which is the whole reason both are here.
    expect(document.body.textContent).toContain('No decks match your filters.');
    expectMarkup('emptyWithNoQuery');
  });

  it('S7 the manifest sync error banner', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(refused<AdminDecksPage>('FORBIDDEN', 'no'));
    api.fetchAdminManifest.mockResolvedValue(refused('S3', 'manifest.json unreadable'));
    api.fetchDecks.mockResolvedValue(legacyDecks());
    mount();
    await settle();
    expectMarkup('manifestErrorBanner');
  });

  it('S8 the publish jobs tab', async () => {
    signInAsSuperAdmin();
    api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([oneJob()]));
    mount();
    await settle();
    await clickByText(document, 'Publish Jobs');
    await settle();
    expectMarkup('publishJobsTab');
  });

  it('S9 a row mid-publish', async () => {
    signInAsSuperAdmin();
    api.publishDeck.mockReturnValue(new Promise(() => {}));
    mount();
    await settle();
    await clickByText(rowFor('beta-deck'), 'Publish');
    await settle();
    await clickByText(document.querySelector('[role="dialog"]') as HTMLElement, 'Publish');
    await settle();
    // Exactly the middle row is pending; the hash carries the rest.
    expect(
      Array.from(document.querySelectorAll('tbody tr')).map(r =>
        (r.textContent ?? '').includes('Publishing…'),
      ),
    ).toEqual([false, true, false]);
    expectMarkup('publishingRow');
  });

  it('S10 the publish-jobs poll failure banner', async () => {
    signInAsSuperAdmin();
    api.fetchPublishJobs.mockResolvedValue(refused<PublishJob[]>('UPSTREAM', 'jobs upstream is down'));
    mount();
    await settle();
    expectMarkup('pollFailureBanner');
  });

  it('the recorded scenarios are all distinct', () => {
    // Anti-vacuity for the table itself: eleven entries that accidentally
    // shared one hash would let a scenario be silently swapped for another.
    const hashes = Object.values(B1).map(b => b.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes).toHaveLength(11);
  });
});

// -------------------------- B2 and B3 --------------------------

describe('B2/B3: commit timing and memo behaviour over one scripted session', () => {
  it('replays mount, search, filter and publish with the recorded shape', async () => {
    signInAsSuperAdmin();

    mount();
    await settle();
    expect(timeline, 'commits after mount').toEqual(B2_AFTER_MOUNT);
    expect(rowsSpy.count, 'buildViewRows after mount').toBe(B3_AFTER_MOUNT);

    // 1. Type into the search box, then let the 300ms debounce fire.
    fireEvent.change(document.querySelector('input') as HTMLInputElement, {
      target: { value: 'abc' },
    });
    await advance(300);
    await settle();
    expect(timeline, 'commits after the debounced search').toEqual(B2_AFTER_SEARCH);
    expect(rowsSpy.count, 'buildViewRows after the debounced search').toBe(B3_AFTER_SEARCH);

    // 2. Change the status filter — client-side, no request.
    fireEvent.change(document.querySelectorAll('select')[0] as HTMLSelectElement, {
      target: { value: 'published' },
    });
    await settle();
    expect(timeline, 'commits after the status filter').toEqual(B2_AFTER_FILTER);
    expect(rowsSpy.count, 'buildViewRows after the status filter').toBe(B3_AFTER_FILTER);

    // 3. Publish the middle row and let it resolve.
    await clickByText(rowFor('beta-deck'), 'Publish');
    await settle();
    await clickByText(document.querySelector('[role="dialog"]') as HTMLElement, 'Publish');
    await settle();
    expect(timeline, 'commits at the end of the script').toEqual(B2_FINAL);
    expect(rowsSpy.count, 'buildViewRows at the end of the script').toBe(B3_FINAL);

    // Anti-vacuity for both instruments at once. A count that merely tracked
    // commits would prove no memoisation at all; it is strictly lower because
    // the memo skips the commits whose deps did not move.
    expect(timeline.length).toBeGreaterThan(3);
    expect(rowsSpy.count).toBeGreaterThan(0);
    expect(rowsSpy.count).toBeLessThan(timeline.length);
  });
});

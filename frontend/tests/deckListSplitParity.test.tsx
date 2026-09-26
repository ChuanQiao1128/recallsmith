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
//
// RE-MEASURED AGAIN, 2026-09-26, F32. Nine of the eleven moved when CFE-19 gave
// the deck search box aria-label="Search decks" (+26 B) and turned the Decks /
// Publish Jobs switcher into a real tablist: role="tablist"
// aria-label="Deck console views" on the container and role="tab"
// aria-selected="…" on each button (+112 B together). Verified BEFORE the
// numbers were touched, by word-diffing the recorded superAdminPaginated
// snapshot: the ONLY added tokens are those four attribute groups, with nothing
// removed. Every super-admin scenario that renders both controls moved by +138 B
// (26 + 112). editorLegacy has no switcher, so it moves by the search label
// alone (+26 B). publishJobsTab renders the switcher but not the filter bar, so
// it moves by the tab attributes alone (+112 B). initialLoading and
// fatalErrorRetry are still the early returns and are unchanged to the character.
const B1: Record<string, Baseline> = {
  // The three reachable role/mode cells.
  superAdminPaginated: { hash: 'bd7ce896ee264dcfb074b317e80b0a8d550d9eefdce66f33e336a9fd9505a5a6', bytes: 11484 },
  superAdminLegacyFallback: { hash: '5bca1832341285ca3c14852e361205fdcfcc5632ab43ba4f8d2d670132130f12', bytes: 11730 },
  editorLegacy: { hash: '514ac7fa6ea01bad8a28b878805e8dd15c95fbf1087f1f8895da38e9812a54b8', bytes: 8793 },
  // The two early returns, which never reach the main tree at all.
  initialLoading: { hash: 'da5e91db42c7895c31e1fba36b34c6aaeb456d4ef2efde3a425f5b5066a52974', bytes: 147 },
  fatalErrorRetry: { hash: '22809bb57f98a29737e080c405194d891a62ee389911aae33891f12b55c1c396', bytes: 421 },
  // Both halves of the empty-state ternary. These two differ by ONE WORD, and
  // the split turns that ternary into an `emptyMessage` prop — which is exactly
  // the kind of change that keeps one branch and loses the other.
  emptySearchResult: { hash: '1ae49976cc7e097fe1afbc9a7a2c90989d1c62d24650e60e3dc842d16963651d', bytes: 5468 },
  emptyWithNoQuery: { hash: '62951107210f2a2af1a16626b78da86a5869ce3e331d9df207ee8aba3120c079', bytes: 5458 },
  // The three banners/panels that only appear in one state each.
  manifestErrorBanner: { hash: '855acf09e2d102a19cba1ed6651f7be02776a8ab5efb484037b0b4c0063f7a77', bytes: 11982 },
  // F24 (2026-09-26): the Publish Jobs table gained an Error column after Status
  // (CFE-09) and a title on the Job ID cell, so this scenario's markup grew by
  // 99 B. No other scenario renders that table, so only this hash moved.
  publishJobsTab: { hash: '676605fecd38f6fcb82d2a1713b5134de9ef5f9c93217c85a4718af86afaa7a1', bytes: 4440 },
  pollFailureBanner: { hash: '3839db8b82b18e1ebcef70fd2af9d517b9f9d9b899a517c06c7c8204c1366ab0', bytes: 12369 },
  // A row mid-publish, so the pending markup is inside a hash too.
  publishingRow: { hash: '6af41038e9b8dabde2e27ece9ea025b27a7064dc1e8876a3b35fd8dcc326297d', bytes: 11500 },
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

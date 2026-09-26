// @vitest-environment jsdom
//
// The super_admin gate on DeckListPage, as a whole-surface inventory.
//
// `grep -n superAdmin src/pages/DeckListPage.tsx` returns 14 lines; ten of them
// are in the JSX. Nothing observed any of them before this file.
//
// WHY AN INVENTORY AND NOT TEN `queryBy(...).toBeNull()` ASSERTIONS. A list of
// named absences only knows about the controls someone thought to name. It is
// sharp in the direction "a control I listed appeared" and completely blind in
// the direction "a control nobody listed appeared" — which is the shape of the
// failure this file is here to catch. Splitting the JSX moves four of these
// gates into two new components; if a fifth control leaks past a gate that was
// re-spelled during the move, no hand-written absence list would mention it,
// because the list was written before the control existed on that side.
//
// Comparing the entire sorted control inventory has the opposite bias: it fails
// on ANY difference, named or not, in either direction. The cost is that a
// deliberate UI change must update two literals here, and that cost is the
// point — a gate change should not be able to land quietly.
//
// ANTI-VACUITY. Two literals that were both accidentally empty would compare
// equal to two empty inventories and pass forever, so the pair is asserted to
// be non-empty AND to differ from each other. A regression that flattened the
// two roles into one view cannot satisfy both.
//
// THREE THINGS THE INVENTORY CANNOT SEE, covered separately as G1-G3: a text
// suffix (not a control), and two panels that are unreachable under the default
// fixture, where an inventory comparison would pass by never rendering them.
//
// Written and run green against a COMPLETELY UNMODIFIED DeckListPage.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AdminDeckListItem, AdminDecksPage, PublishJob } from '../src/api/authoring';
import type { Deck } from '../src/types/deck';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut } from './support/consoleSession';
import { ConfirmDialogProvider } from '../src/components/ui/ConfirmDialog';

const api = vi.hoisted(() => ({
  fetchPublishJobs: vi.fn(),
  fetchAdminDecksPage: vi.fn(),
  fetchDecks: vi.fn(),
  fetchAdminManifest: vi.fn(),
}));

vi.mock('../src/api/authoring', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/authoring')>();
  return { ...actual, ...api };
});

const { DeckListPage } = await import('../src/pages/DeckListPage');

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
    latestBuildId: 'build-1',
  };
}

function legacyDeck(slug: string, id: number): Deck {
  return { id, slug, title: `Title ${slug}`, deckType: 2, totalCards: 4 } as Deck;
}

/**
 * Every interactive control on the page, as `tag:label`.
 *
 * The label joins textContent, aria-label and placeholder rather than picking
 * the first non-empty one, so a control cannot change identity by gaining or
 * losing an accessible name while keeping its text. A <select> contributes its
 * options' text, which means changing the filter options also trips this — that
 * is wanted, not tolerated: the option lists are part of the surface a role
 * gets.
 */
function inventory(): string[] {
  const out: string[] = [];
  // `a[href]` joined the selector when ConsoleShell's navigation controls became
  // <Link>s. Without it those two controls would have dropped out of the census
  // silently, and "an editor does not get Admin Management" — one of the eight
  // differences this file exists to record — would have become a statement
  // about a control that no longer exists in any role. The tag is part of the
  // recorded identity, so the change shows up as a:Admin Management rather than
  // as a disappearance.
  document.querySelectorAll('button, summary, select, input, a[href]').forEach(el => {
    const parts = [
      (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      el.getAttribute('aria-label') ?? '',
      el.getAttribute('placeholder') ?? '',
    ].filter(Boolean);
    out.push(`${el.tagName.toLowerCase()}:${parts.join('|') || '(unlabelled)'}`);
  });
  return out.sort();
}

// Measured against the unmodified page, not hand-written. The two `button:4`
// entries are the per-row card-count buttons (totalCards: 4); "Content
// Intelligence" and "Sign out" come from ConsoleShell, "Admin Management" is
// ConsoleShell's own super-admin control.
//
// Re-measured once, when ConsoleShell's two navigation controls here became
// <Link>s: `button:Content Intelligence` and `button:Admin Management` are now
// `a:...`. Nothing else in either list moved — `button:Decks` is the page's own
// tab switcher, not a link, and it is unchanged.
const SUPER_ADMIN_CONTROLS = [
  'a:Admin Management',
  'a:Content Intelligence',
  'button:4',
  'button:4',
  'button:Cards',
  'button:Cards',
  'button:Decks',
  'button:Delete',
  'button:Delete',
  'button:Edit',
  'button:Edit',
  'button:New Deck',
  'button:Preview',
  'button:Preview',
  'button:Publish',
  'button:Publish',
  'button:Publish Jobs',
  'button:Refresh',
  'button:Sign out',
  'input:Search by slug or title...',
  'select:All StatusPublishedNeeds PublishUnpublished|Filter by status',
  'select:All TypesStarterPaid|Filter by type',
];

// The difference is exactly eight controls: the two tab-switcher buttons
// (Decks / Publish Jobs), New Deck, two Publish, two Delete, and ConsoleShell's
// Admin Management. Nothing else changes between the roles.
const EDITOR_CONTROLS = [
  'a:Content Intelligence',
  'button:4',
  'button:4',
  'button:Cards',
  'button:Cards',
  'button:Edit',
  'button:Edit',
  'button:Preview',
  'button:Preview',
  'button:Refresh',
  'button:Sign out',
  'input:Search by slug or title...',
  'select:All StatusPublishedNeeds PublishUnpublished|Filter by status',
  'select:All TypesStarterPaid|Filter by type',
];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signOut();
  api.fetchPublishJobs.mockResolvedValue(ok<PublishJob[]>([]));
  api.fetchAdminDecksPage.mockResolvedValue(
    ok<AdminDecksPage>({
      items: [item('alpha-deck', 1), item('beta-deck', 2)],
      nextCursor: null,
      hasMore: false,
    }),
  );
  api.fetchDecks.mockResolvedValue(ok<Deck[]>([legacyDeck('alpha-deck', 1), legacyDeck('beta-deck', 2)]));
  api.fetchAdminManifest.mockResolvedValue(ok({ manifest: { Decks: [] } }));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  signOut();
  localStorage.clear();
});

async function mountConsole(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmDialogProvider>
        <DeckListPage />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await screen.findByText('alpha-deck', {}, { timeout: 2000 });
}

describe('the control inventory each role is given', () => {
  it('a super_admin sees exactly the recorded set', async () => {
    signInAsSuperAdmin();
    await mountConsole();
    expect(inventory()).toEqual(SUPER_ADMIN_CONTROLS);
  });

  it('an editor sees exactly the recorded set, and it is strictly smaller', async () => {
    signInAsEditor();
    await mountConsole();
    expect(inventory()).toEqual(EDITOR_CONTROLS);
    // Every editor control is also a super_admin control: the gate only ever
    // removes. A gate that swapped one control for another would pass the
    // equality above and fail here.
    for (const control of EDITOR_CONTROLS) {
      expect(SUPER_ADMIN_CONTROLS).toContain(control);
    }
  });

  it('the two recorded sets are non-empty and genuinely different', () => {
    // Anti-vacuity. Without this, two empty literals would make both cases
    // above pass against a page that rendered nothing at all.
    expect(EDITOR_CONTROLS.length).toBeGreaterThan(5);
    expect(SUPER_ADMIN_CONTROLS.length).toBeGreaterThan(EDITOR_CONTROLS.length);
    expect(SUPER_ADMIN_CONTROLS).not.toEqual(EDITOR_CONTROLS);
  });
});

describe('G1: the user label states the role', () => {
  it('says super_admin for one and editor for the other', async () => {
    signInAsSuperAdmin();
    await mountConsole();
    expect(document.body.textContent).toContain(' · super_admin');
    expect(document.body.textContent).not.toContain(' · editor');

    cleanup();
    signOut();
    signInAsEditor();
    await mountConsole();
    expect(document.body.textContent).toContain(' · editor');
    expect(document.body.textContent).not.toContain(' · super_admin');
  });
});

describe('G2: the raw-manifest developer panel', () => {
  // This panel is gated on `superAdmin && manifestState.raw !== null`, and those
  // two conditions pull in opposite directions: raw is only ever set by loadAll,
  // and a super_admin does not call loadAll on the happy path — they start in
  // paginated mode. The one production route that satisfies both is a
  // super_admin whose paginated endpoint refuses, which falls back to legacy.
  //
  // (An earlier reading of this gate held that the panel was reachable "only
  // when an editor takes the legacy load". That cannot be: an editor has
  // superAdmin false, so the left half is false no matter what raw holds. The
  // editor case below is the CONTROL, and it is the assertion that a mutation
  // to this gate actually dies on.)
  it('is shown to a super_admin who fell back to the legacy load', async () => {
    signInAsSuperAdmin();
    api.fetchAdminDecksPage.mockResolvedValue(refused<AdminDecksPage>('FORBIDDEN', 'not permitted'));
    await mountConsole();

    const summaries = Array.from(document.querySelectorAll('summary')).map(s => s.textContent);
    expect(summaries).toEqual(['[Developer] Inspect Raw S3 manifest.json']);
    // The fallback logs a warning by design; asserting it keeps this case
    // honest about which path it took.
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('is hidden from an editor, who never loads the manifest at all', async () => {
    signInAsEditor();
    await mountConsole();

    // Since F24 an editor skips the super_admin-only manifest entirely, so `raw`
    // never leaves null. The role gate would hide the panel on its own, but the
    // panel must stay hidden either way.
    expect(api.fetchAdminManifest).not.toHaveBeenCalled();
    expect(document.querySelectorAll('summary')).toHaveLength(0);
  });
});

describe('G3: the publish-jobs polling banner', () => {
  it('is shown to a super_admin when the poll fails', async () => {
    signInAsSuperAdmin();
    api.fetchPublishJobs.mockResolvedValue(refused<PublishJob[]>('UPSTREAM', 'jobs upstream is down'));
    await mountConsole();

    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(a => a.textContent ?? '');
    expect(alerts.some(t => t.includes('Publish jobs are not refreshing'))).toBe(true);
    expect(alerts.some(t => t.includes('jobs upstream is down'))).toBe(true);
  });

  it('is hidden from an editor, who does not poll publish jobs at all', async () => {
    signInAsEditor();
    api.fetchPublishJobs.mockResolvedValue(refused<PublishJob[]>('UPSTREAM', 'jobs upstream is down'));
    await mountConsole();

    // Since F24 the mount poll is super_admin-only, so an editor never issues the
    // request and the banner has nothing to render. The JSX still gates the
    // banner on superAdmin too, so both guards agree.
    expect(api.fetchPublishJobs).not.toHaveBeenCalled();
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map(a => a.textContent ?? '');
    expect(alerts.some(t => t.includes('Publish jobs are not refreshing'))).toBe(false);
  });
});

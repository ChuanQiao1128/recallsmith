// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from './support/routerProbe';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signOut, TEST_EDITOR_SUB } from './support/consoleSession';
import { releaseFixture } from './support/contentReleaseFixtures';
import { prepareReleaseAction } from '../src/lib/contentRelease';
import type { ReleaseSession } from '../src/types/contentRelease';

const api = vi.hoisted(() => ({ fetchReleaseSnapshot: vi.fn(), fetchReleaseAction: vi.fn(), sendReleaseAction: vi.fn(), fetchCardsByDeck: vi.fn() }));
vi.mock('../src/api/contentRelease', () => ({ fetchReleaseSnapshot: api.fetchReleaseSnapshot, fetchReleaseAction: api.fetchReleaseAction, sendReleaseAction: api.sendReleaseAction }));
vi.mock('../src/api/authoring', () => ({ fetchCardsByDeck: api.fetchCardsByDeck }));
const { ContentReleasePage } = await import('../src/pages/ContentReleasePage');
const key = `aws-basics-release-v1:${TEST_EDITOR_SUB}`;
function store(session: ReleaseSession) { sessionStorage.setItem(key, JSON.stringify(session)); }
function importedSession() {
  const fixture = releaseFixture();
  fixture.session.actions.import = { ...prepareReleaseAction(fixture.session, 'import', 'import'), outcome: 'confirmed', result: ok({ editingSnapshot: fixture.snapshot.editingSnapshot }) };
  fixture.session.verifiedSnapshot = fixture.snapshot;
  return fixture;
}
function reviewedSession() {
  const fixture = importedSession();
  fixture.session.actions.review = { ...prepareReleaseAction(fixture.session, 'review', 'review'), outcome: 'confirmed', result: ok({ receiptId: 'original-receipt', editingSnapshot: fixture.snapshot.editingSnapshot }) };
  return fixture;
}
function mount() { return renderAt(<ContentReleasePage />, ['/decks/release?deckId=15']); }
beforeEach(() => { signOut(); vi.clearAllMocks(); signInAsEditor(); });
afterEach(() => { cleanup(); signOut(); });

describe('AWS Basics release operator flow', () => {
  it('denies unsigned sessions and other decks without issuing any request', () => {
    signOut(); mount();
    expect(screen.getByRole('alert').textContent).toContain('requires a signed-in Console');
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
    cleanup(); signInAsEditor();
    renderAt(<ContentReleasePage />, ['/decks/release?deckId=16']);
    expect(screen.queryByLabelText('Immutable release bundle (JSON)')).toBeNull();
  });
  it('captures and persists the entire editing backup before the first import request', async () => {
    const user = userEvent.setup(); const { bundle, snapshot } = releaseFixture();
    snapshot.backup.push({ id: 9999, stable_uid: 'deleted-card', version: 9, revision: 3, is_deleted: 1, private_column: 'preserved' });
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    api.sendReleaseAction.mockImplementation(async action => {
      const saved = JSON.parse(sessionStorage.getItem(key)!);
      expect(saved.baseline.backup.at(-1)).toMatchObject({ stable_uid: 'deleted-card', private_column: 'preserved' });
      expect(saved.actions.import.payload).toBe(action.payload);
      expect(saved.actions.import.outcome).toBe('unknown');
      return ok({ editingSnapshot: snapshot.editingSnapshot });
    });
    mount();
    const file = new File([JSON.stringify(bundle)], 'synthetic.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(bundle) });
    await user.upload(screen.getByLabelText('Immutable release bundle (JSON)'), file);
    await user.click(screen.getByRole('button', { name: 'Capture editing backup and freeze release' }));
    await screen.findByRole('button', { name: 'Download complete editing backup' });
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(1));
  });
  it('requires query before replaying an unknown import and preserves exact bytes across reload', async () => {
    const user = userEvent.setup(); const { session, snapshot } = releaseFixture(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    api.sendReleaseAction.mockResolvedValue(refused('TIMEOUT', 'Timed out; commit unknown.'));
    api.fetchReleaseAction.mockResolvedValue(refused('ACTION_NOT_FOUND', 'Action has not committed'));
    const mounted = mount();
    await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await screen.findByText(/TIMEOUT: Timed out/);
    const first = api.sendReleaseAction.mock.calls[0][0];
    expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(true);
    mounted.unmount(); mount();
    await user.click(screen.getByRole('button', { name: 'Query import action' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Retry identical import request' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(2));
    expect(api.fetchReleaseAction).toHaveBeenCalledWith(session.bundle.releaseId, 'import');
    expect(api.sendReleaseAction.mock.calls[1][0].payload).toBe(first.payload);
    expect(api.sendReleaseAction.mock.calls[1][0].actionId).toBe(first.actionId);
  });
  it('refuses receipt registration after a bilingual readback mismatch', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = importedSession(); store(session);
    cards[0].translations = null;
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchCardsByDeck.mockResolvedValue(ok(cards));
    mount(); await user.click(screen.getByRole('button', { name: 'Verify and register model review' }));
    await screen.findByText(/Readback content differs/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
  });
  it('queries a committed but unconfirmed publish, shows actual pending job/live, and replays the original action', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchCardsByDeck.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(refused('PUBLISH_DISPATCH_UNCONFIRMED', 'Publish job committed; delivery unconfirmed.'));
    const committed = ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'committed', manifestVerified: false });
    api.fetchReleaseAction.mockResolvedValue(ok({ action: { StatusCode: 200, Body: JSON.stringify(committed) }, receipts: [], jobs: [{ job_id: 'same-job', build_id: 'same-build', status: 'PENDING', content_sha256: null, error_message: null }], liveBuildId: 'original-live', manifestVerified: false }));
    mount(); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/PUBLISH_DISPATCH_UNCONFIRMED:/);
    const first = api.sendReleaseAction.mock.calls[0][0];
    expect(JSON.parse(first.payload)).toMatchObject({ actionId: 'publish', expectedLive: 'original-live', receiptId: 'original-receipt' });
    expect(screen.getByRole('button', { name: 'Retry identical publish request' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Query publish action' }));
    await screen.findByText(/Committed publish action found/);
    expect(screen.getByText(/"PENDING"/, { exact: false }).textContent).toContain('same-job');
    await user.click(screen.getByRole('button', { name: 'Retry identical publish request' }));
    await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(2));
    expect(api.sendReleaseAction.mock.calls[1][0].payload).toBe(first.payload);
    expect(api.fetchReleaseSnapshot).toHaveBeenCalledTimes(2);
  });
  it('blocks a new publish after a concurrent live change without rebasing its initial baseline', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok({ ...snapshot, deck: { ...snapshot.deck, live_build_id: 'concurrent-live' } })); api.fetchCardsByDeck.mockResolvedValue(ok(cards));
    mount(); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/cannot rebase/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!).baseline.deck.live_build_id).toBe('original-live');
  });
});

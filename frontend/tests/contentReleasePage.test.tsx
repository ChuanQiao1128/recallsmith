// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAt } from './support/routerProbe';
import { ok, refused } from './support/apiResult';
import { signInAsEditor, signInAsSuperAdmin, signOut, TEST_EDITOR_SUB, TEST_ADMIN_SUB } from './support/consoleSession';
import { releaseFixture } from './support/contentReleaseFixtures';
import { prepareReleaseAction } from '../src/lib/contentRelease';
import type { ReleaseSession } from '../src/types/contentRelease';

const api = vi.hoisted(() => ({ fetchReleaseSnapshot: vi.fn(), fetchReleaseAction: vi.fn(), sendReleaseAction: vi.fn(), fetchReleaseCards: vi.fn() }));
vi.mock('../src/api/contentRelease', () => ({ fetchReleaseSnapshot: api.fetchReleaseSnapshot, fetchReleaseAction: api.fetchReleaseAction, sendReleaseAction: api.sendReleaseAction, fetchReleaseCards: api.fetchReleaseCards }));
const { ContentReleasePage } = await import('../src/pages/ContentReleasePage');
const key = `aws-basics-release-v1:${TEST_EDITOR_SUB}`;
function store(session: ReleaseSession) { sessionStorage.setItem(key, JSON.stringify(session)); }
function importedSession() {
  const fixture = releaseFixture();
  fixture.session.actions.import = { ...prepareReleaseAction(fixture.session, 'import', 'import'), outcome: 'confirmed', reconciled: true, result: ok({ editingSnapshot: fixture.snapshot.editingSnapshot }) };
  fixture.session.verifiedSnapshot = fixture.snapshot;
  return fixture;
}
function reviewedSession() {
  const fixture = importedSession();
  fixture.session.actions.review = { ...prepareReleaseAction(fixture.session, 'review', 'review'), outcome: 'confirmed', reconciled: true, result: ok({ receiptId: 'original-receipt', editingSnapshot: fixture.snapshot.editingSnapshot, publishSnapshot: fixture.snapshot.publishSnapshot }) };
  return fixture;
}
function mount() { return renderAt(<ContentReleasePage />, ['/decks/release?deckId=15']); }
async function reconcile(user: ReturnType<typeof userEvent.setup>, session: ReleaseSession, kinds: Array<'import' | 'review'>) {
  api.fetchReleaseAction.mockImplementation(async (_release, kind: 'import' | 'review') => ok({ action: { StatusCode: 200, Body: JSON.stringify(session.actions[kind]!.result) }, receipts: [], jobs: [], liveBuildId: 'original-live', manifestVerified: false }));
  for (const kind of kinds) { await user.click(screen.getByRole('button', { name: `Query ${kind} action` })); await screen.findByText(new RegExp(`Committed ${kind} action found`)); }
}
beforeEach(() => { signOut(); vi.resetAllMocks(); signInAsEditor(); });
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
    snapshot.backup.push({ ...structuredClone(snapshot.backup[0]), id: 9999, stable_uid: 'deleted-card', order_in_deck: 9999, version: 9, revision: 3, is_deleted: 1, private_column: 'preserved' });
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    api.sendReleaseAction.mockImplementation(async action => {
      const saved = JSON.parse(sessionStorage.getItem(key)!);
      expect(saved.baselineInventory.editingSnapshot).toBe(snapshot.editingSnapshot);
      expect(saved.baselineInventory.rows.at(-1)).toMatchObject({ id: 9999, stableUid: 'deleted-card', orderInDeck: 9999, version: 9, revision: 3, isDeleted: 1 });
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
    expect(api.fetchReleaseAction).toHaveBeenCalledWith(session.bundle.releaseId, 'import', TEST_EDITOR_SUB);
    expect(api.sendReleaseAction.mock.calls[1][0].payload).toBe(first.payload);
    expect(api.sendReleaseAction.mock.calls[1][0].actionId).toBe(first.actionId);
  });
  it('refuses receipt registration after a bilingual readback mismatch', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = importedSession(); store(session);
    cards[0].translations = null;
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    mount(); await reconcile(user, session, ['import']); await user.click(screen.getByRole('button', { name: 'Verify and register model review' }));
    await screen.findByText(/Readback content differs/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
  });
  it('queries a committed but unconfirmed publish, shows actual pending job/live, and replays the original action', async () => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession(); store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(refused('PUBLISH_DISPATCH_UNCONFIRMED', 'Publish job committed; delivery unconfirmed.'));
    const committed = ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'committed', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot });

    mount(); await reconcile(user, session, ['import', 'review']); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/PUBLISH_DISPATCH_UNCONFIRMED:/);
    const first = api.sendReleaseAction.mock.calls[0][0];
    expect(JSON.parse(first.payload)).toMatchObject({ actionId: 'publish', expectedLive: 'original-live', receiptId: 'original-receipt' });
    expect(screen.getByRole('button', { name: 'Retry identical publish request' }).hasAttribute('disabled')).toBe(true);
    api.fetchReleaseAction.mockResolvedValue(ok({ action: { StatusCode: 200, Body: JSON.stringify(committed) }, receipts: [], jobs: [{ job_id: 'same-job', build_id: 'same-build', status: 'PENDING', content_sha256: null, error_message: null }], liveBuildId: 'original-live', manifestVerified: false }));
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
    api.fetchReleaseSnapshot.mockResolvedValue(ok({ ...snapshot, deck: { ...snapshot.deck, live_build_id: 'concurrent-live' } })); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    mount(); await reconcile(user, session, ['import', 'review']); await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    await screen.findByText(/cannot rebase/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!).baseline.deck.live_build_id).toBe('original-live');
  });
});

describe('recovery reconciliation and ownership regressions', () => {
  it.each(['reload', 'upload'] as const)('requires actual queries after %s of confirmed import/review before dependent writes', async mode => {
    const user = userEvent.setup(); const { session, snapshot, cards } = reviewedSession();
    if (mode === 'reload') store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    mount();
    if (mode === 'upload') {
      const file = new File([JSON.stringify(session)], 'recovery.json', { type: 'application/json' });
      Object.defineProperty(file, 'text', { value: async () => JSON.stringify(session) });
      await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    }
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Verify current editing readback' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/Commit confirmed/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Publish reviewed release' }));
    expect(api.sendReleaseAction).not.toHaveBeenCalled(); expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
    await reconcile(user, session, ['import']);
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(true);
    await reconcile(user, session, ['review']);
    expect(screen.getByRole('button', { name: 'Publish reviewed release' }).hasAttribute('disabled')).toBe(false);
  });
  it('ACTION_NOT_FOUND clears historical confirmation/result/query but retains exact key and bytes', async () => {
    const user = userEvent.setup(); const { session } = importedSession(); store(session);
    api.fetchReleaseAction.mockResolvedValue(refused('ACTION_NOT_FOUND', 'Not committed'));
    mount(); await user.click(screen.getByRole('button', { name: 'Query import action' }));
    await screen.findByText(/has not committed/);
    const action = JSON.parse(sessionStorage.getItem(key)!).actions.import;
    expect(action).toMatchObject({ actionId: 'import', payload: session.actions.import!.payload, outcome: 'unknown', queried: true, reconciled: true });
    expect(action.result).toBeUndefined(); expect(action.query).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Verify and register model review' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry identical import request' }).hasAttribute('disabled')).toBe(false);
  });
  it('blocks a mounted journal after the account changes before capture/query/write', async () => {
    const user = userEvent.setup(); const { session } = releaseFixture(); store(session); mount();
    signInAsSuperAdmin(); await user.click(screen.getByRole('button', { name: 'Import 337 cards' }));
    await screen.findByText(/Signed-in subject changed/);
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled(); expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!).actions).toEqual({});
    expect(sessionStorage.getItem(`aws-basics-release-v1:${TEST_ADMIN_SUB}`)).toBeNull();
  });
  it.each(['preflight', 'write', 'query', 'readback'] as const)('discards %s results after an identity transition and performs no subsequent save/write', async step => {
    const user = userEvent.setup(); const fixture = step === 'query' || step === 'readback' ? importedSession() : releaseFixture();
    const { session, snapshot, cards } = fixture; store(session);
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot)); api.fetchReleaseCards.mockResolvedValue(ok(cards));
    api.sendReleaseAction.mockResolvedValue(ok({ editingSnapshot: snapshot.editingSnapshot }));
    mount();
    if (step === 'readback') await reconcile(user, session, ['import']);
    let resolve!: (value: unknown) => void;
    const pending = new Promise(resolvePromise => { resolve = resolvePromise; });
    if (step === 'preflight') api.fetchReleaseSnapshot.mockReturnValue(pending);
    if (step === 'write') api.sendReleaseAction.mockReturnValue(pending);
    if (step === 'query') api.fetchReleaseAction.mockReturnValue(pending);
    if (step === 'readback') api.fetchReleaseCards.mockReturnValue(pending);
    await user.click(screen.getByRole('button', { name: step === 'query' ? 'Query import action' : step === 'readback' ? 'Verify and register model review' : 'Import 337 cards' }));
    if (step === 'write') await waitFor(() => expect(api.sendReleaseAction).toHaveBeenCalledTimes(1));
    if (step === 'readback') await waitFor(() => expect(api.fetchReleaseCards).toHaveBeenCalledTimes(1));
    const priorJournal = sessionStorage.getItem(key);
    signInAsSuperAdmin();
    resolve(step === 'query' ? refused('ACTION_NOT_FOUND', 'Not committed') : step === 'readback' ? ok(cards) : ok(step === 'write' ? { editingSnapshot: snapshot.editingSnapshot } : snapshot));
    await screen.findByText(/Signed-in subject changed/);
    expect(sessionStorage.getItem(key)).toBe(priorJournal);
    expect(api.sendReleaseAction).toHaveBeenCalledTimes(step === 'write' ? 1 : 0);
    if (step === 'readback') expect(api.fetchReleaseSnapshot).toHaveBeenCalledTimes(1);
  });
  it('rejects a foreign uploaded journal without saving it', async () => {
    const user = userEvent.setup(); const { session } = releaseFixture(); session.ownerSubject = TEST_ADMIN_SUB; mount();
    const file = new File([JSON.stringify(session)], 'foreign.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(session) });
    await user.upload(screen.getByLabelText('Or restore a downloaded Console recovery journal'), file);
    await screen.findByText(/another signed-in subject/); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('blocks import when journal storage fails (original independent positive control)', async () => {
    const user = userEvent.setup(); const { session, snapshot } = releaseFixture(); store(session); mount();
    api.fetchReleaseSnapshot.mockResolvedValue(ok(snapshot));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic quota exceeded'); });
    try { await user.click(screen.getByRole('button', { name: 'Import 337 cards' })); await screen.findByText('Synthetic quota exceeded'); expect(api.sendReleaseAction).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
});

describe('reconciled receipt binds the original publish bytes', () => {
  it('refuses a recovered publish replay if the actual queried review receipt differs', async () => {
    const user = userEvent.setup(); const { session, snapshot } = reviewedSession();
    const publish = prepareReleaseAction(session, 'publish', 'publish'); session.actions.publish = publish; store(session);
    const originalBytes = publish.payload;
    session.actions.review!.result!.data!.receiptId = 'actual-different-receipt';
    mount(); await reconcile(user, session, ['import', 'review']);
    api.fetchReleaseAction.mockResolvedValue(ok({ action: { StatusCode: 200, Body: JSON.stringify(ok({ jobId: 'same-job', buildId: 'same-build', outcome: 'committed', manifestVerified: false, snapshotSha256: snapshot.publishSnapshot })) }, receipts: [], jobs: [], liveBuildId: 'original-live', manifestVerified: false }));
    await user.click(screen.getByRole('button', { name: 'Query publish action' })); await screen.findByText(/Committed publish action found/);
    await user.click(screen.getByRole('button', { name: 'Retry identical publish request' })); await screen.findByText(/differs from its frozen/);
    expect(api.sendReleaseAction).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!).actions.publish.payload).toBe(originalBytes);
    expect(api.fetchReleaseSnapshot).not.toHaveBeenCalled();
  });
});

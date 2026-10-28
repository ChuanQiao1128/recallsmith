import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchReleaseCards, fetchReleaseAction, fetchReleaseSnapshot, sendReleaseAction } from '../api/contentRelease';
import { readSessionUser } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { CARD_CLASS, H1_CLASS, H2_CLASS, INPUT_CLASS } from '../components/console/consoleStyles';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { CONSOLE_NAME } from '../lib/brand';
import { captureReleaseBackupInventory, assertActionDependencies, assertActionResult, assertFrozenAction, isConfirmedAction, assertOriginalLive, assertReleaseSnapshot, assertReplayAllowed, decodeCommittedAction, parseReleaseBundle, parseReleaseSession, prepareReleaseAction, verifyReleaseReadback } from '../lib/contentRelease';
import type { ApiResult } from '../types/api';
import type { ReleaseBundle, ReleaseKind, ReleaseSession } from '../types/contentRelease';

function dataOrThrow<T>(result: ApiResult<T>): T {
  if (!result.success || result.data === null) throw new Error(`${result.error?.code ?? 'INVALID_RESPONSE'}: ${result.error?.message ?? 'Response has no data.'}`);
  return result.data;
}
function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContentReleasePage() {
  const [params] = useSearchParams();
  const user = useMemo(() => readSessionUser(), []);
  const allowed = Boolean(user?.sub && user.groups.some(group => group === 'editor' || group === 'super_admin')) && (params.get('deckId') ?? '15') === '15';
  const storageKey = `aws-basics-release-v1:${user?.sub ?? 'no-session'}`;
  const [restored] = useState(() => {
    if (!allowed) return { session: null, error: '' };
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return { session: null, error: '' };
      const session = parseReleaseSession(raw, user!.sub!);
      return { session, error: '' };
    } catch (error) { return { session: null, error: `Saved release session could not be read. Keep its downloaded journal and reconcile before any new action. ${String(error)}` }; }
  });
  const [session, setSession] = useState<ReleaseSession | null>(restored.session);
  const [bundle, setBundle] = useState<ReleaseBundle | null>(null);
  const [restoreBlocked, setRestoreBlocked] = useState(Boolean(restored.error));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(restored.error);
  const [message, setMessage] = useState('');
  const [queryView, setQueryView] = useState<unknown>(null);

  function assertOwner(current = session) {
    const active = readSessionUser();
    if (!user?.sub || active?.sub !== user.sub || !active.groups.some(group => group === 'editor' || group === 'super_admin') || current && current.ownerSubject !== active.sub) throw new Error('Signed-in subject changed or journal belongs to another subject. Reopen this page under its owning account.');
  }
  async function owned<T>(work: () => Promise<T>, current = session): Promise<T> {
    assertOwner(current);
    const result = await work();
    assertOwner(current);
    return result;
  }
  function download(name: string, value: unknown) { assertOwner(); downloadJson(name, value); assertOwner(); }

  // A journal storage failure blocks dispatch. It must be recoverable after a lost HTTP response.
  function save(next: ReleaseSession) {
    assertOwner(next);
    const raw = JSON.stringify(next);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw) throw new Error('Could not persist the exact release journal; request was not sent.');
    assertOwner(next);
    setSession(next);
  }
  async function run(work: () => Promise<void>, recovery = false) {
    if (!allowed || busyRef.current || restoreBlocked && !recovery) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { assertOwner(); await owned(work); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function capture() {
    if (!bundle || session) return;
    const baseline = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
    assertReleaseSnapshot(baseline);
    save({ schema: 'aws-basics-console-session-v1', ownerSubject: user!.sub!, baseline, baselineInventory: captureReleaseBackupInventory(baseline), bundle, actions: {} });
    setMessage('Complete editing backup captured. The initial live build and bundle are now frozen for this release.');
  }
  async function verify(current: ReleaseSession): Promise<ReleaseSession> {
    assertOwner(current);
    if (!isConfirmedAction(current.actions.import)) throw new Error('Query and confirm import before readback.');
    const before = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
    const cards = dataOrThrow(await owned(() => fetchReleaseCards(user!.sub!), current));
    const snapshot = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
    if (current.actions.import?.result?.data?.editingSnapshot !== snapshot.editingSnapshot) throw new Error('Editing content changed since the confirmed import. The frozen release cannot adopt another editing snapshot.');
    if (before.editingSnapshot !== snapshot.editingSnapshot) throw new Error('Editing content changed during readback. Verify again before registering evidence.');
    verifyReleaseReadback(current, snapshot, cards);
    return { ...current, verifiedSnapshot: snapshot };
  }
  async function dispatch(kind: ReleaseKind, replay = false) {
    if (!session) return;
    let current = session;
    assertOwner(current);
    assertActionDependencies(current, kind);
    let action = current.actions[kind];
    if (replay) {
      if (!action) throw new Error('No frozen request to replay.');
      assertReplayAllowed(action);
      assertFrozenAction(current, action);
    } else {
      if (action) throw new Error('Action is already frozen. Query it before retrying.');
      if (kind === 'import') {
        const now = dataOrThrow(await owned(() => fetchReleaseSnapshot(user!.sub!)));
        assertOriginalLive(current, now);
        if (now.editingSnapshot !== current.baseline.editingSnapshot) throw new Error('Editing content changed since the backup. Nothing was imported.');
      } else {
        const priorSnapshot = current.verifiedSnapshot?.editingSnapshot;
        current = await owned(() => verify(current), current);
        if (kind === 'publish' && priorSnapshot !== current.verifiedSnapshot?.editingSnapshot) throw new Error('Editing content changed after the review receipt. Publishing is blocked.');
      }
      action = prepareReleaseAction(current, kind, kind);
    }
    if (!action) return;
    action = { ...action, outcome: 'unknown', queried: false, reconciled: false, result: undefined, query: undefined };
    current = { ...current, actions: { ...current.actions, [kind]: action }, ...(kind === 'import' ? { verifiedSnapshot: undefined } : {}) };
    save(current);
    const frozen = action;
    const result = await owned(() => sendReleaseAction(frozen, user!.sub!), current);
    assertActionResult(current, action, result);
    // Every failure retains its key/payload. A 503 may mean a committed job with uncertain delivery.
    const next = { ...current, actions: { ...current.actions, [kind]: { ...action, outcome: result.success ? 'confirmed' as const : 'unknown' as const, reconciled: true, result } } };
    save(next);
    if (!result.success) throw new Error(`${result.error?.code ?? 'UNKNOWN_OUTCOME'}: ${result.error?.message ?? 'No confirmed result.'} Query this action before retrying the identical request.`);
    setMessage(`${kind}: server returned ${String(result.data?.outcome ?? 'committed')}. Query the action for current job status and live build. External manifest verification is still pending.`);
  }
  async function query(kind: ReleaseKind) {
    if (!session?.actions[kind]) return;
    const action = session.actions[kind];
    assertOwner();
    const result = await owned(() => fetchReleaseAction(session.bundle.releaseId, action.actionId, user!.sub!));
    if (!result.success || !result.data) {
      if (result.error?.code !== 'ACTION_NOT_FOUND') dataOrThrow(result);
      save({ ...session, actions: { ...session.actions, [kind]: { ...action, queried: true, reconciled: true, outcome: 'unknown', result: undefined, query: undefined } } });
      setQueryView(result); setMessage('The action has not committed as of this query. Its original request and key are retained for an identical replay.'); return;
    }
    const committed = decodeCommittedAction(result.data.action);
    assertActionResult(session, action, committed);
    save({ ...session, actions: { ...session.actions, [kind]: { ...action, outcome: 'confirmed', queried: true, reconciled: true, result: committed, query: result.data } } });
    setQueryView(result.data);
    setMessage(`Committed ${kind} action found. Current live build: ${result.data.liveBuildId ?? 'none'}. manifestVerified=false. A PENDING publish can replay the identical action to deliver the same job.`);
  }

  if (!allowed) return <ConsoleShell title={CONSOLE_NAME} {...consoleNav()}><Callout tone="danger" role="alert">This release page requires a signed-in Console editor or super_admin and AWS Basics deck 15. Server authorization remains authoritative.</Callout></ConsoleShell>;
  return <ConsoleShell title={CONSOLE_NAME} subtitle="AWS Basics bilingual release" {...consoleNav()}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className={H1_CLASS}>AWS Basics release · 337 cards</h1><Link className="text-sm text-indigo-700 underline" to="/decks/cards?deckId=15">Back to AWS Basics</Link></div>
    <Callout tone="info">Load the immutable local bundle containing the existing model review. File checks and readback comparisons do not review content. The receipt records reviewedBy=codex and humanPerCardReview=false; the author submits batch authorization without asserting per-card human review.</Callout>
    {error && <Callout tone="danger" role="alert">{error}</Callout>}
    {message && <Callout tone="info" role="status">{message}</Callout>}
    {!session && <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="bundle-heading">
      <h2 id="bundle-heading" className={H2_CLASS}>1. Load bundle and capture complete editing backup</h2>
      <label className="block text-sm" htmlFor="release-bundle">Immutable release bundle (JSON)</label>
      <input id="release-bundle" className={INPUT_CLASS} type="file" accept="application/json,.json" disabled={busy || restoreBlocked} onChange={event => { const file = event.target.files?.[0]; if (!file) return; setBundle(null); void run(async () => { if (file.size > 3_000_000) throw new Error('Release bundle is too large.'); const loaded = parseReleaseBundle(await owned(() => file.text())); setBundle(loaded); setMessage(`Loaded ${loaded.cards.length} cards and local model PASS records. No content review was performed by this page.`); }); }} />
      <Button disabled={!bundle || busy || restoreBlocked} onClick={() => void run(capture)}>Capture editing backup and freeze release</Button>
      <label className="block text-sm" htmlFor="release-recovery">Or restore a downloaded Console recovery journal</label>
      <input id="release-recovery" className={INPUT_CLASS} type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (!file) return; void run(async () => { if (file.size > 10_000_000) throw new Error('Recovery journal is too large.'); save(parseReleaseSession(await owned(() => file.text()), user!.sub!)); setRestoreBlocked(false); setMessage('Original backup, frozen requests and action keys restored. Query each existing action before continuing.'); }, true); }} />
    </section>}
    {session && <>
      <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="backup-heading">
        <h2 id="backup-heading" className={H2_CLASS}>1. Frozen release and initial backup</h2>
        <p className="text-sm break-all">Release: {session.bundle.releaseId} · Main: {session.bundle.review.mainSHA}<br />Initial live build: {session.baseline.deck.live_build_id ?? 'none'}<br />Initial editing snapshot: {session.baseline.editingSnapshot}</p>
        <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void run(async () => download(`${session.bundle.releaseId}-editing-backup.json`, session.baseline))}>Download complete editing backup</Button><Button variant="outline" onClick={() => void run(async () => download(`${session.bundle.releaseId}-console-journal.json`, session))}>Download recovery journal</Button></div>
        <p className="text-sm text-slate-600">The exact bundle, backup and requests are saved in this tab. Download the journal before closing it. Existing actions cannot be replaced with new keys here.</p>
      </section>
      {(['import', 'review', 'publish'] as const).map((kind, index) => {
        const action = session.actions[kind];
        const reconciled = Object.values(session.actions).every(item => item.reconciled);
        const ready = reconciled && (kind === 'import' || kind === 'review' && isConfirmedAction(session.actions.import) || kind === 'publish' && isConfirmedAction(session.actions.import) && isConfirmedAction(session.actions.review));
        return <section key={kind} className={`${CARD_CLASS} space-y-3`} aria-labelledby={`${kind}-heading`}>
          <h2 id={`${kind}-heading`} className={H2_CLASS}>{index + 2}. {kind === 'import' ? 'Import frozen candidate' : kind === 'review' ? 'Verify full readback and register local model evidence' : 'Publish reviewed snapshot'}</h2>
          {action && <p className="text-sm break-all">Action: {action.actionId} · {!action.reconciled ? 'Recovery unreconciled — query before continuing' : action.outcome === 'unknown' ? 'Outcome unknown — query before retry' : 'Commit confirmed'}{action.result?.error ? ` · ${action.result.error.code}` : ''}</p>}
          <div className="flex flex-wrap gap-3">
            {!action && <Button disabled={busy || !ready} onClick={() => void run(() => dispatch(kind))}>{kind === 'import' ? 'Import 337 cards' : kind === 'review' ? 'Verify and register model review' : 'Publish reviewed release'}</Button>}
            {action && <Button variant="outline" disabled={busy} onClick={() => void run(() => query(kind))}>Query {kind} action</Button>}
            {action && (action.outcome === 'unknown' || kind === 'publish') && <Button variant="outline" disabled={busy || !action.queried || !ready} onClick={() => void run(() => dispatch(kind, true))}>Retry identical {kind} request</Button>}
          </div>
          {kind === 'review' && <p className="text-sm text-slate-600">All English and Chinese fields, help, source, difficulty and order must match. Every local PASS must match the current server hash, schema and revision. Policy hashes come from the current snapshot.</p>}
          {kind === 'publish' && <p className="text-sm text-slate-600">A 503 or timeout can leave a committed publish job. Query, then replay the same action if delivery is unconfirmed. Current job and live status appear below; manifestVerified remains false until external CDN verification.</p>}
        </section>;
      })}
      <section className={`${CARD_CLASS} space-y-3`} aria-labelledby="verification-heading"><h2 id="verification-heading" className={H2_CLASS}>Readback and server status</h2><Button variant="outline" disabled={busy || !isConfirmedAction(session.actions.import) || !Object.values(session.actions).every(action => action.reconciled)} onClick={() => void run(async () => { const next = await owned(() => verify(session)); save(next); setMessage('Exact 337-card readback and local model review bindings verified. No new model review was performed.'); })}>Verify current editing readback</Button><p className="text-sm">manifestVerified=false · External CDN verification is pending.</p>
        <details><summary className="cursor-pointer text-sm">Latest action query (actual jobs and live build)</summary><pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(queryView ?? Object.fromEntries(Object.entries(session.actions).map(([kind, action]) => [kind, action?.query ?? action?.result])), null, 2)}</pre></details>
        <details><summary className="cursor-pointer text-sm">Frozen complete editing backup</summary><pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(session.baseline, null, 2)}</pre></details>
      </section>
    </>}
  </ConsoleShell>;
}

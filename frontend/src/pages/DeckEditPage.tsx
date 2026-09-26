// src/pages/DeckEditPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import { useCards } from '../hooks/useCards';
import { useDeck, useUpdateDeck } from '../hooks/useDecks';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { buildDeckBody, parseDraftVersion, DRAFT_VERSION_ERROR } from '../lib/authoringBodies';
import { CONSOLE_NAME } from '../lib/brand';

import type { DeckAvailability, DeckTier } from '../types/deck';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';
import { DeckBuildsPanel } from '../components/console/DeckBuildsPanel';

type FormState = {
  // base fields
  slug: string;
  title: string;
  author: string;
  description: string;
  locale: string;
  deckType: number;
  version: string;

  // mobile/manifest fields (super_admin)
  tier: '' | DeckTier; // '' => null (infer)
  availability: DeckAvailability;
  eta: string;

  manifestOrder: string;
  totalCards: string;
  previewCards: string;
  retiredAtMs: string;
};

function toStr(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function parseNullableInt(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Must be a valid number.');
  return Math.trunc(n);
}

function effectiveTier(deckType: number, tier: '' | DeckTier): DeckTier {
  if (tier === 'free' || tier === 'premium') return tier;
  return Number(deckType) === 1 ? 'free' : 'premium';
}

/**
 * The sentence shown when the deck will not load.
 *
 * useDeck bakes in 'Deck not found.' as its own fallback when the server sends no
 * message; this page has always shown 'Failed to load deck.' in that spot, so the
 * hook's fallback is mapped back to the page's. A real server message — a
 * refusal's wording, a thrown request's message — passes through untouched.
 */
function deckLoadMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Failed to load deck.';
  return message === 'Deck not found.' ? 'Failed to load deck.' : message;
}

export function DeckEditPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const deckIdRaw = sp.get('deckId');
  const deckId = deckIdRaw ? Number(deckIdRaw) : NaN;

  // The page's own guard is stricter than useDeck's: a negative deckId is
  // refused here before any request, the way this page has always behaved. When
  // it fails, NaN is handed to the hooks so their enabled predicate skips the
  // fetch entirely.
  const invalidDeckId = !Number.isFinite(deckId) || deckId <= 0;
  const queryDeckId = invalidDeckId ? Number.NaN : deckId;

  // The deck and its card count both come through the shared cache. The cards
  // read is gated on a loaded deck, so it stays downstream of the deck fetch the
  // way the hand-rolled effect ordered them — a failed deck never fires it.
  const deckQuery = useDeck(queryDeckId);
  const cardsQuery = useCards(deckQuery.isSuccess ? queryDeckId : Number.NaN);

  const queryClient = useAppQueryClient();

  const [form, setForm] = useState<FormState>({
    slug: '',
    title: '',
    author: '',
    description: '',
    locale: 'en-US',
    deckType: 1,
    version: '1',

    tier: '',
    availability: 'live',
    eta: '',

    manifestOrder: '',
    totalCards: '',
    previewCards: '',
    retiredAtMs: '',
  });

  // The form as last saved (or as first loaded), for the unsaved-changes guard.
  // null until the deck loads, so an unloaded page is never "dirty".
  const [savedForm, setSavedForm] = useState<FormState | null>(null);

  // The write goes through react-query so a saved deck invalidates both the
  // list and this deck's own cache entry.
  const updateDeckMutation = useUpdateDeck();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  // The form is filled from the deck exactly ONCE per deck id, tracked by a ref
  // that holds the id it was filled for. A background refetch — the one the save
  // itself triggers through useUpdateDeck's invalidation, or any staleness
  // revalidation — hands useDeck new data for the same id, and without this guard
  // that data would be copied straight over whatever the user is typing.
  const initializedFor = useRef<number | null>(null);

  useEffect(() => {
    const found = deckQuery.data;
    if (!found) return;
    if (initializedFor.current === found.id) return;
    initializedFor.current = found.id;

    const loaded: FormState = {
      slug: toStr(found.slug),
      title: toStr(found.title),
      author: toStr(found.author),
      description: toStr(found.description ?? ''),
      locale: toStr(found.locale ?? 'en-US'),
      deckType: Number(found.deckType ?? 1) || 1,
      version: toStr(found.version ?? '1'),

      tier: found.tier === 'free' || found.tier === 'premium' ? found.tier : '',
      availability:
        found.availability === 'coming' || found.availability === 'retired' || found.availability === 'live'
          ? found.availability
          : 'live',
      eta: toStr(found.eta ?? ''),

      manifestOrder: found.manifestOrder != null ? String(found.manifestOrder) : '',
      totalCards: found.totalCards != null ? String(found.totalCards) : '',
      previewCards: found.previewCards != null ? String(found.previewCards) : '',
      retiredAtMs: found.retiredAtMs != null ? String(found.retiredAtMs) : '',
    };
    setForm(loaded);
    // Same snapshot as the form starts on, so the page is clean until edited.
    setSavedForm(loaded);
    setSaveError(null);
    setSaveOk(null);
  }, [deckQuery.data]);

  // Dirty once the deck has loaded and a field diverges from the last-saved
  // snapshot. Declared above every early return, as the rules of hooks require.
  const dirty = savedForm !== null && JSON.stringify(form) !== JSON.stringify(savedForm);
  const guard = useUnsavedChangesGuard(dirty);

  async function onSave(goBackAfter = false) {
    const loadedDeck = deckQuery.data;
    if (!loadedDeck) return;

    setSaving(true);
    setSaveError(null);
    setSaveOk(null);

    try {
      const slug = form.slug.trim();
      const title = form.title.trim();
      const author = form.author.trim();

      if (!slug || !title || !author) {
        setSaveError('slug / title / author are required.');
        return;
      }

      const deckType = Number(form.deckType);
      if (!Number.isFinite(deckType) || deckType <= 0) {
        setSaveError('deckType must be a valid number.');
        return;
      }

      const version = parseDraftVersion(form.version);
      if (version === null) {
        setSaveError(DRAFT_VERSION_ERROR);
        return;
      }

      const payload = {
        // buildDeckBody carries the base fields — including author, locale and
        // version, which this page collected and used to drop — and sends an
        // emptied description as '' rather than leaving the old text in the row.
        ...buildDeckBody({
          slug,
          title,
          author,
          description: form.description,
          locale: form.locale,
          deckType,
          version,
        }),
        manifestOrder: parseNullableInt(form.manifestOrder),
        availability: form.availability as DeckAvailability | null,
        tier: form.tier ? form.tier : null,
        eta: form.availability === 'coming' && form.eta.trim() ? form.eta.trim() : null,
        retiredAtMs: form.availability === 'retired' ? parseNullableInt(form.retiredAtMs) : null,
        totalCards: parseNullableInt(form.totalCards),
        previewCards: effectiveTier(deckType, form.tier) === 'premium' ? parseNullableInt(form.previewCards) : null,
      };

      const { result: res } = await updateDeckMutation.mutateAsync({
        id: loadedDeck.id,
        params: payload,
      });

      if (!res.success || !res.data) {
        setSaveError(res.error?.message ?? 'Save failed.');
        return;
      }

      setSaveOk('Saved.');
      // The form just became the saved state, so the page is clean again and the
      // guard has nothing to ask about.
      setSavedForm(form);
      // The server's copy of the deck goes straight into its cache entry, so the
      // header shows what was saved without waiting for the refetch. The form is
      // NOT re-filled from it: initializedFor already holds this id, so what the
      // user typed survives. useUpdateDeck's own invalidations still run.
      queryClient.setQueryData(QueryKeys.deck(loadedDeck.id), res.data);

      // A successful save is not a discard: allow the navigation that follows it
      // before it fires, so the guard does not ask about what we just kept.
      if (goBackAfter) {
        guard.allowNextNavigation();
        navigate('/', { replace: true });
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  function applySuggestedCounts() {
    if (!superAdmin) return;
    const count = cardsQuery.data?.length ?? 0;
    setForm(prev => ({
      ...prev,
      totalCards: String(count),
      previewCards: String(Math.min(10, count)),
    }));
  }

  const loadError = invalidDeckId
    ? 'Missing or invalid deckId.'
    : deckQuery.isError
      ? deckLoadMessage(deckQuery.error)
      : null;

  if (!invalidDeckId && deckQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-600 text-lg">Loading deck…</div>
      </div>
    );
  }

  if (loadError || !deckQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">Failed to load deck</div>
          <div className="text-sm">{loadError ?? 'Failed to load deck.'}</div>

          <button
            type="button"
            className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
            onClick={() => navigate('/')}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const deck = deckQuery.data;
  const effTier = effectiveTier(form.deckType, form.tier);

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Edit Deck"
      userLabel={
        user
          ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}`
          : '—'
      }
      superAdmin={superAdmin}
      onSignOut={handleSignOut}
      adminUsersHref={superAdmin ? '/admin/users' : undefined}
    >
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">Deck</div>
            <div className="text-lg font-semibold text-slate-900">{deck.title}</div>
            <div className="text-xs text-slate-500 font-mono">{deck.slug}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => navigate(`/decks/cards?deckId=${deck.id}`)}
            >
              View Cards
            </button>

            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => navigate('/')}
            >
              Back
            </button>
          </div>
        </div>

        {/* Cards count */}
        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-600 font-semibold">Cards in DB</div>
          {cardsQuery.isPending ? (
            <div className="text-sm text-slate-600 mt-1">Loading cards…</div>
          ) : cardsQuery.isError ? (
            <div className="text-sm text-amber-700 mt-1">
              {cardsQuery.error instanceof Error ? cardsQuery.error.message : 'Failed to load cards.'}
            </div>
          ) : (
            <div className="text-sm text-slate-800 mt-1">
              count = <span className="font-mono">{cardsQuery.data?.length ?? 0}</span>
              {superAdmin ? (
                <button
                  type="button"
                  className="ml-3 text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-white"
                  onClick={applySuggestedCounts}
                  title="Set totalCards=cardCount (and previewCards=min(10,cardCount))"
                >
                  Apply to totalCards
                </button>
              ) : null}
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-1">
            Manifest rebuild uses <code className="font-mono">decks.total_cards</code>. Keep it aligned with real cards.
          </div>
        </div>

        {/* Base fields */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Slug *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.slug}
              onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
              disabled={!superAdmin}
              title={!superAdmin ? 'Slug is locked (progress key).' : 'Slug changes are dangerous (progress key).'}
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Title *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Author *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.author}
              onChange={e => setForm(prev => ({ ...prev, author: e.target.value }))}
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Locale</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.locale}
              onChange={e => setForm(prev => ({ ...prev, locale: e.target.value }))}
              placeholder="en-US / zh-CN ..."
            />
          </label>

          <label className="block lg:col-span-2">
            <div className="text-xs text-slate-600 mb-1">Description</div>
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[88px]"
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            />
          </label>

          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Deck Type</div>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              value={form.deckType}
              onChange={e => setForm(prev => ({ ...prev, deckType: Number(e.target.value) }))}
            >
              <option value={1}>Starter (1)</option>
              <option value={2}>Paid (2)</option>
            </select>
          </label>

          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Draft Version *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              value={form.version}
              onChange={e => setForm(prev => ({ ...prev, version: e.target.value }))}
            />
            <div className="text-[11px] text-slate-500 mt-1">The draft version held in the DB, not the buildId. Bump it whenever the content changes.</div>
          </label>
        </div>

        {/* Super admin manifest fields */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Mobile / Manifest Settings</div>
              <div className="text-xs text-slate-500 mt-1">
                These fields decide what mobile sees (coming/live/retired, free/premium, counts).
              </div>
            </div>

            {!superAdmin ? <div className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-500">super_admin only</div> : null}
          </div>

          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-xs text-slate-600 mb-1">Availability *</div>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                value={form.availability}
                onChange={e => setForm(prev => ({ ...prev, availability: e.target.value as DeckAvailability }))}
                disabled={!superAdmin}
              >
                <option value="live">live</option>
                <option value="coming">coming</option>
                <option value="retired">retired</option>
              </select>
            </label>

            <label className="block">
              <div className="text-xs text-slate-600 mb-1">Tier</div>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                value={form.tier}
                onChange={e => setForm(prev => ({ ...prev, tier: e.target.value as '' | DeckTier }))}
                disabled={!superAdmin}
              >
                <option value="">Auto (infer from deckType)</option>
                <option value="free">free</option>
                <option value="premium">premium</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">
                Effective tier: <span className="font-mono">{effTier}</span>
              </div>
            </label>

            {form.availability === 'coming' ? (
              <label className="block lg:col-span-2">
                <div className="text-xs text-slate-600 mb-1">ETA (coming only)</div>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.eta}
                  onChange={e => setForm(prev => ({ ...prev, eta: e.target.value }))}
                  disabled={!superAdmin}
                  placeholder="e.g. Jan 2026 / next week"
                />
              </label>
            ) : null}

            <label className="block">
              <div className="text-xs text-slate-600 mb-1">Manifest Order</div>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                value={form.manifestOrder}
                onChange={e => setForm(prev => ({ ...prev, manifestOrder: e.target.value }))}
                disabled={!superAdmin}
              />
            </label>

            <label className="block">
              <div className="text-xs text-slate-600 mb-1">Total Cards (full)</div>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                value={form.totalCards}
                onChange={e => setForm(prev => ({ ...prev, totalCards: e.target.value }))}
                disabled={!superAdmin}
              />
            </label>

            {effTier === 'premium' ? (
              <label className="block">
                <div className="text-xs text-slate-600 mb-1">Preview Cards (premium)</div>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                  value={form.previewCards}
                  onChange={e => setForm(prev => ({ ...prev, previewCards: e.target.value }))}
                  disabled={!superAdmin}
                />
              </label>
            ) : null}

            {form.availability === 'retired' ? (
              <label className="block">
                <div className="text-xs text-slate-600 mb-1">Retired At (ms)</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                    value={form.retiredAtMs}
                    onChange={e => setForm(prev => ({ ...prev, retiredAtMs: e.target.value }))}
                    disabled={!superAdmin}
                    placeholder={`${Date.now()}`}
                  />
                  {superAdmin ? (
                    <button
                      type="button"
                      className="text-xs px-3 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                      onClick={() => setForm(prev => ({ ...prev, retiredAtMs: String(Date.now()) }))}
                    >
                      Now
                    </button>
                  ) : null}
                </div>
              </label>
            ) : null}
          </div>
        </div>

        {saveError ? <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{saveError}</div> : null}
        {saveOk ? <div className="mt-4 bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm">{saveOk}</div> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            className="text-sm px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void onSave(false)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          <button
            type="button"
            disabled={saving}
            className="text-sm px-4 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void onSave(true)}
          >
            {saving ? 'Saving…' : 'Save & Back'}
          </button>
        </div>

      </div>

      {superAdmin ? <DeckBuildsPanel deckId={deck.id} deckSlug={deck.slug} /> : null}
    </ConsoleShell>
  );
}
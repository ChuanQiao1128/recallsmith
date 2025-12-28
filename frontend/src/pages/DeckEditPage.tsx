// src/pages/DeckEditPage.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  fetchDeckById,
  fetchCardsByDeck,
  updateDeck,
  publishDeck,
  rebuildManifest,
} from '../api/authoring';

import { fetchContentManifest } from '../api/contentManifest';

import type { Deck, DeckAvailability, DeckTier } from '../types/deck';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';

type LoadState = {
  loading: boolean;
  error: string | null;
  deck: Deck | null;
};

type CardsInfo = {
  loading: boolean;
  error: string | null;
  count: number | null;
};

type ManifestInfo = {
  loading: boolean;
  error: string | null;
  generatedAtMs?: number;
  entry?:
    | {
        slug: string;
        availability?: string;
        tier?: string;
        downloadMode?: string;

        version?: string;
        buildId?: string | null;

        path?: string | null;
        totalCards?: number | null;

        previewBuildId?: string | null;
        previewPath?: string | null;
        previewCards?: number | null;
      }
    | null;
};

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

function parsePositiveIntOrError(input: string, fieldName: string): number {
  const s = input.trim();
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${fieldName} must be a positive number.`);
  return Math.trunc(n);
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

export function DeckEditPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const deckIdRaw = sp.get('deckId');
  const deckId = deckIdRaw ? Number(deckIdRaw) : NaN;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [load, setLoad] = useState<LoadState>({ loading: true, error: null, deck: null });
  const [cardsInfo, setCardsInfo] = useState<CardsInfo>({ loading: false, error: null, count: null });
  const [manifestInfo, setManifestInfo] = useState<ManifestInfo>({
    loading: false,
    error: null,
    entry: null,
  });

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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishOk, setPublishOk] = useState<string | null>(null);
  const [previewJson, setPreviewJson] = useState<string | null>(null);

  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  /**
   * ✅ FIX: refreshManifest does NOT depend on load/form state.
   * We pass slug explicitly, so it never triggers effect loops.
   */
  const refreshManifest = useCallback(async (slug: string) => {
    const safeSlug = String(slug || '').trim();
    if (!safeSlug) {
      setManifestInfo({ loading: false, error: 'Missing slug', entry: null });
      return;
    }

    setManifestInfo(prev => ({ ...prev, loading: true, error: null }));

    const res = await fetchContentManifest({ bustCache: true });
    if (!mountedRef.current) return;

    if (!res.ok) {
      setManifestInfo({ loading: false, error: res.error, entry: null });
      return;
    }

    const decks = res.data.decks ?? [];
    const found = decks.find(d => String(d.slug).trim() === safeSlug) ?? null;

    setManifestInfo({
      loading: false,
      error: null,
      generatedAtMs: (res.data as { generatedAtMs?: number }).generatedAtMs ?? undefined,
      entry: found
        ? {
            slug: found.slug,
            availability: (found as { availability?: string }).availability,
            tier: (found as { tier?: string }).tier,
            downloadMode: (found as { downloadMode?: string }).downloadMode,

            version: found.version,
            buildId: (found as { buildId?: string | null }).buildId ?? null,

            path: (found as { path?: string | null }).path ?? null,
            totalCards: (found as { totalCards?: number | null }).totalCards ?? null,

            previewBuildId: (found as { previewBuildId?: string | null }).previewBuildId ?? null,
            previewPath: (found as { previewPath?: string | null }).previewPath ?? null,
            previewCards: (found as { previewCards?: number | null }).previewCards ?? null,
          }
        : null,
    });
  }, []);

  /**
   * ✅ FIX: only depend on deckId.
   * No refreshManifest in deps (it’s stable) AND it doesn’t depend on state.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!Number.isFinite(deckId) || deckId <= 0) {
        setLoad({ loading: false, error: 'Missing or invalid deckId.', deck: null });
        return;
      }

      setLoad({ loading: true, error: null, deck: null });
      setSaveError(null);
      setSaveOk(null);

      try {
        // 1) load deck
        const deckRes = await fetchDeckById(deckId);
        if (cancelled || !mountedRef.current) return;

        if (!deckRes.success || !deckRes.data) {
          setLoad({ loading: false, error: deckRes.error?.message ?? 'Failed to load deck.', deck: null });
          return;
        }

        const found = deckRes.data;
        setLoad({ loading: false, error: null, deck: found });

        // init form once
        setForm({
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
        });

        // 2) load cards count
        setCardsInfo({ loading: true, error: null, count: null });
        const cardsRes = await fetchCardsByDeck(found.id);
        if (cancelled || !mountedRef.current) return;

        if (!cardsRes.success) {
          setCardsInfo({ loading: false, error: cardsRes.error?.message ?? 'Failed to load cards.', count: null });
        } else {
          setCardsInfo({ loading: false, error: null, count: (cardsRes.data ?? []).length });
        }

        // 3) load manifest for this deck.slug
        await refreshManifest(found.slug);
      } catch (err: unknown) {
        if (cancelled || !mountedRef.current) return;
        setLoad({ loading: false, error: err instanceof Error ? err.message : 'Network error.', deck: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, refreshManifest]);

  async function onSave(goBackAfter = false) {
    if (!load.deck) return;

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

      const versionNum = parsePositiveIntOrError(form.version, 'version');

      const payload: Parameters<typeof updateDeck>[0] = {
        id: load.deck.id,
        slug,
        title,
        author,
        description: form.description.trim() ? form.description.trim() : null,
        locale: form.locale.trim() ? form.locale.trim() : null,
        deckType,
        version: versionNum,
      };

      if (superAdmin) {
        const effTier = effectiveTier(deckType, form.tier);

        payload.tier = form.tier ? form.tier : null;
        payload.availability = form.availability;
        payload.eta = form.availability === 'coming' && form.eta.trim() ? form.eta.trim() : null;

        payload.manifestOrder = parseNullableInt(form.manifestOrder);
        payload.totalCards = parseNullableInt(form.totalCards);

        payload.previewCards = effTier === 'premium' ? parseNullableInt(form.previewCards) : null;
        payload.retiredAtMs = form.availability === 'retired' ? parseNullableInt(form.retiredAtMs) : null;
      }

      const res = await updateDeck(payload);

      if (!res.success || !res.data) {
        setSaveError(res.error?.message ?? 'Save failed.');
        return;
      }

      setSaveOk('Saved.');
      setLoad(prev => ({ ...prev, deck: res.data ?? prev.deck }));

      await refreshManifest(res.data.slug);

      if (goBackAfter) navigate('/', { replace: true });
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function doPreviewExport() {
    if (!load.deck) return;

    setPublishing(true);
    setPublishError(null);
    setPublishOk(null);
    setPreviewJson(null);

    try {
      const res = await publishDeck({ deckId: load.deck.id, mode: 'preview' });
      if (!res.success || !res.data) {
        setPublishError(res.error?.message ?? 'Preview export failed.');
        return;
      }

      if (res.data.mode !== 'preview') {
        setPublishError('Unexpected response (not preview).');
        return;
      }

      setPreviewJson(JSON.stringify(res.data.export, null, 2));
      setPublishOk(`Preview OK · cards=${res.data.cardCount}`);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPublishing(false);
    }
  }

  async function doPublish(rebuildAfter: boolean) {
    if (!load.deck) return;

    const note = window.prompt('Publish note (optional)', '') ?? '';
    setPublishing(true);
    setPublishError(null);
    setPublishOk(null);

    try {
      const res = await publishDeck({ deckId: load.deck.id, note: note.trim() || undefined, mode: 'publish' });
      if (!res.success || !res.data) {
        setPublishError(res.error?.message ?? 'Publish failed.');
        return;
      }

      if (res.data.mode !== 'publish') {
        setPublishError('Unexpected response (not publish).');
        return;
      }

      setPublishOk(`Publish OK · buildId=${res.data.buildId} · cards=${res.data.cardCount}`);

      if (rebuildAfter) {
        setRebuilding(true);
        setRebuildMsg(null);

        const r = await rebuildManifest();
        if (!r.success || !r.data) {
          setRebuildMsg(r.error?.message ?? 'Manifest rebuild failed.');
        } else {
          setRebuildMsg(`Manifest rebuilt · generatedAtMs=${r.data.generatedAtMs} · deckCount=${r.data.deckCount}`);
        }

        setRebuilding(false);
      }

      await refreshManifest(load.deck.slug);
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPublishing(false);
    }
  }

  async function doRebuildManifest() {
    setRebuilding(true);
    setRebuildMsg(null);

    try {
      const r = await rebuildManifest();
      if (!r.success || !r.data) {
        setRebuildMsg(r.error?.message ?? 'Manifest rebuild failed.');
        return;
      }

      setRebuildMsg(`Manifest rebuilt · generatedAtMs=${r.data.generatedAtMs} · deckCount=${r.data.deckCount}`);
      if (load.deck) await refreshManifest(load.deck.slug);
    } catch (err: unknown) {
      setRebuildMsg(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRebuilding(false);
    }
  }

  function applySuggestedCounts() {
    if (!superAdmin) return;
    const count = cardsInfo.count ?? 0;
    setForm(prev => ({
      ...prev,
      totalCards: String(count),
      previewCards: String(Math.min(10, count)),
    }));
  }

  if (load.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-600 text-lg">Loading deck…</div>
      </div>
    );
  }

  if (load.error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">Failed to load deck</div>
          <div className="text-sm">{load.error}</div>

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

  const deck = load.deck!;
  const effTier = effectiveTier(form.deckType, form.tier);

  return (
    <ConsoleShell
      title="RecallSmith Console"
      subtitle="Authoring · Edit Deck"
      userLabel={
        user
          ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}`
          : '—'
      }
      superAdmin={superAdmin}
      onSignOut={handleSignOut}
      onGoAdminUsers={superAdmin ? () => navigate('/admin/users') : undefined}
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

            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => refreshManifest(deck.slug)}
              title="Reload manifest entry for this deck"
            >
              Refresh Manifest View
            </button>
          </div>
        </div>

        {/* Cards count */}
        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-600 font-semibold">Cards in DB</div>
          {cardsInfo.loading ? (
            <div className="text-sm text-slate-600 mt-1">Loading cards…</div>
          ) : cardsInfo.error ? (
            <div className="text-sm text-amber-700 mt-1">{cardsInfo.error}</div>
          ) : (
            <div className="text-sm text-slate-800 mt-1">
              count = <span className="font-mono">{cardsInfo.count ?? 0}</span>
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
            <div className="text-[11px] text-slate-500 mt-1">DB draft version（不是 buildId）。建议内容改动就 +1。</div>
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

        {/* Publish / Manifest */}
        <div className="mt-8 border-t border-slate-100 pt-4">
          <div className="text-sm font-semibold text-slate-900">Publish & Manifest</div>
          <div className="text-xs text-slate-500 mt-1">
            Publish writes <code className="font-mono">deck.json</code> to S3. Rebuild Manifest writes{' '}
            <code className="font-mono">manifest.json</code> to S3.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!superAdmin || publishing}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void doPreviewExport()}
            >
              {publishing ? 'Working…' : 'Preview Export'}
            </button>

            <button
              type="button"
              disabled={!superAdmin || publishing}
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void doPublish(false)}
            >
              {publishing ? 'Publishing…' : 'Publish to S3'}
            </button>

            <button
              type="button"
              disabled={!superAdmin || publishing}
              className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void doPublish(true)}
              title="Publish + rebuild manifest"
            >
              {publishing ? 'Publishing…' : 'Publish & Rebuild Manifest'}
            </button>

            <button
              type="button"
              disabled={!superAdmin || rebuilding}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => void doRebuildManifest()}
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild Manifest'}
            </button>
          </div>

          {publishError ? <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{publishError}</div> : null}
          {publishOk ? <div className="mt-3 bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm">{publishOk}</div> : null}
          {rebuildMsg ? <div className="mt-3 bg-slate-50 border border-slate-200 text-slate-800 px-3 py-2 rounded text-sm">{rebuildMsg}</div> : null}

          {previewJson ? (
            <div className="mt-4">
              <div className="text-xs text-slate-600 font-semibold mb-2">Preview Export JSON</div>
              <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-[360px]">
                {previewJson}
              </pre>
            </div>
          ) : null}

          <div className="mt-6 bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-600 font-semibold">manifest.json (current)</div>
              {manifestInfo.loading ? <div className="text-[11px] text-slate-500">Loading…</div> : null}
            </div>

            {manifestInfo.error ? (
              <div className="text-sm text-amber-700 mt-2">Manifest unavailable: {manifestInfo.error}</div>
            ) : manifestInfo.entry ? (
              <div className="mt-2 text-sm text-slate-800">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-slate-500">availability / tier / downloadMode</div>
                    <div className="font-mono text-xs">
                      {manifestInfo.entry.availability ?? '—'} / {manifestInfo.entry.tier ?? '—'} /{' '}
                      {manifestInfo.entry.downloadMode ?? '—'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500">buildId / version</div>
                    <div className="font-mono text-xs">
                      {String(manifestInfo.entry.buildId ?? 'null')} / {manifestInfo.entry.version ?? '—'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500">path</div>
                    <div className="font-mono text-xs break-all">{manifestInfo.entry.path ?? 'null'}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500">totalCards</div>
                    <div className="font-mono text-xs">{manifestInfo.entry.totalCards ?? '—'}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500">previewPath</div>
                    <div className="font-mono text-xs break-all">{manifestInfo.entry.previewPath ?? 'null'}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-slate-500">previewCards</div>
                    <div className="font-mono text-xs">{manifestInfo.entry.previewCards ?? '—'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500 mt-2">Deck not found in manifest yet.</div>
            )}
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}
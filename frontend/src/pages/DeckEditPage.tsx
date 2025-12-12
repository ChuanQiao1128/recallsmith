// src/pages/DeckEditPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchDecks, updateDeck } from '../api/authoring';
import type { Deck } from '../types/deck';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';

type LoadState = {
  loading: boolean;
  error: string | null;
  deck: Deck | null;
};

type FormState = {
  slug: string;
  title: string;
  author: string;
  description: string;
  locale: string;
  deckType: number;
  version: string; // 用 string 方便 input；保存时转 number
};

function toStr(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

export function DeckEditPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const deckIdRaw = sp.get('deckId');
  const deckId = deckIdRaw ? Number(deckIdRaw) : NaN;

  const [load, setLoad] = useState<LoadState>({
    loading: true,
    error: null,
    deck: null,
  });

  const [form, setForm] = useState<FormState>({
    slug: '',
    title: '',
    author: '',
    description: '',
    locale: 'en-US',
    deckType: 1,
    version: '1',
  });

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
        // ✅ 最稳妥：复用 fetchDecks()（你现有就有）
        // 如果你愿意，也可以扩展 fetchDecks({ id }) 只拉单条
        const decksRes = await fetchDecks();
        if (cancelled) return;

        if (!decksRes.success) {
          setLoad({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', deck: null });
          return;
        }

        const all = decksRes.data ?? [];
        const found = all.find(d => Number(d.id) === deckId) ?? null;

        if (!found) {
          setLoad({ loading: false, error: 'Deck not found (or you have no permission).', deck: null });
          return;
        }

        setLoad({ loading: false, error: null, deck: found });

        // 初始化表单
        setForm({
          slug: toStr(found.slug),
          title: toStr(found.title),
          author: toStr(found.author),
          description: toStr(found.description ?? ''),
          locale: toStr(found.locale ?? 'en-US'),
          deckType: Number(found.deckType ?? 1) || 1,
          version: toStr(found.version ?? '1'),
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setLoad({
          loading: false,
          error: err instanceof Error ? err.message : 'Network error.',
          deck: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId]);

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

      const versionNum = form.version.trim() ? Number(form.version.trim()) : NaN;
      if (!Number.isFinite(versionNum) || versionNum <= 0) {
        setSaveError('version must be a positive integer.');
        return;
      }

      const res = await updateDeck({
        id: load.deck.id,
        slug,
        title,
        author,
        description: form.description.trim() ? form.description.trim() : null,
        locale: form.locale.trim() ? form.locale.trim() : null,
        deckType,
        version: versionNum,
      });

      if (!res.success) {
        setSaveError(res.error?.message ?? 'Save failed.');
        return;
      }

      setSaveOk('Saved.');
      setLoad(prev => ({ ...prev, deck: res.data ?? prev.deck }));

      if (goBackAfter) {
        navigate('/decks', { replace: true });
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setSaving(false);
    }
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
            onClick={() => navigate('/decks')}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const deck = load.deck!;

  return (
    <ConsoleShell
      title="RecallSmith Console"
      subtitle="Authoring · Edit Deck"
      userLabel={user ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}` : '—'}
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
              onClick={() => navigate('/decks')}
            >
              Back
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs text-slate-600 mb-1">Slug *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={form.slug}
              onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
              placeholder="e.g. js-async-basics"
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
            <div className="text-xs text-slate-600 mb-1">Version *</div>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              value={form.version}
              onChange={e => setForm(prev => ({ ...prev, version: e.target.value }))}
              placeholder="1"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              建议：每次有内容变更就 +1（你后面 publish 会用它做对比）
            </div>
          </label>
        </div>

        {saveError ? (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
            {saveError}
          </div>
        ) : null}

        {saveOk ? (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm">
            {saveOk}
          </div>
        ) : null}

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
    </ConsoleShell>
  );
}

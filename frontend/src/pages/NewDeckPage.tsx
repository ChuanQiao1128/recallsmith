// src/pages/NewDeckPage.tsx

import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createDeck } from '../api/authoring';

interface NewDeckForm {
  title: string;
  slug: string;
  author: string;
  description: string;
  locale: string;
  deckType: number; // 1 Starter, 2 Paid

  // ✅ mobile/publish 相关（先录入，后续 publish/preview 会用到）
  contentVersion: string; // e.g. 1.0.0
  freeCardCount: number; // paid 试用/preview 卡数（例如 50）
}

interface FormState {
  submitting: boolean;
  error: string | null;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // 非字母数字替换成 -
    .replace(/^-+|-+$/g, ''); // 去掉头尾的 -
}

function isValidSemver(v: string): boolean {
  // 接受：1.0.0 / 1.0.0-alpha / 1.0.0+build
  return /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v.trim());
}

export function NewDeckPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState<NewDeckForm>({
    title: '',
    slug: '',
    author: 'RecallSmith Team',
    description: '',
    locale: 'en-US',
    deckType: 1,

    contentVersion: '1.0.0',
    freeCardCount: 50,
  });

  const [state, setState] = useState<FormState>({
    submitting: false,
    error: null,
  });

  const isStarter = form.deckType === 1;
  const isFreeStarter = isStarter; // ✅ 规则：Starter 一定是 free starter

  function handleChange(field: keyof NewDeckForm, value: string | number) {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }));
  }

  function setDeckType(next: 1 | 2) {
    setForm(prev => {
      if (next === 1) {
        // Starter: free starter + freeCardCount 不参与（发布/预览时会 = totalCards）
        return { ...prev, deckType: 1 };
      }
      // Paid: 默认试用 50
      return {
        ...prev,
        deckType: 2,
        freeCardCount:
          Number.isFinite(prev.freeCardCount) && prev.freeCardCount >= 0
            ? prev.freeCardCount
            : 50,
      };
    });
  }

  function handleTitleBlur() {
    if (!form.slug.trim() && form.title.trim()) {
      const auto = slugify(form.title);
      setForm(prev => ({ ...prev, slug: auto }));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmedTitle = form.title.trim();
    const trimmedSlug = form.slug.trim();
    const trimmedAuthor = form.author.trim();
    const trimmedVersion = form.contentVersion.trim();

    if (!trimmedTitle) {
      setState({ submitting: false, error: 'Title is required.' });
      return;
    }
    if (!trimmedSlug) {
      setState({ submitting: false, error: 'Slug is required.' });
      return;
    }
    if (!trimmedAuthor) {
      setState({ submitting: false, error: 'Author is required.' });
      return;
    }
    if (!trimmedVersion) {
      setState({ submitting: false, error: 'Content version is required.' });
      return;
    }
    if (!isValidSemver(trimmedVersion)) {
      setState({ submitting: false, error: 'Content version must be semver like 1.0.0' });
      return;
    }

    if (!isStarter) {
      if (!Number.isFinite(form.freeCardCount) || form.freeCardCount < 0) {
        setState({ submitting: false, error: 'Free card count must be a non-negative number.' });
        return;
      }
    }

    setState({ submitting: true, error: null });

    try {
      const result = await createDeck({
        slug: trimmedSlug,
        title: trimmedTitle,
        author: trimmedAuthor,
        description: form.description,
      });

      if (!result.success) {
        setState({
          submitting: false,
          error: result.error?.message ?? 'Create deck failed.',
        });
        return;
      }

      navigate('/', { replace: true });
    } catch (err: unknown) {
      setState({
        submitting: false,
        error: err instanceof Error ? err.message : 'Network error.',
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">New Deck</h1>
            <p className="text-xs text-slate-500 mt-1">
              在这里创建一个新的题库，比如 <span className="font-mono">js-core-basics</span>。
            </p>
          </div>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to list
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-lg shadow-sm px-6 py-6 space-y-4"
        >
          {state.error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
              {state.error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.title}
              onChange={e => handleChange('title', e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="JavaScript Core Basics"
            />
            <p className="mt-1 text-xs text-slate-500">用于展示的题库名称。</p>
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.slug}
              onChange={e => handleChange('slug', slugify(e.target.value))}
              placeholder="js-core-basics"
            />
            <p className="mt-1 text-xs text-slate-500">
              稳定 ID，不含空格。后续发布 / S3 / RN 都会用这个标识。
            </p>
          </div>

          {/* Author */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Author <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.author}
              onChange={e => handleChange('author', e.target.value)}
              placeholder="RecallSmith Team"
            />
          </div>

          {/* Locale & DeckType */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Locale */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Locale</label>
              <select
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                value={form.locale}
                onChange={e => handleChange('locale', e.target.value)}
                aria-label="Locale"
              >
                <option value="en-US">en-US</option>
                <option value="zh-CN">zh-CN</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">题库内容语言。英文/中文可并存。</p>
            </div>

            {/* DeckType */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deck Type</label>
              <div className="flex items-center gap-4 mt-1">
                <label className="inline-flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="deckType"
                    value={1}
                    checked={form.deckType === 1}
                    onChange={() => setDeckType(1)}
                    className="text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Starter（永久免费）</span>
                </label>

                <label className="inline-flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="deckType"
                    value={2}
                    checked={form.deckType === 2}
                    onChange={() => setDeckType(2)}
                    className="text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Paid（收费题库）</span>
                </label>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {isStarter ? 'Starter 会在 mobile 端全量免费。' : 'Paid 将用于订阅/试用逻辑。'}
              </div>
            </div>
          </div>

          {/* ✅ Mobile / Publish fields */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 mb-2">Mobile / Publish settings</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* contentVersion */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Content Version <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={form.contentVersion}
                  onChange={e => handleChange('contentVersion', e.target.value.trim())}
                  placeholder="1.0.0"
                />
                <p className="mt-1 text-xs text-slate-500">deck.json 的 Version（建议严格 semver）。</p>
              </div>

              {/* isFreeStarter (derived) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">IsFreeStarter</label>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {isFreeStarter ? 'true' : 'false'}
                </div>
                <p className="mt-1 text-xs text-slate-500">由 DeckType 推导：Starter=true，Paid=false。</p>
              </div>

              {/* freeCardCount */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  FreeCardCount (Paid preview)
                </label>

                {isStarter ? (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                    Auto (all cards)
                  </div>
                ) : (
                  <input
                    type="number"
                    min={0}
                    className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    value={form.freeCardCount}
                    onChange={e => handleChange('freeCardCount', Number(e.target.value))}
                    aria-label="Free Card Count"
                  />
                )}

                <p className="mt-1 text-xs text-slate-500">
                  Paid deck 的试用/preview 卡数（以后你要做“前 50 题免费体验”就是靠它）。
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                         min-h-[80px]"
              value={form.description}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="A deck for core interview concepts..."
            />
          </div>

          {/* Buttons */}
          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="text-sm text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={state.submitting}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         disabled:opacity-60 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {state.submitting ? 'Creating...' : 'Create Deck'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
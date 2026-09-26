// src/pages/NewDeckPage.tsx

import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCreateDeck, useUpdateDeck } from '../hooks/useDecks';
import { buildDeckBody, parseDraftVersion, DRAFT_VERSION_ERROR } from '../lib/authoringBodies';
import { DEFAULT_DECK_AUTHOR } from '../lib/brand';

interface NewDeckForm {
  title: string;
  slug: string;
  author: string;
  description: string;
  locale: string;
  deckType: number; // 1 Starter, 2 Paid

  // mobile / publish fields: captured here, used later by publish and preview
  draftVersion: string; // whole number held in decks.version; publish stamps its own build id
  freeCardCount: number; // cards a Paid deck opens for preview, e.g. 50
}

interface FormState {
  submitting: boolean;
  /**
   * Everything wrong with this attempt, not the first thing wrong with it.
   *
   * This used to be one `error: string | null` set by five guards that each
   * returned early, so a form with four empty required fields took four
   * submits to find out — and each one reported a single problem as if it were
   * the only one. Collecting them costs nothing (the checks are pure and
   * already all written) and turns four round trips into one.
   *
   * The server's refusal lands in the same list as a single entry, so there is
   * one banner and one place that renders it rather than two that can drift.
   */
  errors: string[];
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // anything not a letter or digit becomes -
    .replace(/^-+|-+$/g, ''); // and leading/trailing separators go
}

export function NewDeckPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState<NewDeckForm>({
    title: '',
    slug: '',
    author: DEFAULT_DECK_AUTHOR,
    description: '',
    locale: 'en-US',
    deckType: 1,

    draftVersion: '1',
    freeCardCount: 50,
  });

  const [state, setState] = useState<FormState>({
    submitting: false,
    errors: [],
  });

  // The write goes through react-query so that a created deck invalidates the
  // deck list rather than relying on the list refusing to cache.
  const createDeckMutation = useCreateDeck();
  // Decks.cs POST ignores previewCards, so a Paid deck's free card count reaches
  // the row only through a follow-up PUT after the create succeeds.
  const updateDeckMutation = useUpdateDeck();

  const isStarter = form.deckType === 1;
  const isFreeStarter = isStarter; // the rule: a Starter deck is always a free starter

  function handleChange(field: keyof NewDeckForm, value: string | number) {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }));
  }

  function setDeckType(next: 1 | 2) {
    setForm(prev => {
      if (next === 1) {
        // Starter: a free starter, and freeCardCount does not apply (publish/preview set it to totalCards)
        return { ...prev, deckType: 1 };
      }
      // Paid: 50 preview cards by default
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
    const trimmedVersion = form.draftVersion.trim();
    const draftVersion = parseDraftVersion(trimmedVersion);

    const problems: string[] = [];

    if (!trimmedTitle) problems.push('Title is required.');
    if (!trimmedSlug) problems.push('Slug is required.');
    if (!trimmedAuthor) problems.push('Author is required.');
    // One message per field, still. A blank box is its own complaint; anything
    // else that will not parse to a whole number of 1 or more is the other.
    if (!trimmedVersion) problems.push('Draft version is required.');
    else if (draftVersion === null) problems.push(DRAFT_VERSION_ERROR);

    // Only a Paid deck has a preview count to get wrong: a Starter deck opens
    // every card, so a stale negative left over from switching type is not a
    // reason to refuse the submit.
    if (!isStarter && (!Number.isFinite(form.freeCardCount) || form.freeCardCount < 0)) {
      problems.push('Free card count must be a non-negative number.');
    }

    if (problems.length > 0) {
      setState({ submitting: false, errors: problems });
      return;
    }

    setState({ submitting: true, errors: [] });

    try {
      const result = await createDeckMutation.mutateAsync(
        buildDeckBody({
          slug: trimmedSlug,
          title: trimmedTitle,
          author: trimmedAuthor,
          description: form.description,
          locale: form.locale,
          deckType: form.deckType,
          // Non-null here: a null draftVersion was collected into `problems`
          // above and returned before this point.
          version: draftVersion ?? 1,
        }),
      );

      if (!result.success) {
        setState({
          submitting: false,
          errors: [result.error?.message ?? 'Create deck failed.'],
        });
        return;
      }

      // A Paid deck carries a free card count the POST could not store, so save
      // it with a follow-up PUT before leaving. A Starter deck makes one request.
      if (form.deckType === 2 && result.data) {
        const { result: previewResult } = await updateDeckMutation.mutateAsync({
          id: result.data.id,
          params: { previewCards: form.freeCardCount },
        });

        if (!previewResult.success) {
          const message = previewResult.error?.message ?? 'unknown error';
          setState({
            submitting: false,
            errors: [
              `Deck created, but the free card count was not saved: ${message}. Set Preview Cards on the deck's Edit page.`,
            ],
          });
          return;
        }
      }

      navigate('/', { replace: true });
    } catch (err: unknown) {
      setState({
        submitting: false,
        errors: [err instanceof Error ? err.message : 'Network error.'],
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
              Start a new deck &mdash; something like <span className="font-mono">js-core-basics</span>.
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
          {state.errors.length > 0 && (
            <div
              className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm"
              role="alert"
            >
              {/* A single problem stays a sentence. Wrapping one item in a
                  bulleted list makes the commonest case — the server refusing
                  the slug — read like a checklist with one box on it. */}
              {state.errors.length === 1 ? (
                state.errors[0]
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {state.errors.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label htmlFor="new-deck-title" className="block text-sm font-medium text-slate-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="new-deck-title"
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.title}
              onChange={e => handleChange('title', e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="JavaScript Core Basics"
            />
            <p className="mt-1 text-xs text-slate-500">The name shown wherever this deck appears.</p>
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="new-deck-slug" className="block text-sm font-medium text-slate-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              id="new-deck-slug"
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.slug}
              onChange={e => handleChange('slug', slugify(e.target.value))}
              placeholder="js-core-basics"
            />
            <p className="mt-1 text-xs text-slate-500">
              Stable ID, no spaces. Publishing, S3 and the mobile app all address the deck by this.
            </p>
          </div>

          {/* Author */}
          <div>
            <label htmlFor="new-deck-author" className="block text-sm font-medium text-slate-700 mb-1">
              Author <span className="text-red-500">*</span>
            </label>
            <input
              id="new-deck-author"
              type="text"
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={form.author}
              onChange={e => handleChange('author', e.target.value)}
              placeholder={DEFAULT_DECK_AUTHOR}
            />
          </div>

          {/* Locale & DeckType */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Locale */}
            <div>
              <label htmlFor="new-deck-locale" className="block text-sm font-medium text-slate-700 mb-1">Locale</label>
              <select
                id="new-deck-locale"
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                value={form.locale}
                onChange={e => handleChange('locale', e.target.value)}
                aria-label="Locale"
              >
                <option value="en-US">en-US</option>
                <option value="zh-CN">zh-CN</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">The language of the cards inside. English and Chinese decks can sit side by side.</p>
            </div>

            {/* DeckType */}
            <div>
              <span id="new-deck-type-label" className="block text-sm font-medium text-slate-700 mb-1">Deck Type</span>
              <div role="radiogroup" aria-labelledby="new-deck-type-label" className="flex items-center gap-4 mt-1">
                <label className="inline-flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="deckType"
                    value={1}
                    checked={form.deckType === 1}
                    onChange={() => setDeckType(1)}
                    className="text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span>Starter (always free)</span>
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
                  <span>Paid (subscription)</span>
                </label>
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {isStarter ? 'Every card is free in the mobile app.' : 'Cards are gated by the subscription and trial rules.'}
              </div>
            </div>
          </div>

          {/* Mobile / Publish fields */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800 mb-2">Mobile / Publish settings</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* draftVersion */}
              <div>
                <label htmlFor="new-deck-version" className="block text-sm font-medium text-slate-700 mb-1">
                  Draft Version <span className="text-red-500">*</span>
                </label>
                <input
                  id="new-deck-version"
                  type="text"
                  className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono
                             focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={form.draftVersion}
                  onChange={e => handleChange('draftVersion', e.target.value.trim())}
                  placeholder="1"
                  aria-label="Draft Version"
                />
                <p className="mt-1 text-xs text-slate-500">The draft version held in the database (a whole number). Publishing stamps its own build id into deck.json.</p>
              </div>

              {/* isFreeStarter (derived) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">IsFreeStarter</label>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {isFreeStarter ? 'true' : 'false'}
                </div>
                <p className="mt-1 text-xs text-slate-500">Derived from Deck Type: Starter is true, Paid is false.</p>
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
                  How many cards of a Paid deck open without buying it. This is what a &ldquo;first 50 free&rdquo; trial is built on.
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="new-deck-description" className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              id="new-deck-description"
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
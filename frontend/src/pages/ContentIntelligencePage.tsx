import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  fetchContentIntelligence,
  fetchDecks,
  type ContentIntelligenceCard,
  type ContentIntelligenceData,
} from '../api/authoring';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';
import { clearStoredTokens } from '../auth/tokenStore';
import { ConsoleShell } from '../components/console/ConsoleShell';
import type { Deck } from '../types/deck';

type PageState = {
  loading: boolean;
  error: string | null;
  data: ContentIntelligenceData | null;
};

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Math.round(Number(v) * 100)}%`;
}

function num(v: number | null | undefined, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

function seconds(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  return `${Math.round(Number(ms) / 1000)}s`;
}

function statusClass(status: string) {
  if (status === 'Possibly Unclear' || status === 'Difficulty Understated') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Difficulty Overstated' || status === 'Too Shallow') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'Productive Challenge') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'Needs More Data') return 'bg-slate-50 text-slate-600 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function StatusPill({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(value)}`}>
      {value}
    </span>
  );
}

function cardKey(card: ContentIntelligenceCard) {
  return `${card.deckSlug}:${card.cardStableUid}:${card.revision}`;
}

function buildReasons(card: ContentIntelligenceCard): string[] {
  const reasons: string[] = [];
  if ((card.difficultyGapZ ?? 0) > 1) {
    reasons.push(`Observed difficulty is ${num(card.difficultyGapZ, 1)}σ above comparable cards.`);
  }
  if ((card.difficultyGapZ ?? 0) < -1) {
    reasons.push(`Observed difficulty is ${num(Math.abs(card.difficultyGapZ ?? 0), 1)}σ below comparable cards.`);
  }
  if ((card.dwellTimeGapZ ?? 0) > 1) {
    reasons.push(`Median dwell time is ${num(card.dwellTimeGapZ, 1)}σ above baseline.`);
  }
  if ((card.highLevelUserFailureRate ?? 0) >= 0.15) {
    reasons.push(`High-level users still choose Again at ${pct(card.highLevelUserFailureRate)}.`);
  }
  if ((card.repeatFailureRate ?? 0) >= 0.2) {
    reasons.push(`Repeat failure rate is ${pct(card.repeatFailureRate)}.`);
  }
  if ((card.firstReviewEasyRate ?? 0) >= 0.45 && (card.difficultyGapZ ?? 0) < -1) {
    reasons.push(`First-review Easy rate is ${pct(card.firstReviewEasyRate)}.`);
  }
  if (reasons.length === 0) reasons.push('No strong anomaly in the current analysis window.');
  return reasons;
}

function suggestedAction(card: ContentIntelligenceCard) {
  if (card.contentQualityStatus === 'Possibly Unclear') return 'Rewrite explanation, add code example, or split the concept.';
  if (card.difficultyCalibrationStatus === 'Difficulty Understated') return 'Raise difficulty or add prerequisite coverage.';
  if (card.difficultyCalibrationStatus === 'Difficulty Overstated') return 'Lower difficulty or deepen the card.';
  if (card.contentQualityStatus === 'Too Shallow') return 'Make the prompt more discriminating or lower its difficulty.';
  if (card.contentQualityStatus === 'Needs More Data') return 'Wait for more review events.';
  return 'No immediate content action.';
}

export function ContentIntelligencePage() {
  const navigate = useNavigate();
  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const [days, setDays] = useState(90);
  const [deckSlug, setDeckSlug] = useState('');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [state, setState] = useState<PageState>({ loading: true, error: null, data: null });
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const res = await fetchContentIntelligence({
      deckSlug: deckSlug || null,
      days,
      limit: 100,
    });
    if (!res.success || !res.data) {
      setState({ loading: false, error: res.error?.message ?? 'Failed to load content intelligence', data: null });
      return;
    }
    setState({ loading: false, error: null, data: res.data });
  }, [days, deckSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function loadDecks() {
      const res = await fetchDecks();
      if (!cancelled && res.success && res.data) setDecks(res.data);
    }
    void loadDecks();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  const cards = state.data?.cards ?? [];
  const topCards = cards.slice(0, 20);
  const summary = state.data?.summary;
  const selectedCard = useMemo(() => {
    if (topCards.length === 0) return null;
    return topCards.find((card) => cardKey(card) === selectedCardKey) ?? topCards[0];
  }, [selectedCardKey, topCards]);

  return (
    <ConsoleShell
      title="Content Intelligence"
      subtitle="Difficulty Calibration · Content Quality"
      userLabel={user ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}` : '—'}
      superAdmin={superAdmin}
      onSignOut={handleSignOut}
      onGoDecks={() => navigate('/')}
      onGoAdminUsers={superAdmin ? () => navigate('/admin/users') : undefined}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Card Health Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Difficulty 1/2/3 is treated as the author-stated expectation.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Deck
              <select
                value={deckSlug}
                onChange={(e) => setDeckSlug(e.target.value)}
                className="mt-1 block h-9 min-w-48 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value="">All readable decks</option>
                {decks.map((deck) => (
                  <option key={deck.slug} value={deck.slug}>
                    {deck.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Window
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>365 days</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="h-9 self-end rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        </section>

        {state.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Cards', summary?.cardCount ?? 0],
            ['Possibly Unclear', summary?.possiblyUnclear ?? 0],
            ['Too Shallow', summary?.tooShallow ?? 0],
            ['Productive Challenge', summary?.productiveChallenge ?? 0],
            ['Difficulty Understated', summary?.difficultyUnderstated ?? 0],
            ['Difficulty Overstated', summary?.difficultyOverstated ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-900">Top 20 Cards To Fix</h2>
            <div className="text-xs font-medium text-slate-500">Click a card row to inspect its signals.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Card</th>
                  <th className="px-4 py-3">Calibration</th>
                  <th className="px-4 py-3">Content</th>
                  <th className="px-4 py-3">Diff</th>
                  <th className="px-4 py-3">Reviews</th>
                  <th className="px-4 py-3">Again</th>
                  <th className="px-4 py-3">Hard</th>
                  <th className="px-4 py-3">Dwell</th>
                  <th className="px-4 py-3">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.loading ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={9}>Loading…</td>
                  </tr>
                ) : topCards.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={9}>No review events in this window.</td>
                  </tr>
                ) : (
                  topCards.map((card) => {
                    const selected = selectedCard && cardKey(card) === cardKey(selectedCard);
                    return (
                      <Fragment key={cardKey(card)}>
                        <tr
                          role="button"
                          tabIndex={0}
                          aria-label={`Open detail for ${card.cardQuestion}`}
                          onClick={() => setSelectedCardKey(cardKey(card))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedCardKey(cardKey(card));
                            }
                          }}
                          className={`cursor-pointer align-top outline-none transition-colors hover:bg-slate-50 focus:bg-slate-50 ${
                            selected ? 'bg-slate-50 ring-1 ring-inset ring-slate-300' : ''
                          }`}
                        >
                          <td className="max-w-md px-4 py-3">
                            <div className="font-semibold text-slate-900">{card.cardQuestion}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {card.deckTitle} · {card.cardStableUid} · rev {card.revision}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <span>{suggestedAction(card)}</span>
                              <span className="font-semibold text-slate-900">{selected ? 'Detail open' : 'Open detail'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3"><StatusPill value={card.difficultyCalibrationStatus} /></td>
                          <td className="px-4 py-3"><StatusPill value={card.contentQualityStatus} /></td>
                          <td className="px-4 py-3 text-slate-700">
                            <div>stated {card.statedDifficulty}</div>
                            <div className="text-xs text-slate-500">gap {num(card.difficultyGapZ, 1)}σ</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div>{card.reviewCount}</div>
                            <div className="text-xs text-slate-500">{card.uniqueUserCount} users · {card.confidenceLevel}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{pct(card.againRate)}</td>
                          <td className="px-4 py-3 text-slate-700">{pct(card.hardRate)}</td>
                          <td className="px-4 py-3 text-slate-700">{seconds(card.medianDwellTimeMs)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{num(card.fixPriorityScore, 0)}</td>
                        </tr>
                        {selected ? (
                          <tr className="bg-white">
                            <td colSpan={9} className="px-4 pb-5 pt-1">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <div className="grid gap-3 md:grid-cols-4">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observed / Expected</div>
                                    <div className="mt-1 font-bold text-slate-900">{num(card.observedDifficultyRaw)} / {num(card.expectedDifficulty)}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Again / Hard</div>
                                    <div className="mt-1 font-bold text-slate-900">{pct(card.againRate)} / {pct(card.hardRate)}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dwell</div>
                                    <div className="mt-1 font-bold text-slate-900">{seconds(card.medianDwellTimeMs)}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mastery Reviews</div>
                                    <div className="mt-1 font-bold text-slate-900">{num(card.reviewCountToMastery)}</div>
                                  </div>
                                </div>
                                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why Flagged</div>
                                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                      {buildReasons(card).map((reason) => (
                                        <li key={reason}>{reason}</li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div className="rounded-md bg-white p-3 text-sm text-slate-700">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested Action</div>
                                    <div className="mt-1 font-semibold text-slate-900">{suggestedAction(card)}</div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedCard ? (
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-4 py-4">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Card Detail</div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedCard.cardQuestion}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedCard.deckTitle} · {selectedCard.cardStableUid} · revision {selectedCard.revision}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill value={selectedCard.difficultyCalibrationStatus} />
                <StatusPill value={selectedCard.contentQualityStatus} />
              </div>
            </div>

            <div className="grid gap-4 p-4 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ['Stated Difficulty', String(selectedCard.statedDifficulty), `gap ${num(selectedCard.difficultyGapZ, 1)}σ`],
                  ['Observed / Expected', `${num(selectedCard.observedDifficultyRaw)} / ${num(selectedCard.expectedDifficulty)}`, `raw gap ${num(selectedCard.difficultyGap)}`],
                  ['Reviews', String(selectedCard.reviewCount), `${selectedCard.uniqueUserCount} users · ${selectedCard.confidenceLevel}`],
                  ['Again / Hard', `${pct(selectedCard.againRate)} / ${pct(selectedCard.hardRate)}`, `struggle ${pct(selectedCard.struggleRate)}`],
                  ['First Easy / Repeat Fail', `${pct(selectedCard.firstReviewEasyRate)} / ${pct(selectedCard.repeatFailureRate)}`, `failure ${pct(selectedCard.failureRate)}`],
                  ['Dwell Time', seconds(selectedCard.medianDwellTimeMs), `baseline ${seconds(selectedCard.expectedDwellTimeMs)}`],
                  ['High-Level Failure', pct(selectedCard.highLevelUserFailureRate), 'advanced users choosing Again'],
                  ['Dropout After Card', pct(selectedCard.postCardDropoutRate), 'session abandonment signal'],
                  ['Mastery Reviews', num(selectedCard.reviewCountToMastery), `priority ${num(selectedCard.fixPriorityScore, 0)}`],
                ].map(([label, value, helper]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-1 text-base font-bold text-slate-900">{value}</div>
                    <div className="mt-1 text-xs text-slate-500">{helper}</div>
                  </div>
                ))}
              </div>

              <aside className="rounded-md border border-slate-200 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why Flagged</div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {buildReasons(selectedCard).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="mt-5 rounded-md bg-slate-900 p-3 text-sm text-white">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">Suggested Action</div>
                  <div className="mt-1 font-semibold">{suggestedAction(selectedCard)}</div>
                </div>
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </ConsoleShell>
  );
}

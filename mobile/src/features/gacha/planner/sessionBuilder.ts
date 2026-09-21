import { SESSION_MAIN_ROUTE_DEFAULT, SESSION_MIN_GOAL, SWEEP_SPREAD_DAYS } from '../constants';
import type { ChallengeRoute, RoutePreviewNode } from '../contracts';
import { resolveRouteRole } from './sessionRoles';

function describeNode(role: RoutePreviewNode['role']) {
  if (role === 'warmup') {
    return {
      title: 'Warm-up node',
      subtitle: 'Open with one low-friction recall win and settle into the run.',
    };
  }

  if (role === 'elite') {
    return {
      title: 'Elite recall',
      subtitle: 'A sharper mid-run check that asks for more deliberate recall.',
    };
  }

  if (role === 'boss') {
    return {
      title: 'Boss check',
      subtitle: 'Use the final node as a clean closing test, not a punishment wall.',
    };
  }

  return {
    title: 'Normal node',
    subtitle: 'A standard learning / recall step that keeps the route moving.',
  };
}

/**
 * A route with no nodes. `limit` 0 is the planner's one way of saying "there is
 * nothing to deal here": the account holds no card of this deck (a fresh install
 * before the first pull), so a run cannot start, let alone complete. Consumers
 * must treat it as an empty state, never as "Run 0/1" — the header, the summary
 * and Home's preview all did exactly that before this existed.
 */
export const EMPTY_ROUTE_LIMIT = 0;

export function buildChallengeRoute(params: {
  slug: string;
  deckTitle: string;
  dueCount: number;
  newCount: number;
  /** Cards of this deck the account holds (drawn or already studied). 0 → empty route. */
  ownedCount: number;
}): ChallengeRoute {
  const { slug, deckTitle, dueCount, newCount, ownedCount } = params;
  const hasPlayableCards = ownedCount > 0;
  const hasTodayWork = dueCount > 0 || newCount > 0;
  // R6/F10: one fresh card should plan a one-node route the user can full-clear.
  // With nothing owned there is no maintenance run to fall back to either: the
  // old `: 1` branch planned a warm-up node over an empty collection.
  const limit = !hasPlayableCards
    ? EMPTY_ROUTE_LIMIT
    : hasTodayWork
      ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount))
      : 1;

  const hasBoss = dueCount >= 3;
  const hasElite = dueCount >= 2 || newCount >= 1;

  const nodes: RoutePreviewNode[] = Array.from({ length: limit }).map((_, index) => {
    const role = resolveRouteRole({ index, total: limit, hasElite, hasBoss });
    const meta = describeNode(role);
    return {
      id: `${role}-${index}`,
      role,
      title: meta.title,
      subtitle: meta.subtitle,
    };
  });

  const summary = !hasPlayableCards
    ? `${deckTitle} has no cards yet — open a pack to get your first cards.`
    : hasTodayWork
      ? `${deckTitle} · ${dueCount} due · ${newCount} fresh · clear ${SESSION_MIN_GOAL} node to keep momentum`
      : `${deckTitle} is light today — treat this as a short maintenance run, not a backlog day.`;

  return {
    slug,
    deckTitle,
    mode: 'mixed',
    limit,
    minimumGoal: SESSION_MIN_GOAL,
    dueCount,
    newCount,
    nodes,
    summary,
  };
}

/**
 * Exam sweep (economy-v2 R8): every owned learned card, longest-unseen first,
 * spread over SWEEP_SPREAD_DAYS days at the normal run cap. No elite/boss
 * nodes — the run is a pass over known material, not a pressure check.
 */
export function buildSweepRoute(params: {
  slug: string;
  deckTitle: string;
  learnedCount: number;
  dueCount: number;
  newCount: number;
}): ChallengeRoute {
  const { slug, deckTitle, learnedCount, dueCount, newCount } = params;
  const dailyTarget = Math.ceil(learnedCount / SWEEP_SPREAD_DAYS);
  // A sweep plays learned cards only, so learnedCount is its owned count: with
  // none learned there is nothing to sweep and the route is empty, not one node.
  const limit =
    learnedCount > 0 ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget)) : EMPTY_ROUTE_LIMIT;

  const nodes: RoutePreviewNode[] = Array.from({ length: limit }).map((_, index) => {
    const role = resolveRouteRole({ index, total: limit, hasElite: false, hasBoss: false });
    const meta = describeNode(role);
    return {
      id: `${role}-${index}`,
      role,
      title: meta.title,
      subtitle: meta.subtitle,
    };
  });

  const summary =
    learnedCount > 0
      ? `${deckTitle} · ${learnedCount} learned card${learnedCount === 1 ? '' : 's'} · about ${dailyTarget} a day for ${SWEEP_SPREAD_DAYS} days`
      : `${deckTitle} has no learned cards to sweep yet.`;

  return {
    slug,
    deckTitle,
    mode: 'sweep',
    limit,
    minimumGoal: SESSION_MIN_GOAL,
    dueCount,
    newCount,
    nodes,
    summary,
  };
}

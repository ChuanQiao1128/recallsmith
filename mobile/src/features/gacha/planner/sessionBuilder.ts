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

export function buildChallengeRoute(params: {
  slug: string;
  deckTitle: string;
  dueCount: number;
  newCount: number;
}): ChallengeRoute {
  const { slug, deckTitle, dueCount, newCount } = params;
  const hasTodayWork = dueCount > 0 || newCount > 0;
  // R6/F10: one fresh card should plan a one-node route the user can full-clear.
  const limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)) : 1;

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

  const summary = hasTodayWork
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
  const limit = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget));

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

  const summary = `${deckTitle} · ${learnedCount} learned card${learnedCount === 1 ? '' : 's'} · about ${dailyTarget} a day for ${SWEEP_SPREAD_DAYS} days`;

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

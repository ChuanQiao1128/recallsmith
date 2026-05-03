import type { RouteNodeRole } from '../contracts';

export function resolveRouteRole(params: {
  index: number;
  total: number;
  hasElite: boolean;
  hasBoss: boolean;
}): RouteNodeRole {
  const { index, total, hasElite, hasBoss } = params;

  if (index === 0) return 'warmup';
  if (hasBoss && index === total - 1) return 'boss';
  if (hasElite && index === Math.max(1, total - 2)) return 'elite';
  return 'normal';
}

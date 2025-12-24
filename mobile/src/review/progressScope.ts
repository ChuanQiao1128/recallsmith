import { useAuthStore } from '../auth/authStore';

export function getProgressScopeKey(): string {
  const s = useAuthStore.getState();
  const userId = s.userId;

  if (s.status === 'signed_in' && userId) return `u:${userId}`;
  return 'anon';
}
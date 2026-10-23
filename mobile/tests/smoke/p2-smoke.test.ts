import { it, vi } from 'vitest';

// The smoke checks exercise pure functions; only the native storage import needs a Node boundary.
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

it('passes the P2 smoke assertions against the actual product modules', async () => {
  await import('../p2-smoke');
});

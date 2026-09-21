// D05: the flag-gated 'mcq' capability token. getClientCapabilities reads
// getFeatureFlags().mcq.enabled at call time, so the same module instance
// advertises 'mcq' under the default flags and nothing under the kill switch.
// expo-updates is stubbed to a null updateId so the update-id key never appears.
import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('expo-updates', () => ({ updateId: null }));

import { applyRemoteFeatures } from '../../src/config/featureFlags';
import {
  CLIENT_FEATURES,
  getClientCapabilities,
  normalizeClientFeatures,
  resetClientCapabilitiesForTests,
} from '../../src/sync/clientCapabilities';

describe('clientCapabilities mcq token', () => {
  beforeEach(() => {
    resetClientCapabilitiesForTests();
    applyRemoteFeatures(null);
  });

  it('advertises mcq under the default flags', async () => {
    expect(await getClientCapabilities()).toEqual({ clientFeatures: ['mcq'] });
  });

  it('sends no clientFeatures key under the kill switch', async () => {
    applyRemoteFeatures({ features: { mcq: { enabled: false } } });
    const caps = await getClientCapabilities();
    expect(caps).toEqual({});
    expect('clientFeatures' in caps).toBe(false);
  });

  it('reads the flag at call time and keeps CLIENT_FEATURES empty', async () => {
    applyRemoteFeatures({ features: { mcq: { enabled: false } } });
    expect(await getClientCapabilities()).toEqual({});
    resetClientCapabilitiesForTests();
    applyRemoteFeatures(null);
    expect(await getClientCapabilities()).toEqual({ clientFeatures: ['mcq'] });
    expect(CLIENT_FEATURES).toEqual([]);
  });

  it('still sorts, dedupes and caps the token list', () => {
    expect(normalizeClientFeatures(['MCQ ', 'mcq', 'zeta', 'alpha'])).toEqual(['alpha', 'mcq', 'zeta']);
    const twenty = Array.from({ length: 20 }, (_, i) => `token${i}`);
    expect(normalizeClientFeatures(twenty)).toHaveLength(16);
  });
});

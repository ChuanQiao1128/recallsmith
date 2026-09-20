// clientCapabilities reads expo-updates through a guarded dynamic import so that
// the ten unit suites importing progressSync never drag react-native Image /
// requireNativeModule into a node worker. These tests pin that guard: the module
// resolves {} when the package throws or yields no string, lower-cases and caches
// a real update id, and never emits an undefined-valued key. A top-level getter
// mock counts reads (reachable through the dynamic import under this vitest); the
// throwing and real-module paths use vi.doMock / vi.doUnmock + a fresh import.
import fc from 'fast-check';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ reads: 0, updateId: 'ABC-Def' as unknown }));
vi.mock('expo-updates', () => ({
  get updateId() {
    mockState.reads += 1;
    return mockState.updateId;
  },
}));

import {
  CLIENT_FEATURES,
  getClientCapabilities,
  normalizeClientFeatures,
  resetClientCapabilitiesForTests,
} from '../../src/sync/clientCapabilities';

describe('clientCapabilities', () => {
  beforeEach(() => {
    mockState.reads = 0;
    mockState.updateId = 'ABC-Def';
    // Re-arm the getter for every case: the real-module case below unmocks
    // expo-updates and that registration would otherwise persist and starve the
    // statically-imported module of the counting getter.
    vi.doMock('expo-updates', () => ({
      get updateId() {
        mockState.reads += 1;
        return mockState.updateId;
      },
    }));
    resetClientCapabilitiesForTests();
  });

  it('resolves {} when expo-updates cannot be loaded', async () => {
    vi.resetModules();
    vi.doMock('expo-updates', () => {
      throw new Error('missing');
    });
    try {
      const mod = await import('../../src/sync/clientCapabilities');
      expect(await mod.getClientCapabilities()).toEqual({});
    } finally {
      vi.doUnmock('expo-updates');
      vi.resetModules();
    }
  });

  it('resolves {} against the real expo-updates module under node', async () => {
    vi.doUnmock('expo-updates');
    vi.resetModules();
    const mod = await import('../../src/sync/clientCapabilities');
    await expect(mod.getClientCapabilities()).resolves.toEqual({});
    vi.resetModules();
  });

  it('resolves { updateId } lower-cased when expo-updates provides one', async () => {
    mockState.updateId = 'ABC-Def';
    expect(await getClientCapabilities()).toEqual({ updateId: 'abc-def' });
  });

  it('omits updateId when the module value is null or not a string', async () => {
    mockState.updateId = null;
    expect(await getClientCapabilities()).toEqual({});
    resetClientCapabilitiesForTests();
    mockState.updateId = 42;
    expect(await getClientCapabilities()).toEqual({});
    resetClientCapabilitiesForTests();
    mockState.updateId = '';
    expect(await getClientCapabilities()).toEqual({});
    resetClientCapabilitiesForTests();
    mockState.updateId = 'a'.repeat(65);
    expect(await getClientCapabilities()).toEqual({});
  });

  it('caches the update id until reset', async () => {
    await getClientCapabilities();
    await getClientCapabilities();
    expect(mockState.reads).toBe(1);
    resetClientCapabilitiesForTests();
    await getClientCapabilities();
    expect(mockState.reads).toBe(2);
  });

  it('never sends undefined-valued keys', async () => {
    mockState.updateId = null;
    const caps = await getClientCapabilities();
    expect(Object.keys(caps)).toEqual([]);
    expect('clientFeatures' in caps).toBe(false);
    expect('updateId' in caps).toBe(false);
  });

  it('ships no feature tokens in Wave C', async () => {
    expect(CLIENT_FEATURES).toEqual([]);
    mockState.updateId = null;
    const caps = await getClientCapabilities();
    expect('clientFeatures' in caps).toBe(false);
  });

  it('normalizes feature tokens: trim, lower-case, grammar, dedupe, sort, cap at 16', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)), {
          maxLength: 40,
        }),
        (input) => {
          const out = normalizeClientFeatures(input as readonly unknown[]);
          for (const item of out) expect(item).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
          for (let i = 0; i + 1 < out.length; i++) expect(out[i] < out[i + 1]).toBe(true);
          expect(out.length).toBeLessThanOrEqual(16);
          const lowered = input
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim().toLowerCase());
          for (const item of out) expect(lowered).toContain(item);
        },
      ),
    );
  });

  it('is idempotent and keeps every valid token when at most sixteen', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_-]{0,31}$/), { maxLength: 16 }),
        (tokens) => {
          expect(normalizeClientFeatures(tokens)).toEqual([...tokens].sort());
          expect(normalizeClientFeatures(normalizeClientFeatures(tokens))).toEqual(
            normalizeClientFeatures(tokens),
          );
        },
      ),
    );
  });
});

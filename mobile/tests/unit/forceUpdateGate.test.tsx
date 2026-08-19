import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * App.tsx renders the Navigator when this hook says null and an overlay when
 * it says otherwise. So "is null on the first render" is not a detail of the
 * hook -- it is the claim that a cold start no longer waits on a network
 * round trip before anything appears.
 */

let configFixture: any = null;
let resolveConfig: ((value: any) => void) | null = null;
let configLoader: () => Promise<any> = async () => configFixture;

vi.mock('../../src/config/remoteConfig', () => ({
  getCurrentAppVersion: () => '1.4.0',
  loadRemoteConfig: vi.fn(() => configLoader()),
  resolveIosUpdate: (config: any, currentVersion: string) => {
    const min = config?.ios?.minSupportedVersion ?? null;
    const [a, b, c] = String(currentVersion).split('.').map(Number);
    const [x, y, z] = String(min ?? '0.0.0').split('.').map(Number);
    const below = a !== x ? a < x : b !== y ? b < y : c < z;
    return {
      forceUpdate: !!min && below,
      updateUrl: config?.ios?.updateUrl ?? null,
      message: config?.ios?.message ?? 'A new version is required to continue.',
      minSupportedVersion: min,
      latestVersion: null,
    };
  },
}));

import { useForceUpdateGate, type ForceUpdateGate } from '../../src/config/forceUpdateGate';

const renders: Array<ForceUpdateGate | null> = [];

function Probe() {
  const gate = useForceUpdateGate('https://cdn.test/config.json');
  renders.push(gate);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useForceUpdateGate', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    renders.length = 0;
    configFixture = null;
    resolveConfig = null;
    configLoader = async () => configFixture;
  });

  it('is null on the very first render, before the config has been asked for', async () => {
    configFixture = { ios: { minSupportedVersion: '2.0.0', updateUrl: 'https://apps.apple.com/app/id1' } };
    // Never resolves: this is the offline cold start that used to sit on a
    // full-screen spinner until the fetch timed out.
    configLoader = () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      });

    await act(async () => {
      renderer.create(<Probe />);
    });
    await flush();

    expect(renders[0]).toBeNull();
    expect(renders.every((gate) => gate === null)).toBe(true);
    expect(resolveConfig).not.toBeNull();
  });

  it('raises the gate once a gating config arrives', async () => {
    configFixture = {
      ios: {
        minSupportedVersion: '2.0.0',
        updateUrl: 'https://apps.apple.com/app/id1',
        message: 'Please update.',
      },
    };

    await act(async () => {
      renderer.create(<Probe />);
    });
    await flush();

    expect(renders[0]).toBeNull();
    expect(renders.at(-1)).toEqual({
      message: 'Please update.',
      updateUrl: 'https://apps.apple.com/app/id1',
      currentVersion: '1.4.0',
      minSupportedVersion: '2.0.0',
    });
  });

  it('stays null for a version the config still supports', async () => {
    configFixture = { ios: { minSupportedVersion: '1.0.0' } };

    await act(async () => {
      renderer.create(<Probe />);
    });
    await flush();

    expect(renders.every((gate) => gate === null)).toBe(true);
  });

  it('stays null when no config could be read at all', async () => {
    configFixture = null;

    await act(async () => {
      renderer.create(<Probe />);
    });
    await flush();

    expect(renders.every((gate) => gate === null)).toBe(true);
  });
});

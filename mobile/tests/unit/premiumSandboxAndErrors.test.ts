import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// revenuecat.ts reads EXPO_PUBLIC_RC_ENTITLEMENT_ID at module scope, so it must
// be set before the module graph is imported.
const ENTITLEMENT_ID = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_RC_ENTITLEMENT_ID = 'premium';
  process.env.EXPO_PUBLIC_RC_IOS_API_KEY = 'test_key';
  process.env.EXPO_PUBLIC_RC_MONTHLY_PRODUCT_ID = 'premium_monthly';
  return 'premium';
});

// Force IS_PROD === true: appEnv treats an Updates.channel of 'production' as a
// hard production build regardless of __DEV__.
vi.mock('expo-updates', () => ({
  channel: 'production',
}));

vi.mock('react-native-purchases', () => ({
  default: {
    setLogLevel: vi.fn(),
    LOG_LEVEL: { DEBUG: 'debug', WARN: 'warn' },
    configure: vi.fn(),
    getCustomerInfo: vi.fn(async () => ({ entitlements: { active: {}, all: {} } })),
    invalidateCustomerInfoCache: vi.fn(async () => {}),
    logIn: vi.fn(async () => ({ created: false })),
    logOut: vi.fn(async () => {}),
  },
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({ tokens: {} })),
}));

const asyncStore = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.map.has(k) ? asyncStore.map.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore.map.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      asyncStore.map.delete(k);
    }),
  },
}));

import { IS_PROD } from '../../src/config/appEnv';
import { getPremiumStatus } from '../../src/premium/revenuecat';
import { classifyPurchaseError } from '../../src/premium/purchaseErrors';
import { usePremiumStatus, type PremiumStatusState } from '../../src/premium/premiumStore';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  asyncStore.map.clear();
  (globalThis as any).__DEV__ = false;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('sandbox premium on production builds', () => {
  it('counts an active sandbox entitlement as premium on a production build', () => {
    expect(IS_PROD).toBe(true);

    const info = {
      entitlements: {
        active: {
          [ENTITLEMENT_ID]: {
            isActive: true,
            isSandbox: true,
            productIdentifier: 'premium_monthly',
          },
        },
        all: {},
      },
    } as any;

    const status = getPremiumStatus(info);
    expect(status.active).toBe(true);
    expect(status.activeSandbox).toBe(true);
    expect(status.env).toBe('sandbox');
  });

  it('still counts an active production entitlement and ignores an expired one', () => {
    const activeProd = {
      entitlements: {
        active: {
          [ENTITLEMENT_ID]: {
            isActive: true,
            isSandbox: false,
            productIdentifier: 'premium_monthly',
          },
        },
        all: {},
      },
    } as any;

    const prodStatus = getPremiumStatus(activeProd);
    expect(prodStatus.active).toBe(true);
    expect(prodStatus.env).toBe('production');

    const expired = {
      entitlements: {
        active: {},
        all: {
          [ENTITLEMENT_ID]: {
            isActive: false,
            isSandbox: false,
            expirationDate: '2000-01-01T00:00:00.000Z',
            productIdentifier: 'premium_monthly',
          },
        },
      },
    } as any;

    const expiredStatus = getPremiumStatus(expired);
    expect(expiredStatus.active).toBe(false);
    expect(expiredStatus.env).toBe('none');
  });
});

describe('classifyPurchaseError', () => {
  it('classifies PAYMENT_PENDING, network and cancelled purchase errors', () => {
    expect(classifyPurchaseError({ code: '20' })).toBe('pending');

    expect(classifyPurchaseError({ code: '10' })).toBe('network');
    expect(classifyPurchaseError({ code: '32' })).toBe('network');
    expect(classifyPurchaseError({ code: '35' })).toBe('network');
    expect(classifyPurchaseError({ message: 'The Internet connection appears to be offline.' })).toBe(
      'network',
    );

    expect(classifyPurchaseError({ userCancelled: true })).toBe('cancelled');
    expect(classifyPurchaseError({ code: '1' })).toBe('cancelled');

    expect(classifyPurchaseError({ code: '6' })).toBe('already_owned');
    expect(classifyPurchaseError({ code: '2' })).toBe('store');
    expect(classifyPurchaseError({})).toBe('unknown');
  });
});

describe('usePremiumStatus', () => {
  function Probe({ hint, onState }: { hint: string; onState: (s: PremiumStatusState) => void }) {
    const state = usePremiumStatus(hint);
    onState(state);
    return null;
  }

  it('usePremiumStatus starts unknown and resolves to premium or free', async () => {
    // premium user: cache says '1'
    asyncStore.map.set('devcards:entitlements:isPremium:v1:paying-user', '1');

    const seen: PremiumStatusState[] = [];
    await act(async () => {
      renderer.create(
        React.createElement(Probe, { hint: 'paying-user', onState: (s) => seen.push(s) }),
      );
    });
    expect(seen[0]).toBe('unknown');
    await flush();
    expect(seen[seen.length - 1]).toBe('premium');

    // free user: no cache entry
    const seenFree: PremiumStatusState[] = [];
    await act(async () => {
      renderer.create(
        React.createElement(Probe, { hint: 'free-user', onState: (s) => seenFree.push(s) }),
      );
    });
    expect(seenFree[0]).toBe('unknown');
    await flush();
    expect(seenFree[seenFree.length - 1]).toBe('free');
  });
});

// G03 (R25 §3): the Debug menu and its 7-tap door exist only in __DEV__ builds and on
// update channels other than "production" — the same channel rule Sentry uses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({ module: null as { channel?: unknown } | null }));

vi.mock('../../src/updates/otaUpdateCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/updates/otaUpdateCheck')>();
  return { ...actual, getExpoUpdatesModule: () => updates.module };
});

import { isDebugMenuAvailable } from '../../src/config/debugMenu';
import { debugMenuRoute } from '../../src/navigation/debugMenuRoute';
import { decideSentry, isProductionChannel } from '../../src/telemetry/sentryPolicy';

describe('isDebugMenuAvailable', () => {
  afterEach(() => {
    (globalThis as Record<string, unknown>).__DEV__ = true;
    updates.module = null;
  });

  it('is false on the production channel outside __DEV__', () => {
    expect(isDebugMenuAvailable({ isDev: false, channel: 'production' })).toBe(false);
    expect(isDebugMenuAvailable({ isDev: false, channel: ' Production ' })).toBe(false);
  });

  it('is true on the preview / development channels and in __DEV__', () => {
    expect(isDebugMenuAvailable({ isDev: false, channel: 'preview' })).toBe(true);
    expect(isDebugMenuAvailable({ isDev: false, channel: 'development' })).toBe(true);
    expect(isDebugMenuAvailable({ isDev: true, channel: 'production' })).toBe(true);
  });

  it('reads __DEV__ and the expo-updates channel by default', () => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    updates.module = { channel: 'production' };
    expect(isDebugMenuAvailable()).toBe(false);
    updates.module = { channel: 'preview' };
    expect(isDebugMenuAvailable()).toBe(true);
    (globalThis as Record<string, unknown>).__DEV__ = true;
    updates.module = { channel: 'production' };
    expect(isDebugMenuAvailable()).toBe(true);
  });

  it('shares the channel rule with the Sentry gate', () => {
    for (const channel of ['production', 'PRODUCTION', 'preview', 'development', '', undefined, null]) {
      const gate = decideSentry({ isDev: false, channel, dsn: undefined, killed: false });
      const sentryChannelOk = gate.enabled || gate.reason !== 'channel';
      expect(isProductionChannel(channel)).toBe(sentryChannelOk);
      expect(isDebugMenuAvailable({ isDev: false, channel })).toBe(!sentryChannelOk);
    }
  });
});

describe('DebugMenu route registration', () => {
  afterEach(() => {
    (globalThis as Record<string, unknown>).__DEV__ = true;
    updates.module = null;
  });

  const screen = () => <React.Fragment key="debug">DebugMenu</React.Fragment>;

  it('registers nothing on the production channel', () => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    updates.module = { channel: 'production' };
    expect(debugMenuRoute(screen)).toBeNull();
  });

  it('registers the route on the preview channel and in __DEV__', () => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    updates.module = { channel: 'preview' };
    expect(debugMenuRoute(screen)).not.toBeNull();
    (globalThis as Record<string, unknown>).__DEV__ = true;
    updates.module = { channel: 'production' };
    expect(debugMenuRoute(screen)).not.toBeNull();
  });

  it('App.tsx registers DebugMenu only through debugMenuRoute', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const registrations = app.match(/<Stack\.Screen\s+name="DebugMenu"/g) ?? [];
    expect(registrations).toHaveLength(1);
    expect(app).toMatch(/debugMenuRoute\(\s*\(\)\s*=>\s*<Stack\.Screen\s+name="DebugMenu"/);
  });
});

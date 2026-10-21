import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ status: { signedIn: true, pending: 0, error: false, syncing: false, lastPushAtMs: 20, lastPullAtMs: 10 }, force: vi.fn(async () => {}) }));
vi.mock('react-native', () => {
  const React = require('react');
  return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (s: any) => s } };
});
vi.mock('../../src/auth/authStore', () => ({ useAuthStore: (select: any) => select({ userId: 'A' }) }));
vi.mock('../../src/sync/progressSync', () => ({ getProgressSyncStatus: async () => mock.status, forceProgressSync: mock.force }));
import { ProgressSyncStatus } from '../../src/features/gacha/components/ProgressSyncStatus';
let tree: renderer.ReactTestRenderer;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
async function mount() { await act(async () => { tree = renderer.create(<ProgressSyncStatus />); }); }
const text = () => tree.root.findAllByType('Text' as any).map(n => n.props.children).join(' ');
describe('progress sync status readback confirmation', () => {
  it('offers retry when upload is newer than the last confirmed pull', async () => {
    await mount();
    expect(text()).toContain('Sync not confirmed');
    expect(text()).not.toContain('Progress synced');
    mock.status = { ...mock.status, lastPullAtMs: 21 };
    await act(async () => tree.root.findByType('Pressable' as any).props.onPress());
    expect(mock.force).toHaveBeenCalledWith('manual');
    expect(text()).toBe('Progress synced');
  });
  it('keeps local-save and retry copy when the pull failed', async () => {
    mock.status = { ...mock.status, error: true };
    await mount();
    expect(text()).toContain('Saved on this device');
    expect(text()).toContain('Sync needs retry');
    expect(text()).not.toContain('Progress synced');
  });
});

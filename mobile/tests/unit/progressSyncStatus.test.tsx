import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ status: { signedIn: true, pending: 0, error: false, syncing: false, automaticRetry: false, lastPushAtMs: 20, lastPullAtMs: 10 }, force: vi.fn<() => Promise<void>>(), read: vi.fn(), announce: vi.fn(), userId: 'A', generation: 0, platform: 'ios' }));
vi.mock('react-native', () => {
  const React = require('react');
  return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (s: any) => s }, AccessibilityInfo: { announceForAccessibility: mock.announce }, Platform: { get OS() { return mock.platform; } } };
});
vi.mock('../../src/auth/authStore', () => ({ useAuthStore: Object.assign((select: any) => select({ userId: mock.userId }), { getState: () => ({ userId: mock.userId }) }) }));
vi.mock('../../src/auth/sessionBoundary', () => ({ getAuthSessionGeneration: () => mock.generation }));
vi.mock('../../src/sync/progressSync', () => ({ getProgressSyncStatus: mock.read, forceProgressSync: mock.force }));
import { ProgressSyncStatus } from '../../src/features/gacha/components/ProgressSyncStatus';
let tree: renderer.ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  mock.status = { signedIn: true, pending: 0, error: false, syncing: false, automaticRetry: false, lastPushAtMs: 20, lastPullAtMs: 10 };
  mock.force.mockReset().mockResolvedValue(undefined);
  mock.read.mockReset().mockImplementation(async () => mock.status);
  mock.announce.mockClear(); mock.userId = 'A'; mock.generation = 0; mock.platform = 'ios';
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); vi.useRealTimers(); });
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
  it('explains that transient failures will retry automatically and still offers manual retry', async () => {
    mock.status = { ...mock.status, error: true, automaticRetry: true };
    await mount();
    expect(text()).toContain('Will retry automatically');
    expect(text()).not.toContain('Progress synced');
    expect(tree.root.findByType('Pressable' as any).props.accessibilityLabel).toBe('Retry progress sync');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function poll() { await act(async () => { vi.advanceTimersByTime(3000); }); }
async function rerender() { await act(async () => { tree.update(<ProgressSyncStatus />); }); }

describe('progress sync native accessibility and account guards', () => {
  it('announces meaningful iOS transitions once, without narrating every poll or queue count', async () => {
    await mount();
    expect(mock.announce).not.toHaveBeenCalled();
    await poll();
    expect(mock.announce).not.toHaveBeenCalled();
    mock.status = { ...mock.status, error: true };
    await poll();
    expect(mock.announce).toHaveBeenCalledWith('Saved on this device · Sync needs retry');
    await poll();
    expect(mock.announce).toHaveBeenCalledTimes(1);
    mock.status = { ...mock.status, error: false, pending: 2 };
    await poll();
    expect(mock.announce).toHaveBeenCalledTimes(2);
    mock.status = { ...mock.status, pending: 1 };
    await poll();
    expect(text()).toContain('1 waiting to sync');
    expect(mock.announce).toHaveBeenCalledTimes(2);
    mock.status = { ...mock.status, pending: 0, lastPullAtMs: 21 };
    await poll();
    expect(mock.announce).toHaveBeenLastCalledWith('Progress synced');
    await poll();
    expect(mock.announce).toHaveBeenCalledTimes(3);
    expect(tree.root.findAllByType('Text' as any)[0].props.accessibilityLiveRegion).toBeUndefined();
  });

  it('uses an Android live region without an additional iOS announcement', async () => {
    mock.platform = 'android';
    await mount();
    expect(tree.root.findAllByType('Text' as any)[0].props.accessibilityLiveRegion).toBe('polite');
    mock.status = { ...mock.status, error: true };
    await poll();
    expect(mock.announce).not.toHaveBeenCalled();
  });

  it('ignores a late account-A poll after account B has rendered', async () => {
    const old = deferred<typeof mock.status>();
    mock.read.mockReturnValueOnce(old.promise);
    await mount();
    mock.userId = 'B'; mock.generation += 1;
    mock.status = { ...mock.status, lastPullAtMs: 21 };
    await rerender();
    expect(text()).toBe('Progress synced');
    await act(async () => { old.resolve({ ...mock.status, error: true }); });
    expect(text()).toBe('Progress synced');
    expect(mock.announce).not.toHaveBeenCalled();
  });

  it('ignores an older poll that finishes after a newer response', async () => {
    const old = deferred<typeof mock.status>();
    mock.read.mockReturnValueOnce(old.promise);
    await mount();
    mock.status = { ...mock.status, lastPullAtMs: 21 };
    await poll();
    await act(async () => { old.resolve({ ...mock.status, error: true }); });
    expect(text()).toBe('Progress synced');
    expect(mock.announce).not.toHaveBeenCalled();
  });

  it('marks Retry busy/disabled, prevents duplicate presses and defers polling during the retry', async () => {
    const work = deferred<void>();
    mock.force.mockReturnValueOnce(work.promise);
    await mount();
    const retry = tree.root.findByType('Pressable' as any);
    await act(async () => { retry.props.onPress(); retry.props.onPress(); });
    expect(mock.force).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType('Pressable' as any).props.accessibilityState).toEqual({ disabled: true, busy: true });
    await poll();
    expect(mock.read).toHaveBeenCalledTimes(1);
    mock.status = { ...mock.status, lastPullAtMs: 21 };
    await act(async () => { work.resolve(); });
    expect(text()).toBe('Progress synced');
  });

  it('rejects an old manual result after A leaves and returns in a newer session', async () => {
    const work = deferred<void>();
    mock.force.mockReturnValueOnce(work.promise);
    await mount();
    await act(async () => { tree.root.findByType('Pressable' as any).props.onPress(); });
    mock.announce.mockClear();
    mock.generation += 2;
    await rerender();
    expect(text()).toBe('Checking sync status…');
    mock.status = { ...mock.status, pending: 1 };
    await poll();
    expect(text()).toContain('1 waiting to sync');
    expect(tree.root.findByType('Pressable' as any).props.accessibilityState.disabled).toBe(false);
    await act(async () => { work.resolve(); });
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(text()).toContain('1 waiting to sync');
    expect(mock.announce).not.toHaveBeenCalled();
  });
});

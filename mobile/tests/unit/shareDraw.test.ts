import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-view-shot', () => ({
  captureRef: vi.fn(async () => 'file:///tmp/draw.png'),
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));

import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { SHARE_DRAW_TESTID, shareDrawImage } from '../../src/features/gacha/share/shareDraw';

describe('shareDrawImage', () => {
  beforeEach(() => {
    vi.mocked(captureRef).mockReset();
    vi.mocked(captureRef).mockImplementation(async () => 'file:///tmp/draw.png');
    vi.mocked(Sharing.isAvailableAsync).mockReset();
    vi.mocked(Sharing.isAvailableAsync).mockImplementation(async () => true);
    vi.mocked(Sharing.shareAsync).mockReset();
    vi.mocked(Sharing.shareAsync).mockImplementation(async () => {});
  });

  it('shares a captured PNG through expo-sharing', async () => {
    const ref = { current: {} };
    const result = await shareDrawImage(ref, { slug: 'csharp', deckTitle: 'C# Interview' });
    expect(result).toEqual({ status: 'shared' });
    expect(captureRef).toHaveBeenCalledTimes(1);
    expect(captureRef).toHaveBeenCalledWith(ref, expect.objectContaining({ format: 'png', result: 'tmpfile' }));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///tmp/draw.png',
      expect.objectContaining({ mimeType: 'image/png', dialogTitle: 'C# Interview pull' }),
    );

    vi.mocked(Sharing.shareAsync).mockClear();
    const noTitle = await shareDrawImage(ref, { slug: 'csharp' });
    expect(noTitle).toEqual({ status: 'shared' });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///tmp/draw.png',
      expect.objectContaining({ dialogTitle: 'csharp pull' }),
    );
  });

  it('returns unavailable when the ref has no node or sharing is unavailable', async () => {
    const noNode = await shareDrawImage({ current: null }, { slug: 'csharp' });
    expect(noNode).toEqual({ status: 'unavailable' });
    expect(captureRef).not.toHaveBeenCalled();

    vi.mocked(Sharing.isAvailableAsync).mockImplementation(async () => false);
    const unavailable = await shareDrawImage({ current: {} }, { slug: 'csharp' });
    expect(unavailable).toEqual({ status: 'unavailable' });
    expect(captureRef).not.toHaveBeenCalled();
  });

  it('returns failed and never throws when capture or share rejects', async () => {
    vi.mocked(captureRef).mockImplementation(async () => {
      throw new Error('capture boom');
    });
    expect(await shareDrawImage({ current: {} }, { slug: 'csharp' })).toEqual({ status: 'failed' });

    vi.mocked(captureRef).mockImplementation(async () => 'file:///tmp/draw.png');
    vi.mocked(Sharing.shareAsync).mockImplementation(async () => {
      throw new Error('share boom');
    });
    expect(await shareDrawImage({ current: {} }, { slug: 'csharp' })).toEqual({ status: 'failed' });

    vi.mocked(Sharing.shareAsync).mockClear();
    vi.mocked(Sharing.shareAsync).mockImplementation(async () => {});
    vi.mocked(captureRef).mockImplementation(async () => '');
    expect(await shareDrawImage({ current: {} }, { slug: 'csharp' })).toEqual({ status: 'failed' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('reports cancelled for a second call while one share is in flight', async () => {
    let releaseShare!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseShare = resolve;
    });
    vi.mocked(Sharing.shareAsync).mockImplementation(() => deferred);

    const first = shareDrawImage({ current: {} }, { slug: 'csharp' });
    const second = shareDrawImage({ current: {} }, { slug: 'csharp' });
    expect(await second).toEqual({ status: 'cancelled' });

    releaseShare();
    expect(await first).toEqual({ status: 'shared' });

    vi.mocked(Sharing.shareAsync).mockImplementation(async () => {});
    expect(await shareDrawImage({ current: {} }, { slug: 'csharp' })).toEqual({ status: 'shared' });
  });

  it('returns unavailable when expo-sharing cannot be loaded', async () => {
    vi.resetModules();
    vi.doMock('expo-sharing', () => {
      throw new Error('missing');
    });
    try {
      const mod = await import('../../src/features/gacha/share/shareDraw');
      expect(await mod.shareDrawImage({ current: {} }, { slug: 'csharp' })).toEqual({ status: 'unavailable' });
    } finally {
      vi.doUnmock('expo-sharing');
      vi.resetModules();
    }
  });

  it('exposes the DrawResult share testID', () => {
    expect(SHARE_DRAW_TESTID).toBe('draw-result-share-button');
  });
});

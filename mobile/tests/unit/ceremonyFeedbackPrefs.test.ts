// The sound/haptics preference gates on the ceremony controllers, exercised through the same
// dependency-injected surface as ceremonyAudio.test.ts / ceremonyHaptics.test.ts. The gate is
// injected (isEnabled) so these tests never touch the feedbackPrefs singleton.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCeremonyAudioController, type ExpoAudioLike } from '../../src/components/ceremonyAudio';
import { createCeremonyHapticsController, type ExpoHapticsLike } from '../../src/components/ceremonyHaptics';

type FakePlayer = {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  volume: number;
  loop: boolean;
  playing: boolean;
  __source: unknown;
};

function makeFakeAudio() {
  const players: FakePlayer[] = [];
  const audio = {
    createAudioPlayer: vi.fn((source: unknown) => {
      const p: FakePlayer = {
        play: vi.fn(), pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn(),
        volume: 1, loop: false, playing: false, __source: source,
      };
      p.play.mockImplementation(() => { p.playing = true; });
      p.pause.mockImplementation(() => { p.playing = false; });
      players.push(p);
      return p;
    }),
    setAudioModeAsync: vi.fn(async () => {}),
  } as unknown as ExpoAudioLike;
  return { audio, players };
}

const SOURCES = {
  ambience: 'ambience.wav', whoosh: 'whoosh.wav', rip: 'rip.wav', 'card-drop': 'card-drop.wav',
  'card-flip': 'card-flip.wav', shimmer: 'shimmer.wav', legendary: 'legendary.wav',
};

function makeFakeHaptics() {
  return {
    impactAsync: vi.fn(async () => {}),
    selectionAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ceremony feedback prefs gate', () => {
  it('sets the audio mode to respect the silent switch', () => {
    const { audio } = makeFakeAudio();
    const ctrl = createCeremonyAudioController({ audio, sources: SOURCES, isEnabled: () => true });
    ctrl.warmUp();
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: false, interruptionMode: 'mixWithOthers',
    });
  });

  it('plays no ceremony sound while sound effects are off', () => {
    vi.useFakeTimers();
    const { players, ctrl } = (() => {
      const { audio, players } = makeFakeAudio();
      return { players, ctrl: createCeremonyAudioController({ audio, sources: SOURCES, isEnabled: () => false }) };
    })();
    ctrl.warmUp();
    ctrl.hit('rip');
    ctrl.tail('sparkle-tail');
    ctrl.play('legendary');
    ctrl.bed('air');
    ctrl.play('air');
    vi.advanceTimersByTime(1000);
    for (const p of players) expect(p.play).not.toHaveBeenCalled();

    // Sanity: with the gate on, the same calls do play.
    const on = makeFakeAudio();
    const onCtrl = createCeremonyAudioController({ audio: on.audio, sources: SOURCES, isEnabled: () => true });
    onCtrl.hit('rip');
    expect(on.players.some((p) => p.play.mock.calls.length > 0)).toBe(true);
  });

  it('skips ceremony haptics while haptics are off', () => {
    const h = makeFakeHaptics();
    const off = createCeremonyHapticsController({ haptics: h as unknown as ExpoHapticsLike, isEnabled: () => false });
    off.tick();
    off.impact('heavy');
    off.success();
    expect(h.selectionAsync).not.toHaveBeenCalled();
    expect(h.impactAsync).not.toHaveBeenCalled();
    expect(h.notificationAsync).not.toHaveBeenCalled();

    // With the gate on, the same calls fire.
    const on = createCeremonyHapticsController({ haptics: h as unknown as ExpoHapticsLike, isEnabled: () => true });
    on.tick();
    on.impact('heavy');
    on.success();
    expect(h.selectionAsync).toHaveBeenCalledTimes(1);
    expect(h.impactAsync).toHaveBeenCalledTimes(1);
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
  });
});

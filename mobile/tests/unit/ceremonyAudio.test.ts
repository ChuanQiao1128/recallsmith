import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BED_FADE_MS,
  CEREMONY_GAIN,
  SFX_ALIASES,
  ceremonyAudioAvailable,
  createCeremonyAudioController,
  getCeremonyAudio,
  useCeremonyAudio,
  type ExpoAudioLike,
} from '../../src/components/ceremonyAudio';

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
      players.push(p);
      return p;
    }),
    setAudioModeAsync: vi.fn(async () => {}),
  } as unknown as ExpoAudioLike;
  return { audio, players };
}

const SOURCES = {
  whoosh: 'whoosh.wav', rip: 'rip.wav', 'card-drop': 'card-drop.wav',
  'card-flip': 'card-flip.wav', shimmer: 'shimmer.wav', legendary: 'legendary.wav',
};

function setup(sources: Partial<Record<string, unknown>> = SOURCES) {
  const { audio, players } = makeFakeAudio();
  const ctrl = createCeremonyAudioController({ audio, sources });
  return { audio, players, ctrl };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ceremonyAudio', () => {
  it('SFX_ALIASES maps 17 names onto the six committed files', () => {
    const files = ['whoosh', 'rip', 'card-drop', 'card-flip', 'shimmer', 'legendary'];
    const keys = Object.keys(SFX_ALIASES);
    expect(keys).toHaveLength(17);
    for (const v of Object.values(SFX_ALIASES)) expect(files).toContain(v);
    for (const f of files) expect(SFX_ALIASES[f as keyof typeof SFX_ALIASES]).toBe(f);
  });

  it('CEREMONY_GAIN holds the fixed gain table', () => {
    expect(CEREMONY_GAIN.bed).toEqual({ COM: 0.30, RAR: 0.35, LEG: 0.40 });
    expect(CEREMONY_GAIN.bedTable).toBe(0.25);
    expect(CEREMONY_GAIN.duck).toBe(0.15);
    expect(CEREMONY_GAIN.hit.rip).toBe(0.8);
    expect(CEREMONY_GAIN.hit.stinger).toBe(1.0);
    expect(CEREMONY_GAIN.hit.legendary).toBe(1.0);
    expect(CEREMONY_GAIN.hit['card-flip']).toBe(0.5);
    expect(CEREMONY_GAIN.tail['soft-chime']).toBe(0.5);
  });

  it('prewarm creates one player per name and sets audio mode once', () => {
    const { audio, players, ctrl } = setup();
    ctrl.prewarm();
    expect(players).toHaveLength(17);
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true, interruptionMode: 'mixWithOthers',
    });
    const usedSources = (audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    // alias counts per committed file
    const count = (f: string) => usedSources.filter((s) => s === f).length;
    expect(count('shimmer.wav')).toBe(7);
    expect(count('legendary.wav')).toBe(3);
    expect(count('card-drop.wav')).toBe(3);
    expect(count('rip.wav')).toBe(2);
    expect(count('whoosh.wav')).toBe(1);
    expect(count('card-flip.wav')).toBe(1);
    ctrl.prewarm();
    expect(players).toHaveLength(17);
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('hit sets the per-name gain, seeks and plays', () => {
    const { players, ctrl } = setup();
    ctrl.hit('rip');
    const p = players[0];
    expect(p.__source).toBe('rip.wav');
    expect(p.volume).toBe(0.8);
    expect(p.seekTo).toHaveBeenCalledWith(0);
    expect(p.play).toHaveBeenCalledTimes(1);
    ctrl.hit('rip', { gain: 0.3 });
    expect(p.volume).toBe(0.3);
    expect(p.play).toHaveBeenCalledTimes(2);
  });

  it('tail plays at the tail gain', () => {
    const { players, ctrl } = setup();
    ctrl.tail('soft-chime');
    const p = players[0];
    expect(p.__source).toBe('shimmer.wav');
    expect(p.volume).toBe(0.5);
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('play(legendary) behaves identically to hit(legendary)', () => {
    const { players, ctrl } = setup();
    ctrl.play('legendary');
    const p = players[0];
    expect(p.__source).toBe('legendary.wav');
    expect(p.volume).toBe(1.0);
    expect(p.seekTo).toHaveBeenCalledWith(0);
    expect(p.play).toHaveBeenCalledTimes(1);
  });

  it('bed loops and fades in over fadeMs', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.35, fadeMs: 200 });
    const p = players[0];
    expect(p.loop).toBe(true);
    expect(p.play).toHaveBeenCalled();
    expect(p.volume).toBe(0);
    vi.advanceTimersByTime(200);
    expect(p.volume).toBeCloseTo(0.35);
  });

  it('switching beds fades the old out and the new in', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.35, fadeMs: 200 });
    vi.advanceTimersByTime(200);
    const oldP = players[0];
    ctrl.bed('choir-swell', { gain: 0.4 });
    vi.advanceTimersByTime(200);
    const newP = players[1];
    expect(oldP.volume).toBe(0);
    expect(oldP.pause).toHaveBeenCalledTimes(1);
    expect(newP.__source).toBe('legendary.wav');
    expect(newP.volume).toBeCloseTo(0.4);
    expect(newP.loop).toBe(true);
  });

  it('duck ramps the active bed without pausing it', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('air', { gain: 0.4, fadeMs: 0 });
    const p = players[0];
    expect(p.volume).toBe(0.4);
    ctrl.duck(0.15, 120);
    vi.advanceTimersByTime(120);
    expect(p.volume).toBeCloseTo(0.15);
    expect(p.pause).not.toHaveBeenCalled();
    ctrl.duck(0, 100);
    vi.advanceTimersByTime(100);
    expect(p.volume).toBe(0);
    expect(p.pause).not.toHaveBeenCalled();
  });

  it('bed(null) fades and pauses the active bed', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.5, fadeMs: 0 });
    const p = players[0];
    expect(p.volume).toBe(0.5);
    ctrl.bed(null);
    vi.advanceTimersByTime(BED_FADE_MS);
    expect(p.volume).toBe(0);
    expect(p.pause).toHaveBeenCalledTimes(1);
  });

  it('stopAll cancels ramps and stops every player', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.5, fadeMs: 200 });
    ctrl.hit('rip');
    vi.advanceTimersByTime(100);
    ctrl.stopAll();
    const bedP = players.find((p) => p.__source === 'shimmer.wav');
    expect(bedP).toBeDefined();
    const volAtStop = bedP!.volume;
    vi.advanceTimersByTime(500);
    expect(bedP!.volume).toBe(volAtStop);
    for (const p of players) {
      expect(p.pause).toHaveBeenCalled();
      expect(p.seekTo).toHaveBeenCalledWith(0);
    }
  });

  it('never throws on native failure and no-ops without audio or sources', () => {
    vi.useFakeTimers();
    const throwing = {
      createAudioPlayer: vi.fn((source: unknown) => ({
        play: vi.fn(() => { throw new Error('boom'); }),
        pause: vi.fn(), seekTo: vi.fn(), remove: vi.fn(),
        volume: 1, loop: false, playing: false, __source: source,
      })),
      setAudioModeAsync: vi.fn(async () => { throw new Error('nope'); }),
    } as unknown as ExpoAudioLike;
    const ctrl = createCeremonyAudioController({ audio: throwing, sources: SOURCES });
    expect(ctrl.prewarm()).toBeUndefined();
    expect(ctrl.hit('rip')).toBeUndefined();
    expect(ctrl.bed('air')).toBeUndefined();

    const nullCtrl = createCeremonyAudioController({ audio: null, sources: SOURCES });
    expect(nullCtrl.prewarm()).toBeUndefined();
    expect(nullCtrl.hit('rip')).toBeUndefined();
    expect(nullCtrl.bed('air')).toBeUndefined();
    expect(nullCtrl.play('whoosh')).toBeUndefined();

    const empty = makeFakeAudio();
    const emptyCtrl = createCeremonyAudioController({ audio: empty.audio, sources: {} });
    emptyCtrl.prewarm();
    emptyCtrl.hit('rip');
    expect(empty.players).toHaveLength(0);
  });

  it('a missing sample creates no player and does not throw', () => {
    const partial: Partial<Record<string, unknown>> = { ...SOURCES };
    delete partial.legendary;
    const { players, ctrl } = setup(partial);
    expect(() => ctrl.hit('stinger')).not.toThrow(); // stinger → legendary (missing)
    expect(players).toHaveLength(0);
  });

  it('exposes module singletons and a hook surface', async () => {
    expect(getCeremonyAudio()).toBe(getCeremonyAudio());
    expect(typeof ceremonyAudioAvailable).toBe('boolean');
    const sink: Array<ReturnType<typeof useCeremonyAudio>> = [];
    function Probe() {
      sink.push(useCeremonyAudio());
      return null;
    }
    await act(async () => {
      renderer.create(React.createElement(Probe));
    });
    const api = sink[0];
    for (const m of ['play', 'hit', 'bed', 'duck', 'tail', 'stopAll', 'prewarm'] as const) {
      expect(typeof api[m]).toBe('function');
    }
    expect(typeof api.available).toBe('boolean');
  });
});

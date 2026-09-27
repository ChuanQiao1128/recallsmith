import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CEREMONY_GAIN,
  HIT_POOL_SIZE,
  PLAYER_UPDATE_INTERVAL_MS,
  SFX_FILES,
  ceremonyAudioAvailable,
  createCeremonyAudioController,
  getCeremonyAudio,
  stingerForRarity,
  useCeremonyAudio,
  type CeremonySfxName,
  type ExpoAudioLike,
} from '../../src/components/ceremonyAudio';
import {
  clearActiveCeremonyPerf,
  startCeremonyPerf,
} from '../../src/features/gacha/draw/ceremonyPerf';

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
      // A fake player "plays" until paused so pool rotation can be observed.
      p.play.mockImplementation(() => { p.playing = true; });
      p.pause.mockImplementation(() => { p.playing = false; });
      players.push(p);
      return p;
    }),
    setAudioModeAsync: vi.fn(async () => {}),
  } as unknown as ExpoAudioLike;
  return { audio, players };
}

const SOURCES: Record<string, unknown> = {
  charge: 'charge.wav', tear: 'tear.wav', burst: 'burst.wav', flyout: 'flyout.wav', flip: 'flip.wav',
  'stinger-com': 'stinger-com.wav', 'stinger-rar': 'stinger-rar.wav', 'stinger-leg': 'stinger-leg.wav',
};
/** HIT_POOL_SIZE players per one-shot file (there is no looping bed any more). */
const EXPECTED_PLAYERS = SFX_FILES.length * HIT_POOL_SIZE;

function setup(sources: Partial<Record<string, unknown>> = SOURCES, extra: { onHitLatency?: (n: CeremonySfxName, ms: number) => void; now?: () => number } = {}) {
  const { audio, players } = makeFakeAudio();
  const ctrl = createCeremonyAudioController({ audio, sources, ...extra });
  return { audio, players, ctrl };
}

afterEach(() => {
  vi.useRealTimers();
  clearActiveCeremonyPerf();
});

describe('ceremonyAudio', () => {
  it('SFX_FILES lists the eight v2 files and every hit plays its own file', () => {
    expect(SFX_FILES).toEqual([
      'charge', 'tear', 'burst', 'flyout', 'flip', 'stinger-com', 'stinger-rar', 'stinger-leg',
    ]);
    const { players, ctrl } = setup();
    ctrl.warmUp();
    // Each hit plays a player created from its OWN file (1:1, no aliases).
    for (const file of SFX_FILES) {
      const before = players.filter((p) => p.__source === `${file}.wav` && p.play.mock.calls.length > 0).length;
      ctrl.hit(file);
      const after = players.filter((p) => p.__source === `${file}.wav` && p.play.mock.calls.length > 0).length;
      expect(after).toBe(before + 1);
    }
  });

  it('stingerForRarity maps COM, RAR and LEG to their own stinger', () => {
    expect(stingerForRarity('COM')).toBe('stinger-com');
    expect(stingerForRarity('RAR')).toBe('stinger-rar');
    expect(stingerForRarity('LEG')).toBe('stinger-leg');
  });

  it('CEREMONY_GAIN holds the fixed v2 gain table', () => {
    expect(CEREMONY_GAIN.hit).toEqual({
      charge: 0.9, tear: 0.9, burst: 0.7, flyout: 0.8, flip: 0.9,
      'stinger-com': 0.8, 'stinger-rar': 0.9, 'stinger-leg': 1.0,
    });
    // The stingers escalate and the burst sits just under the LEG stinger.
    expect(CEREMONY_GAIN.hit['stinger-com']).toBeLessThan(CEREMONY_GAIN.hit['stinger-rar']);
    expect(CEREMONY_GAIN.hit['stinger-rar']).toBeLessThan(CEREMONY_GAIN.hit['stinger-leg']);
    expect(CEREMONY_GAIN.hit.burst).toBeLessThan(CEREMONY_GAIN.hit['stinger-leg']);
  });

  it('warmUp creates HIT_POOL_SIZE players per file once, sets the audio mode once and is idempotent', () => {
    const { audio, players, ctrl } = setup();
    expect(ctrl.isWarm()).toBe(false);
    ctrl.warmUp();
    expect(ctrl.isWarm()).toBe(true);
    expect(players).toHaveLength(EXPECTED_PLAYERS);
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: false, interruptionMode: 'mixWithOthers',
    });
    const calls = (audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls;
    const count = (f: string) => calls.filter((c) => c[0] === f).length;
    for (const file of SFX_FILES) expect(count(`${file}.wav`)).toBe(HIT_POOL_SIZE);
    // Status events stay off the JS thread: every player is created with the long interval.
    for (const c of calls) expect(c[1]).toEqual({ updateInterval: PLAYER_UPDATE_INTERVAL_MS });
    // Nothing has started playing yet.
    for (const p of players) expect(p.play).not.toHaveBeenCalled();
    ctrl.warmUp();
    ctrl.prewarm();
    expect(players).toHaveLength(EXPECTED_PLAYERS);
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
  });

  it('after warmUp a whole ceremony never calls createAudioPlayer again', () => {
    vi.useFakeTimers();
    const { audio, players, ctrl } = setup();
    ctrl.warmUp();
    const created = (audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls.length;
    ctrl.hit('charge');
    ctrl.hit('tear');
    ctrl.hit('flyout');
    ctrl.hit('burst');
    ctrl.hit('stinger-leg');
    for (let i = 0; i < 10; i += 1) {
      ctrl.hit('flip');
      ctrl.hit('stinger-com');
    }
    vi.advanceTimersByTime(1000);
    ctrl.stopAll();
    expect((audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(created);
    expect(players).toHaveLength(EXPECTED_PLAYERS);
  });

  it('lazy creation still works as the fallback when warmUp never ran', () => {
    const { players, ctrl } = setup();
    ctrl.hit('tear');
    expect(players).toHaveLength(HIT_POOL_SIZE);
    for (const p of players) expect(p.__source).toBe('tear.wav');
    expect(players[0].play).toHaveBeenCalledTimes(1);
    expect(players[1].play).not.toHaveBeenCalled();
  });

  it('hit sets the per-name gain, seeks and plays; a retrigger takes the other pool player', () => {
    const { players, ctrl } = setup();
    ctrl.warmUp();
    const tears = players.filter((p) => p.__source === 'tear.wav');
    expect(tears).toHaveLength(2);
    ctrl.hit('tear');
    expect(tears[0].volume).toBe(CEREMONY_GAIN.hit.tear);
    expect(tears[0].seekTo).toHaveBeenCalledWith(0);
    expect(tears[0].play).toHaveBeenCalledTimes(1);
    // tears[0] is still sounding → the retrigger must not seek it; it uses tears[1].
    ctrl.hit('tear', { gain: 0.3 });
    expect(tears[0].seekTo).toHaveBeenCalledTimes(1);
    expect(tears[0].play).toHaveBeenCalledTimes(1);
    expect(tears[1].volume).toBe(0.3);
    expect(tears[1].play).toHaveBeenCalledTimes(1);
    // Both busy → round-robin continues on the oldest.
    ctrl.hit('tear');
    expect(tears[0].play).toHaveBeenCalledTimes(2);
  });

  it('pool rotation prefers an idle player over the next slot', () => {
    const { players, ctrl } = setup();
    ctrl.warmUp();
    const flips = players.filter((p) => p.__source === 'flip.wav');
    ctrl.hit('flip'); // flips[0]
    flips[0].playing = false; // finished quickly
    ctrl.hit('flip'); // next slot would be flips[1], both idle → flips[1]
    expect(flips[1].play).toHaveBeenCalledTimes(1);
    flips[1].playing = true;
    flips[0].playing = false;
    ctrl.hit('flip'); // next slot flips[0] (idle) → flips[0]
    expect(flips[0].play).toHaveBeenCalledTimes(2);
    ctrl.hit('flip'); // next slot flips[1] busy, flips[0] busy → flips[1] by rotation
    expect(flips[1].play).toHaveBeenCalledTimes(2);
  });

  it('records every hit latency through the injected sink and into the active perf session', () => {
    const sink = vi.fn();
    let t = 1000;
    const now = () => t;
    const { players, ctrl } = setup(SOURCES, { onHitLatency: sink, now });
    ctrl.warmUp();
    const charge = players.find((p) => p.__source === 'charge.wav')!;
    charge.play.mockImplementation(() => { t += 7; charge.playing = true; });
    ctrl.hit('charge');
    expect(sink).toHaveBeenCalledWith('charge', 7);
    ctrl.hit('flip');
    expect(sink).toHaveBeenLastCalledWith('flip', 0);
    // No sink injected → the module-level perf session gets it.
    const session = startCeremonyPerf(
      { renderer: 'fallback', reduceMotion: false, cardCount: 1, peakRarity: 'COM', isMulti: false, tapFlow: true },
      { raf: null, persist: async () => {} },
    );
    const plain = setup();
    plain.ctrl.warmUp();
    plain.ctrl.hit('tear');
    plain.ctrl.hit('burst');
    const report = session.stop();
    expect(report.audio.map((a) => a.name)).toEqual(['tear', 'burst']);
    for (const a of report.audio) expect(a.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('a hit never throws and records nothing when the pool is missing', () => {
    const sink = vi.fn();
    const partial: Partial<Record<string, unknown>> = { ...SOURCES };
    delete partial['stinger-leg'];
    const { players, ctrl } = setup(partial, { onHitLatency: sink });
    expect(() => ctrl.hit('stinger-leg')).not.toThrow(); // missing source
    expect(players).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
  });

  it('stopAll stops every player and re-seeks it to the start', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.warmUp();
    ctrl.hit('tear');
    ctrl.hit('stinger-leg');
    ctrl.stopAll();
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
    expect(ctrl.warmUp()).toBeUndefined();
    expect(ctrl.hit('tear')).toBeUndefined();

    const nullCtrl = createCeremonyAudioController({ audio: null, sources: SOURCES });
    expect(nullCtrl.warmUp()).toBeUndefined();
    expect(nullCtrl.isWarm()).toBe(false);
    expect(nullCtrl.hit('tear')).toBeUndefined();

    const empty = makeFakeAudio();
    const emptyCtrl = createCeremonyAudioController({ audio: empty.audio, sources: {} });
    emptyCtrl.warmUp();
    emptyCtrl.hit('tear');
    expect(empty.players).toHaveLength(0);

    const creatorThrows = {
      createAudioPlayer: vi.fn(() => { throw new Error('no player'); }),
      setAudioModeAsync: vi.fn(async () => {}),
    } as unknown as ExpoAudioLike;
    const brokenCtrl = createCeremonyAudioController({ audio: creatorThrows, sources: SOURCES });
    expect(() => brokenCtrl.warmUp()).not.toThrow();
    expect(brokenCtrl.isWarm()).toBe(false);
    expect(() => brokenCtrl.hit('tear')).not.toThrow();
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
    for (const m of ['hit', 'stopAll', 'prewarm', 'warmUp', 'isWarm'] as const) {
      expect(typeof api[m]).toBe('function');
    }
    expect(typeof api.available).toBe('boolean');
  });
});

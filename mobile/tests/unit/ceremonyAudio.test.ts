import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BED_FADE_MS,
  CEREMONY_GAIN,
  HIT_POOL_SIZE,
  PLAYER_UPDATE_INTERVAL_MS,
  SFX_ALIASES,
  SFX_FILES,
  SFX_LOOP_FILES,
  ceremonyAudioAvailable,
  createCeremonyAudioController,
  getCeremonyAudio,
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

const SOURCES = {
  ambience: 'ambience.wav', whoosh: 'whoosh.wav', rip: 'rip.wav', 'card-drop': 'card-drop.wav',
  'card-flip': 'card-flip.wav', shimmer: 'shimmer.wav', legendary: 'legendary.wav',
};
const ONE_SHOT_FILES = SFX_FILES.filter((f) => !SFX_LOOP_FILES.has(f));
/** 1 looping bed player + HIT_POOL_SIZE per one-shot file. */
const EXPECTED_PLAYERS = 1 + ONE_SHOT_FILES.length * HIT_POOL_SIZE;

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
  it('SFX_ALIASES maps 17 names onto the seven committed files; every bed name is the loop', () => {
    const keys = Object.keys(SFX_ALIASES);
    expect(keys).toHaveLength(17);
    expect(SFX_FILES).toEqual(['ambience', 'whoosh', 'rip', 'card-drop', 'card-flip', 'shimmer', 'legendary']);
    for (const v of Object.values(SFX_ALIASES)) expect(SFX_FILES).toContain(v);
    for (const f of ONE_SHOT_FILES) expect(SFX_ALIASES[f as keyof typeof SFX_ALIASES]).toBe(f);
    for (const bed of ['crinkle', 'air', 'shimmer-pad', 'choir-swell'] as const) expect(SFX_ALIASES[bed]).toBe('ambience');
    // No hit or tail name may ever resolve to the loop file.
    for (const name of keys) {
      if (name in CEREMONY_GAIN.hit || name in CEREMONY_GAIN.tail) {
        expect(SFX_LOOP_FILES.has(SFX_ALIASES[name as keyof typeof SFX_ALIASES])).toBe(false);
      }
    }
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

  it('warmUp creates every player once (bed + pools), sets the audio mode once and is idempotent', () => {
    const { audio, players, ctrl } = setup();
    expect(ctrl.isWarm()).toBe(false);
    ctrl.warmUp();
    expect(ctrl.isWarm()).toBe(true);
    expect(players).toHaveLength(EXPECTED_PLAYERS);
    expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(audio.setAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true, interruptionMode: 'mixWithOthers',
    });
    const calls = (audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls;
    const count = (f: string) => calls.filter((c) => c[0] === f).length;
    expect(count('ambience.wav')).toBe(1);
    for (const f of ONE_SHOT_FILES) expect(count(`${f}.wav`)).toBe(HIT_POOL_SIZE);
    // Status events stay off the JS thread: every player is created with the long interval.
    for (const c of calls) expect(c[1]).toEqual({ updateInterval: PLAYER_UPDATE_INTERVAL_MS });
    // The bed player is prepared as a loop and nothing has started playing.
    const bed = players.find((p) => p.__source === 'ambience.wav')!;
    expect(bed.loop).toBe(true);
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
    ctrl.bed('crinkle');
    ctrl.hit('whoosh');
    ctrl.bed('air');
    ctrl.bed('shimmer-pad', { gain: 0.35 });
    ctrl.duck(CEREMONY_GAIN.duck, 80);
    ctrl.hit('rip');
    ctrl.hit('stack-thud');
    ctrl.hit('seam-burst');
    ctrl.hit('stinger');
    ctrl.hit('chime');
    ctrl.tail('sparkle-tail');
    ctrl.bed('choir-swell', { gain: CEREMONY_GAIN.bedTable });
    for (let i = 0; i < 10; i += 1) {
      ctrl.hit('card-flip');
      ctrl.hit('legendary');
    }
    ctrl.play('soft-chime');
    ctrl.play('air');
    vi.advanceTimersByTime(1000);
    ctrl.stopAll();
    expect((audio.createAudioPlayer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(created);
    expect(players).toHaveLength(EXPECTED_PLAYERS);
  });

  it('lazy creation still works as the fallback when warmUp never ran', () => {
    const { players, ctrl } = setup();
    ctrl.hit('rip');
    expect(players).toHaveLength(HIT_POOL_SIZE);
    for (const p of players) expect(p.__source).toBe('rip.wav');
    expect(players[0].play).toHaveBeenCalledTimes(1);
    expect(players[1].play).not.toHaveBeenCalled();
    ctrl.bed('air');
    expect(players).toHaveLength(HIT_POOL_SIZE + 1);
    expect(players[2].__source).toBe('ambience.wav');
  });

  it('hit sets the per-name gain, seeks and plays; a retrigger takes the other pool player', () => {
    const { players, ctrl } = setup();
    ctrl.warmUp();
    const rips = players.filter((p) => p.__source === 'rip.wav');
    expect(rips).toHaveLength(2);
    ctrl.hit('rip');
    expect(rips[0].volume).toBe(0.8);
    expect(rips[0].seekTo).toHaveBeenCalledWith(0);
    expect(rips[0].play).toHaveBeenCalledTimes(1);
    // rips[0] is still sounding → the retrigger must not seek it; it uses rips[1].
    ctrl.hit('rip', { gain: 0.3 });
    expect(rips[0].seekTo).toHaveBeenCalledTimes(1);
    expect(rips[0].play).toHaveBeenCalledTimes(1);
    expect(rips[1].volume).toBe(0.3);
    expect(rips[1].play).toHaveBeenCalledTimes(1);
    // Both busy → round-robin continues on the oldest.
    ctrl.hit('rip');
    expect(rips[0].play).toHaveBeenCalledTimes(2);
    // 'seam-burst' shares the rip pool.
    rips[0].playing = false;
    rips[1].playing = false;
    ctrl.hit('seam-burst');
    expect(rips[1].play).toHaveBeenCalledTimes(2);
    expect(rips[1].volume).toBe(0.7);
  });

  it('pool rotation prefers an idle player over the next slot', () => {
    const { players, ctrl } = setup();
    ctrl.warmUp();
    const flips = players.filter((p) => p.__source === 'card-flip.wav');
    ctrl.hit('card-flip'); // flips[0]
    flips[0].playing = false; // finished quickly
    ctrl.hit('card-flip'); // next slot would be flips[1], both idle → flips[1]
    expect(flips[1].play).toHaveBeenCalledTimes(1);
    flips[1].playing = true;
    flips[0].playing = false;
    ctrl.hit('card-flip'); // next slot flips[0] (idle) → flips[0]
    expect(flips[0].play).toHaveBeenCalledTimes(2);
    ctrl.hit('card-flip'); // next slot flips[1] busy, flips[0] busy (play sets playing) → flips[1] by rotation
    expect(flips[1].play).toHaveBeenCalledTimes(2);
  });

  it('records every hit latency through the injected sink and into the active perf session', () => {
    const sink = vi.fn();
    let t = 1000;
    const now = () => t;
    const { players, ctrl } = setup(SOURCES, { onHitLatency: sink, now });
    ctrl.warmUp();
    const whoosh = players.find((p) => p.__source === 'whoosh.wav')!;
    whoosh.play.mockImplementation(() => { t += 7; whoosh.playing = true; });
    ctrl.hit('whoosh');
    expect(sink).toHaveBeenCalledWith('whoosh', 7);
    ctrl.tail('sparkle-tail');
    expect(sink).toHaveBeenLastCalledWith('sparkle-tail', 0);
    // No sink injected → the module-level perf session gets it.
    const session = startCeremonyPerf(
      { renderer: 'fallback', reduceMotion: false, cardCount: 1, peakRarity: 'COM', isMulti: false, tapFlow: true },
      { raf: null, persist: async () => {} },
    );
    const plain = setup();
    plain.ctrl.warmUp();
    plain.ctrl.hit('rip');
    plain.ctrl.hit('chime');
    const report = session.stop();
    expect(report.audio.map((a) => a.name)).toEqual(['rip', 'chime']);
    for (const a of report.audio) expect(a.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('a hit never throws and records nothing when the pool is missing', () => {
    const sink = vi.fn();
    const partial: Partial<Record<string, unknown>> = { ...SOURCES };
    delete partial.legendary;
    const { players, ctrl } = setup(partial, { onHitLatency: sink });
    expect(() => ctrl.hit('stinger')).not.toThrow(); // stinger → legendary (missing)
    expect(players).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
  });

  it('play(legendary) behaves identically to hit(legendary); play(bed) starts the bed', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.play('legendary');
    const p = players[0];
    expect(p.__source).toBe('legendary.wav');
    expect(p.volume).toBe(1.0);
    expect(p.seekTo).toHaveBeenCalledWith(0);
    expect(p.play).toHaveBeenCalledTimes(1);
    ctrl.play('air');
    const bed = players.find((x) => x.__source === 'ambience.wav')!;
    expect(bed.loop).toBe(true);
    expect(bed.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BED_FADE_MS);
    expect(bed.volume).toBeCloseTo(CEREMONY_GAIN.bed.COM);
  });

  it('bed loops the ambience file and fades in over fadeMs from silence', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.35, fadeMs: 200 });
    const p = players[0];
    expect(p.__source).toBe('ambience.wav');
    expect(p.loop).toBe(true);
    expect(p.seekTo).toHaveBeenCalledWith(0);
    expect(p.play).toHaveBeenCalledTimes(1);
    expect(p.volume).toBe(0);
    vi.advanceTimersByTime(200);
    expect(p.volume).toBeCloseTo(0.35);
  });

  it('switching bed names keeps the one loop running and only ramps its level (no restart, no seek)', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.warmUp();
    const bed = players.find((p) => p.__source === 'ambience.wav')!;
    ctrl.bed('crinkle', { gain: 0.3, fadeMs: 200 });
    vi.advanceTimersByTime(200);
    expect(bed.play).toHaveBeenCalledTimes(1);
    ctrl.bed('air', { gain: 0.3 });
    ctrl.bed('shimmer-pad', { gain: 0.35 });
    vi.advanceTimersByTime(200);
    expect(bed.play).toHaveBeenCalledTimes(1);
    expect(bed.seekTo).toHaveBeenCalledTimes(1);
    expect(bed.pause).not.toHaveBeenCalled();
    expect(bed.volume).toBeCloseTo(0.35);
    ctrl.bed('choir-swell', { gain: 0.25 });
    vi.advanceTimersByTime(200);
    expect(bed.play).toHaveBeenCalledTimes(1);
    expect(bed.volume).toBeCloseTo(0.25);
    expect(players).toHaveLength(EXPECTED_PLAYERS);
  });

  it('a bed restarted mid fade-out cancels the pause and ramps back up without a seek', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('crinkle', { gain: 0.3, fadeMs: 0 });
    const bed = players[0];
    ctrl.bed(null); // swipe released short of the trigger: fade out over BED_FADE_MS
    vi.advanceTimersByTime(BED_FADE_MS / 2);
    expect(bed.pause).not.toHaveBeenCalled();
    ctrl.bed('crinkle', { gain: 0.3 }); // re-swipe
    vi.advanceTimersByTime(BED_FADE_MS * 2);
    expect(bed.pause).not.toHaveBeenCalled();
    expect(bed.play).toHaveBeenCalledTimes(1);
    expect(bed.seekTo).toHaveBeenCalledTimes(1);
    expect(bed.volume).toBeCloseTo(0.3);
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

  it('bed(null) fades and pauses the active bed; the next bed() then starts it from the top', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.bed('shimmer-pad', { gain: 0.5, fadeMs: 0 });
    const p = players[0];
    expect(p.volume).toBe(0.5);
    ctrl.bed(null);
    vi.advanceTimersByTime(BED_FADE_MS);
    expect(p.volume).toBe(0);
    expect(p.pause).toHaveBeenCalledTimes(1);
    ctrl.bed('air', { gain: 0.3, fadeMs: 0 });
    expect(p.seekTo).toHaveBeenCalledTimes(2);
    expect(p.play).toHaveBeenCalledTimes(2);
    expect(p.volume).toBe(0.3);
  });

  it('stopAll cancels ramps and stops every player', () => {
    vi.useFakeTimers();
    const { players, ctrl } = setup();
    ctrl.warmUp();
    ctrl.bed('shimmer-pad', { gain: 0.5, fadeMs: 200 });
    ctrl.hit('rip');
    vi.advanceTimersByTime(100);
    ctrl.stopAll();
    const bedP = players.find((p) => p.__source === 'ambience.wav');
    expect(bedP).toBeDefined();
    const volAtStop = bedP!.volume;
    vi.advanceTimersByTime(500);
    expect(bedP!.volume).toBe(volAtStop);
    for (const p of players) {
      expect(p.pause).toHaveBeenCalled();
      expect(p.seekTo).toHaveBeenCalledWith(0);
    }
    // After stopAll the bed is cold again: the next bed() restarts it.
    ctrl.bed('air', { gain: 0.3, fadeMs: 0 });
    expect(bedP!.play).toHaveBeenCalledTimes(2);
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
    expect(ctrl.hit('rip')).toBeUndefined();
    expect(ctrl.bed('air')).toBeUndefined();

    const nullCtrl = createCeremonyAudioController({ audio: null, sources: SOURCES });
    expect(nullCtrl.warmUp()).toBeUndefined();
    expect(nullCtrl.isWarm()).toBe(false);
    expect(nullCtrl.hit('rip')).toBeUndefined();
    expect(nullCtrl.bed('air')).toBeUndefined();
    expect(nullCtrl.play('whoosh')).toBeUndefined();

    const empty = makeFakeAudio();
    const emptyCtrl = createCeremonyAudioController({ audio: empty.audio, sources: {} });
    emptyCtrl.warmUp();
    emptyCtrl.hit('rip');
    expect(empty.players).toHaveLength(0);

    const creatorThrows = {
      createAudioPlayer: vi.fn(() => { throw new Error('no player'); }),
      setAudioModeAsync: vi.fn(async () => {}),
    } as unknown as ExpoAudioLike;
    const brokenCtrl = createCeremonyAudioController({ audio: creatorThrows, sources: SOURCES });
    expect(() => brokenCtrl.warmUp()).not.toThrow();
    expect(brokenCtrl.isWarm()).toBe(false);
    expect(() => brokenCtrl.hit('rip')).not.toThrow();
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
    for (const m of ['play', 'hit', 'bed', 'duck', 'tail', 'stopAll', 'prewarm', 'warmUp', 'isWarm'] as const) {
      expect(typeof api[m]).toBe('function');
    }
    expect(typeof api.available).toBe('boolean');
  });
});

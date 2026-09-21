// reanimatedGuard — the single discriminant `motionAvailable` and the one
// deterministic no-op surface every Wave B module reads animation from.
//
// This file exists to design out the crash in the old holographic renderer, where a
// renderer destructured a Skia clock hook and a derived-value hook straight off the
// Skia module — the derived-value hook is not a Skia export and the clock hook goes
// through Skia's Reanimated proxy, so the table crashed at mount on any RAR/LEG card.
// The rule is: no consumer may read the Skia clock hook or a derived-value hook from
// `SkiaModule`; those come from the `Reanimated` object below. `SkiaModule` is only for
// Skia's own drawing primitives. Everything animation-shaped lives here, with a
// hand-written fallback so the ceremony renders identically when the native modules
// are absent (tests, unprebuilt clients, or the remote kill switch).

import React, { useRef } from 'react';
import { View } from 'react-native';

/** `{ value: T }` — the only shape any Wave B module may assume for a shared value. */
export type SharedValue<T> = { value: T };

type Loaded = { reanimated: any; worklets: any; skia: any; gestureHandler: any };

// Four literal loaders, one try block each: Metro only tolerates a missing package
// when the literal string sits directly inside a try {} (see the brief's Context), and it
// rejects a non-literal argument outright in app source — so there is no shared loader helper.
function loadReanimated(): any | null {
  try {
    return require('react-native-reanimated');
  } catch {
    return null;
  }
}
function loadWorklets(): any | null {
  try {
    return require('react-native-worklets');
  } catch {
    return null;
  }
}
function loadSkia(): any | null {
  try {
    return require('@shopify/react-native-skia');
  } catch {
    return null;
  }
}
function loadGestureHandler(): any | null {
  try {
    return require('react-native-gesture-handler');
  } catch {
    return null;
  }
}

/**
 * Test override. tests/setup/ceremony.ts sets it to false before any import so vitest
 * never lets a guarded loader decide (vi.mock does not intercept CJS requires — verified on
 * this tree). Only `false` is honoured: the flag can deny motion, it can never fake a native
 * module. Anything other than `false` (undefined, true) → the guarded loaders decide.
 */
const override = (globalThis as { __CEREMONY_MOTION_AVAILABLE__?: unknown }).__CEREMONY_MOTION_AVAILABLE__;
const loaded: Loaded | null =
  override === false
    ? null
    : {
        reanimated: loadReanimated(),
        worklets: loadWorklets(),
        skia: loadSkia(),
        gestureHandler: loadGestureHandler(),
      };

export const motionAvailable: boolean = !!(loaded?.reanimated && loaded?.worklets && loaded?.skia);
export const skiaAvailable: boolean = !!loaded?.skia;
export const SkiaModule: any | null = loaded?.skia ?? null;

// ── Fallback animation primitives (pure JS; used whenever motionAvailable is false) ──

function fallbackInterpolate(v: number, input: number[], output: number[]): number {
  if (input.length < 2) return output[0];
  const seg = (lo: number, hi: number): number => {
    const x0 = input[lo];
    const x1 = input[hi];
    const y0 = output[lo];
    const y1 = output[hi];
    if (x1 === x0) return y0;
    return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  };
  if (v <= input[0]) return seg(0, 1);
  for (let i = 1; i < input.length; i += 1) {
    if (v <= input[i]) return seg(i - 1, i);
  }
  const n = input.length;
  return seg(n - 2, n - 1);
}

function parseColor(color: string): [number, number, number, number] | null {
  if (typeof color !== 'string') return null;
  const s = color.trim();
  let m = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (m) {
    const h = m[1];
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
      1,
    ];
  }
  m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m) {
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  m = /^#([0-9a-fA-F]{8})$/.exec(s);
  if (m) {
    const h = m[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      parseInt(h.slice(6, 8), 16) / 255,
    ];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(',').map((p) => Number(p.trim()));
    if (parts.length < 3) return null;
    const r = parts[0];
    const g = parts[1];
    const b = parts[2];
    const a = parts.length >= 4 ? parts[3] : 1;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return [r, g, b, a];
  }
  return null;
}

function fallbackInterpolateColor(v: number, input: number[], output: string[]): string {
  if (input.length < 2) return output[0];
  if (v <= input[0]) return output[0];
  if (v >= input[input.length - 1]) return output[output.length - 1];
  let i = 1;
  while (i < input.length && v > input[i]) i += 1;
  const x0 = input[i - 1];
  const x1 = input[i];
  const t = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
  const c0 = parseColor(output[i - 1]);
  const c1 = parseColor(output[i]);
  if (!c0 || !c1) return t < 0.5 ? output[i - 1] : output[i];
  const mix = (a: number, b: number): number => a + (b - a) * t;
  const r = Math.round(mix(c0[0], c1[0]));
  const g = Math.round(mix(c0[1], c1[1]));
  const b = Math.round(mix(c0[2], c1[2]));
  const a = Math.round(mix(c0[3], c1[3]) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

const identityCurve = (t: number): number => t;
const fallbackEasing = {
  bezier: (_a: number, _b: number, _c: number, _d: number) => identityCurve,
  linear: identityCurve,
  cubic: identityCurve,
  quad: identityCurve,
  out: (e: (t: number) => number) => e,
  in: (e: (t: number) => number) => e,
};

/** Reanimated's per-frame UI-thread callback handle (`useFrameCallback`). */
export type FrameCallbackHandle = { setActive: (active: boolean) => void; isActive: boolean; callbackId: number };
export type FrameInfo = { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number };

type ReanimatedSurface = {
  useSharedValue: <T>(init: T) => SharedValue<T>;
  useDerivedValue: <T>(fn: () => T) => SharedValue<T>;
  useAnimatedStyle: (fn: () => any) => any;
  useAnimatedReaction: (...args: any[]) => any;
  /** UI-thread frame callback; the fallback never calls `fn` and returns an inert handle. */
  useFrameCallback: (fn: (info: FrameInfo) => void, autostart?: boolean) => FrameCallbackHandle;
  withTiming: (to: any, cfg?: any, cb?: (finished?: boolean) => void) => any;
  withSpring: (to: any, cfg?: any, cb?: (finished?: boolean) => void) => any;
  withDelay: (ms: number, anim: any) => any;
  withSequence: (...anims: any[]) => any;
  withRepeat: (anim: any, ...rest: any[]) => any;
  cancelAnimation: (value?: any) => void;
  runOnJS: <F>(fn: F) => F;
  interpolate: (v: number, input: number[], output: number[]) => number;
  interpolateColor: (v: number, input: number[], output: string[]) => string;
  Easing: any;
  View: any;
  createAnimatedComponent: (c: any) => any;
};

const INERT_FRAME_HANDLE: FrameCallbackHandle = Object.freeze({ setActive: () => undefined, isActive: false, callbackId: -1 });
function inertFrameCallback(): FrameCallbackHandle {
  return INERT_FRAME_HANDLE;
}

function realReanimated(RA: any): ReanimatedSurface {
  return {
    useSharedValue: RA.useSharedValue,
    useDerivedValue: RA.useDerivedValue,
    useAnimatedStyle: RA.useAnimatedStyle,
    useAnimatedReaction: RA.useAnimatedReaction,
    useFrameCallback: typeof RA.useFrameCallback === 'function' ? RA.useFrameCallback : inertFrameCallback,
    withTiming: RA.withTiming,
    withSpring: RA.withSpring,
    withDelay: RA.withDelay,
    withSequence: RA.withSequence,
    withRepeat: RA.withRepeat,
    cancelAnimation: RA.cancelAnimation,
    runOnJS: RA.runOnJS,
    interpolate: RA.interpolate,
    interpolateColor: RA.interpolateColor,
    Easing: RA.Easing,
    View: RA.default.View,
    createAnimatedComponent: RA.default.createAnimatedComponent,
  };
}

function fallbackReanimated(): ReanimatedSurface {
  return {
    useSharedValue<T>(init: T): SharedValue<T> {
      return useRef<SharedValue<T>>({ value: init }).current;
    },
    useDerivedValue<T>(fn: () => T): SharedValue<T> {
      return { value: fn() };
    },
    useAnimatedStyle: (fn: () => any) => fn(),
    useAnimatedReaction: () => undefined,
    useFrameCallback: inertFrameCallback,
    withTiming: (to: any, _cfg?: any, cb?: (finished?: boolean) => void) => {
      cb?.(true);
      return to;
    },
    withSpring: (to: any, _cfg?: any, cb?: (finished?: boolean) => void) => {
      cb?.(true);
      return to;
    },
    withDelay: (_ms: number, anim: any) => anim,
    withSequence: (...anims: any[]) => anims[anims.length - 1] ?? 0,
    withRepeat: (anim: any) => anim,
    cancelAnimation: () => undefined,
    runOnJS: <F>(fn: F): F => fn,
    interpolate: fallbackInterpolate,
    interpolateColor: fallbackInterpolateColor,
    Easing: fallbackEasing,
    View,
    createAnimatedComponent: (c: any) => c,
  };
}

export const Reanimated: ReanimatedSurface =
  motionAvailable && loaded?.reanimated ? realReanimated(loaded.reanimated) : fallbackReanimated();

// ── Gesture surface. PanHost IS the library's GestureDetector; one alias so B06/B08 share
// a single name. When motion is off the tear Pan has nothing to drive, so PanHost is an inert
// wrapper and every gesture builder returns a chainable no-op. ──

function inertGesture(): any {
  const g: any = {};
  const methods = [
    'onBegin',
    'onStart',
    'onUpdate',
    'onChange',
    'onEnd',
    'onFinalize',
    'activeOffsetX',
    'activeOffsetY',
    'failOffsetX',
    'failOffsetY',
    'enabled',
    'minDistance',
    'maxPointers',
    'runOnJS',
    'simultaneousWithExternalGesture',
    'requireExternalGestureToFail',
    'hitSlop',
    'shouldCancelWhenOutside',
  ];
  for (const name of methods) {
    g[name] = () => g;
  }
  return g;
}

export const GestureHandler: {
  available: boolean;
  PanHost: React.ComponentType<{ gesture: unknown; children?: React.ReactNode }>;
  Gesture: { Pan(): any; Tap(): any };
} = motionAvailable && loaded?.gestureHandler
  ? { available: true, PanHost: loaded.gestureHandler.GestureDetector, Gesture: loaded.gestureHandler.Gesture }
  : {
      available: false,
      PanHost: ({ children }) => React.createElement(React.Fragment, null, children),
      Gesture: { Pan: inertGesture, Tap: inertGesture },
    };

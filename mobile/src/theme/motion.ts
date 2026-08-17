// Motion tokens — durations and easings for animations across the app.
//
// Why a token file: animation timing is brand voice. A loose 80ms
// pop versus a confident 280ms slide says different things about
// the product. Hardcoded durations like `Animated.timing(..., { duration: 320 })`
// scattered across screens make it impossible to retune the brand
// feel later, or even to keep a coherent rhythm in the first place.
//
// Use named ROLES (tap, transition, hero...) wherever possible —
// they describe *intent*, so future changes to brand timing only
// need to update one number here. Reach for raw DURATIONS only when
// you need a one-off value that doesn't fit a role.

import { Easing, type EasingFunction } from 'react-native';

/**
 * Raw duration tokens (in milliseconds). Use these as building
 * blocks — but prefer the named MotionRole tokens below for clarity
 * of intent.
 *
 * Scale loosely follows a "doubling" rhythm: each step roughly
 * twice the previous. Avoids the trap of having `220`, `240`, `260`
 * sprinkled across the codebase that all feel identical but make
 * retuning impossible.
 */
export const durations = {
  /** Instant — basically frame-perfect feedback. Use for tap-down. */
  instant: 80,
  /** Fast — quick state change, gives feel of responsiveness. */
  fast: 160,
  /** Normal — most UI transitions; default if unsure. */
  normal: 240,
  /** Slow — content shifts, reveals, "I want you to notice". */
  slow: 360,
  /** Deliberate — hero moments, panel slides, page transitions. */
  deliberate: 480,
  /** Ceremony — gacha pull / celebration animations. */
  ceremony: 1200,
  /** Linger — for ambient breathing animations and idle bobbing. */
  linger: 2400,
} as const;

export type Duration = typeof durations[keyof typeof durations];

/**
 * Easing tokens. Each curve has a personality:
 *   • exit/enter — natural deceleration in/out
 *   • inOut — smooth accelerate-decelerate, "considered"
 *   • brand — slight overshoot, gives weight to gacha reveals
 *   • emphasized — fast in, slow out, used for hero highlights
 */
export const easings: Record<string, EasingFunction> = {
  /** Default exit — content leaving the screen. */
  exit: Easing.out(Easing.ease),
  /** Default enter — content arriving on the screen. */
  enter: Easing.out(Easing.cubic),
  /** Symmetric ease — "considered" feel for transitions. */
  inOut: Easing.inOut(Easing.ease),
  /** Brand — subtle anticipation+overshoot, used for cards/packs. */
  brand: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** Emphasized — fast acceleration, gentle settle. For hero reveals. */
  emphasized: Easing.bezier(0.05, 0.7, 0.1, 1),
  /** Linear — only when timing must be perfectly even (e.g. progress arcs). */
  linear: Easing.linear,
};

/**
 * Motion ROLES — pair a duration with an easing for a named purpose.
 * Reach for these first; only use raw `durations`/`easings` when no
 * role fits.
 *
 * Pattern of use:
 *
 *   Animated.timing(opacity, {
 *     toValue: 1,
 *     ...motion.transition,
 *     useNativeDriver: true,
 *   });
 */
export const motion = {
  /** Tap feedback — pressed state changes. Frame-perfect. */
  tap: { duration: durations.instant, easing: easings.exit },
  /** Quick state changes — toggles, chip selection, switching tabs. */
  fast: { duration: durations.fast, easing: easings.exit },
  /** Default UI transition — opacity, position, color shifts. */
  transition: { duration: durations.normal, easing: easings.enter },
  /** Page or panel slides — modal opens, screen pushes. */
  pageEnter: { duration: durations.slow, easing: easings.enter },
  pageExit: { duration: durations.slow, easing: easings.exit },
  /** Hero moments — featured pack slide-in, big reveals. */
  hero: { duration: durations.deliberate, easing: easings.emphasized },
  /** Ceremony — gacha pull animation phases. */
  ceremony: { duration: durations.ceremony, easing: easings.brand },
  /** Idle ambient motion — pack bobbing, glow pulses. */
  idle: { duration: durations.linger, easing: easings.inOut },
} as const;

export type MotionRole = keyof typeof motion;

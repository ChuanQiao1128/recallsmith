// Global vitest setup for every Wave B ceremony test. It pins motionAvailable to
// false (so reanimatedGuard never lets a guarded loader decide under Node) and mocks
// every native package Wave B touches. The mocks are a safety net: a guarded require
// is invisible to vi.mock (verified on this tree), so these only catch a module that
// mistakenly *imports* a native package directly — nothing reaches a native binding
// before B15. It runs after globals.ts (which owns __DEV__); order is set in
// vitest.config.ts. It deliberately does NOT mock react-native, react, AsyncStorage,
// expo-linear-gradient or react-native-safe-area-context — the integration tests own
// those per file.

import { beforeEach, vi } from 'vitest';

(globalThis as any).__CEREMONY_MOTION_AVAILABLE__ = false;

const ceremonyMocks = vi.hoisted(() => {
  const audio: any = {
    players: [] as any[],
    setAudioModeAsync: vi.fn(async () => {}),
    createAudioPlayer: undefined,
  };
  audio.createAudioPlayer = vi.fn((source: any) => {
    const player = {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      remove: vi.fn(),
      volume: 1,
      loop: false,
      playing: false,
      __source: source,
    };
    audio.players.push(player);
    return player;
  });
  const haptics = {
    impactAsync: vi.fn(async () => {}),
    selectionAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
  };
  const sharing = {
    isAvailableAsync: vi.fn(async () => true),
    shareAsync: vi.fn(async () => {}),
  };
  const storeReview = {
    isAvailableAsync: vi.fn(async () => true),
    hasAction: vi.fn(async () => true),
    requestReview: vi.fn(async () => {}),
  };
  const viewShot = {
    captureRef: vi.fn(async () => 'file:///tmp/draw.png'),
  };
  const all = { audio, haptics, sharing, storeReview, viewShot };
  (globalThis as any).__ceremonyMocks = all;
  return all;
});

// 1. react-native-reanimated
vi.mock('react-native-reanimated', () => {
  const React = require('react');
  const identity = (t: any) => t;
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    default: {
      View: host('Animated.View'),
      Text: host('Animated.Text'),
      Image: host('Animated.Image'),
      createAnimatedComponent: (c: any) => c,
    },
    useSharedValue: (v: any) => ({ value: v }),
    useDerivedValue: (fn: any) => ({ value: fn() }),
    useAnimatedStyle: (fn: any) => fn(),
    useAnimatedReaction: () => undefined,
    withTiming: (to: any) => to,
    withSpring: (to: any) => to,
    withDelay: (_ms: any, a: any) => a,
    withRepeat: (a: any) => a,
    withSequence: (...a: any[]) => a[a.length - 1],
    cancelAnimation: () => undefined,
    runOnJS: (fn: any) => fn,
    interpolate: (_v: any, _i: any, o: any) => o[0],
    interpolateColor: (_v: any, _i: any, o: any) => o[0],
    Easing: {
      bezier: identity,
      linear: identity,
      out: identity,
      in: identity,
      cubic: identity,
      quad: identity,
      ease: identity,
      inOut: identity,
    },
    makeMutable: (v: any) => ({ value: v }),
  };
});

// 2. react-native-worklets
vi.mock('react-native-worklets', () => ({}));

// 3. @shopify/react-native-skia
vi.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement('Skia.' + name, props, children);
  const names = [
    'Canvas',
    'Group',
    'Rect',
    'RoundedRect',
    'Image',
    'Atlas',
    'Path',
    'Circle',
    'SweepGradient',
    'RadialGradient',
    'LinearGradient',
    'Shader',
    'Paint',
    'Fill',
    'Mask',
  ];
  const components: any = {};
  for (const name of names) components[name] = host(name);
  const makePath = () => {
    const p: any = {};
    p.moveTo = () => p;
    p.lineTo = () => p;
    p.close = () => p;
    return p;
  };
  return {
    ...components,
    useImage: () => null,
    useImageAsTexture: () => null,
    useRSXformBuffer: () => [],
    useRectBuffer: () => [],
    vec: (x: any, y: any) => ({ x, y }),
    rect: (x: any, y: any, width: any, height: any) => ({ x, y, width, height }),
    rrect: (r: any, rx: any, ry: any) => ({ rect: r, rx, ry }),
    Skia: {
      Path: { Make: () => makePath() },
      RuntimeEffect: { Make: () => null },
      Matrix4: () => [],
      Color: (c: any) => c,
    },
    BlendMode: { Plus: 'plus', SrcOver: 'srcOver' },
    Matrix4: () => [],
    rotateX: (a: any) => a,
    translate: (a: any) => a,
    multiply4: (a: any) => a,
    perspective: (a: any) => a,
  };
});

// 4. expo-audio
vi.mock('expo-audio', () => ({
  createAudioPlayer: ceremonyMocks.audio.createAudioPlayer,
  setAudioModeAsync: ceremonyMocks.audio.setAudioModeAsync,
  useAudioPlayer: (source: any) => ceremonyMocks.audio.createAudioPlayer(source),
}));

// 5. expo-haptics
vi.mock('expo-haptics', () => ({
  impactAsync: ceremonyMocks.haptics.impactAsync,
  selectionAsync: ceremonyMocks.haptics.selectionAsync,
  notificationAsync: ceremonyMocks.haptics.notificationAsync,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// 6. react-native-gesture-handler
vi.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const chain = () => {
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
    for (const name of methods) g[name] = () => g;
    return g;
  };
  return {
    GestureHandlerRootView: ({ children, ...props }: any) => React.createElement('View', props, children),
    GestureDetector: ({ children, ...props }: any) => React.createElement('View', props, children),
    Gesture: { Pan: () => chain(), Tap: () => chain() },
    Directions: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 },
    State: { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 },
  };
});

// 7. expo-sharing / expo-store-review / react-native-view-shot
vi.mock('expo-sharing', () => ({
  isAvailableAsync: ceremonyMocks.sharing.isAvailableAsync,
  shareAsync: ceremonyMocks.sharing.shareAsync,
}));
vi.mock('expo-store-review', () => ({
  isAvailableAsync: ceremonyMocks.storeReview.isAvailableAsync,
  hasAction: ceremonyMocks.storeReview.hasAction,
  requestReview: ceremonyMocks.storeReview.requestReview,
}));
vi.mock('react-native-view-shot', () => ({
  captureRef: ceremonyMocks.viewShot.captureRef,
}));

// 8. Reset every mock between tests.
beforeEach(() => {
  ceremonyMocks.audio.players.length = 0;
  const clearAll = (obj: any) => {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value.mockClear === 'function') value.mockClear();
    }
  };
  clearAll(ceremonyMocks.audio);
  clearAll(ceremonyMocks.haptics);
  clearAll(ceremonyMocks.sharing);
  clearAll(ceremonyMocks.storeReview);
  clearAll(ceremonyMocks.viewShot);
});

// 9. Ambient declarations for the shared handles.
declare global {
  var __ceremonyMocks: {
    audio: { players: any[]; setAudioModeAsync: (...args: any[]) => any; createAudioPlayer: (...args: any[]) => any };
    haptics: { impactAsync: (...args: any[]) => any; selectionAsync: (...args: any[]) => any; notificationAsync: (...args: any[]) => any };
    sharing: { isAvailableAsync: (...args: any[]) => any; shareAsync: (...args: any[]) => any };
    storeReview: { isAvailableAsync: (...args: any[]) => any; hasAction: (...args: any[]) => any; requestReview: (...args: any[]) => any };
    viewShot: { captureRef: (...args: any[]) => any };
  };
  var __CEREMONY_MOTION_AVAILABLE__: boolean | undefined;
}

export {};

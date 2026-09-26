// MCORE-16 / MCORE-21 — the card bodies and the Library tile are wrapped in
// React.memo so an unrelated SessionCard / Library state change no longer
// re-renders them, and code tokenization is cached by code + language so a long
// answer is not re-tokenized on every dock resize or pick.
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) =>
      React.createElement('LinearGradient', props, children),
  };
});

import { ReviewBody } from '../../src/features/gacha/components/ReviewBody';
import { McqReviewBody } from '../../src/features/gacha/components/McqReviewBody';
import { CodeBlock, tokenizeCode } from '../../src/components/CodeBlock';
import { LibraryCardTile } from '../../src/features/gacha/library/LibraryCardTile';

const MEMO = Symbol.for('react.memo');

describe('memoized components', () => {
  it('ReviewBody, McqReviewBody, CodeBlock and LibraryCardTile are React.memo components', () => {
    expect((ReviewBody as any).$$typeof).toBe(MEMO);
    expect((McqReviewBody as any).$$typeof).toBe(MEMO);
    expect((CodeBlock as any).$$typeof).toBe(MEMO);
    expect((LibraryCardTile as any).$$typeof).toBe(MEMO);
  });

  it('tokenizeCode returns the cached tokens for the same code and language', () => {
    const code = 'const x = 1;\nreturn x;';
    const first = tokenizeCode(code, 'javascript');
    const second = tokenizeCode(code, 'javascript');
    // Identical input → the exact same array reference (a cache hit).
    expect(second).toBe(first);

    // A different language is a different cache entry, so a distinct reference.
    const python = tokenizeCode(code, 'python');
    expect(python).not.toBe(first);
    // The tokens are still correct (two lines split and tokenized).
    expect(first).toHaveLength(2);
  });
});

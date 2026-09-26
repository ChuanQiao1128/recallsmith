// useScrollToTopOnChange — the session hook that resets the scroll surface to the top whenever the
// card (the reset key) changes, but never on the first render (MCORE-03). Driven with a fake ref so
// no real ScrollView is needed.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useScrollToTopOnChange } from '../../src/features/gacha/session/useScrollToTopOnChange';

function Harness({ refObj, resetKey }: { refObj: any; resetKey: string | null }) {
  useScrollToTopOnChange(refObj, resetKey);
  return null;
}

describe('useScrollToTopOnChange', () => {
  it('does not scroll on the first render', () => {
    const scrollTo = vi.fn();
    const ref = { current: { scrollTo } };
    act(() => {
      renderer.create(<Harness refObj={ref} resetKey="card-a" />);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to the top without animation when the reset key changes', () => {
    const scrollTo = vi.fn();
    const ref = { current: { scrollTo } };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Harness refObj={ref} resetKey="card-a" />);
    });
    act(() => {
      tree.update(<Harness refObj={ref} resetKey="card-b" />);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('ignores an empty ref and an unchanged key', () => {
    // An empty ref must not throw when the key changes.
    const emptyRef = { current: null };
    let emptyTree!: renderer.ReactTestRenderer;
    act(() => {
      emptyTree = renderer.create(<Harness refObj={emptyRef} resetKey="card-a" />);
    });
    expect(() =>
      act(() => {
        emptyTree.update(<Harness refObj={emptyRef} resetKey="card-b" />);
      }),
    ).not.toThrow();

    // A re-render with the same key must not scroll.
    const scrollTo = vi.fn();
    const ref = { current: { scrollTo } };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Harness refObj={ref} resetKey="card-k" />);
    });
    act(() => {
      tree.update(<Harness refObj={ref} resetKey="card-k" />);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

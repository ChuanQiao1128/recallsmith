import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { RootErrorBoundary } from '../../src/components/RootErrorBoundary';

let shouldThrow = true;

function Bomb() {
  if (shouldThrow) {
    throw new Error('boom');
  }
  return React.createElement('Text', { testID: 'child-ok' }, 'ok');
}

describe('RootErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    shouldThrow = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    shouldThrow = false;
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RootErrorBoundary>
          <Bomb />
        </RootErrorBoundary>,
      );
    });
    expect(tree!.root.findAllByProps({ testID: 'child-ok' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ testID: 'root-error-boundary' })).toHaveLength(0);
  });

  it('catches a render error and shows the retry screen', () => {
    shouldThrow = true;
    let tree: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(
          <RootErrorBoundary>
            <Bomb />
          </RootErrorBoundary>,
        );
      });
    }).not.toThrow();
    expect(tree!.root.findAllByProps({ testID: 'root-error-boundary' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ children: 'Something went wrong' }).length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalledWith(
      '[recallsmith] root error boundary',
      expect.objectContaining({ message: 'boom' }),
      expect.any(String),
    );
    expect(tree!.root.findAllByProps({ testID: 'child-ok' })).toHaveLength(0);
  });

  it('retries the children when Try again is pressed', () => {
    shouldThrow = true;
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RootErrorBoundary>
          <Bomb />
        </RootErrorBoundary>,
      );
    });
    expect(tree!.root.findAllByProps({ testID: 'root-error-boundary' }).length).toBeGreaterThan(0);
    shouldThrow = false;
    act(() => {
      tree!.root.findByProps({ testID: 'root-error-retry' }).props.onPress();
    });
    expect(tree!.root.findAllByProps({ testID: 'child-ok' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ testID: 'root-error-boundary' })).toHaveLength(0);
  });

  it('keeps the fallback when the retry throws again', () => {
    shouldThrow = true;
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <RootErrorBoundary>
          <Bomb />
        </RootErrorBoundary>,
      );
    });
    expect(() => {
      act(() => {
        tree!.root.findByProps({ testID: 'root-error-retry' }).props.onPress();
      });
    }).not.toThrow();
    expect(tree!.root.findAllByProps({ testID: 'root-error-boundary' }).length).toBeGreaterThan(0);
    const ourCalls = errorSpy.mock.calls.filter((c: any[]) => c[0] === '[recallsmith] root error boundary');
    expect(ourCalls.length).toBeGreaterThanOrEqual(2);
  });
});

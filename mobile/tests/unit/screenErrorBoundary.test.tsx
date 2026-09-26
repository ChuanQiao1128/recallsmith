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

const reportClientError = vi.fn();
vi.mock('../../src/telemetry/clientErrorReporter', () => ({
  reportClientError: (...args: any[]) => reportClientError(...args),
}));

import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';

let shouldThrow = true;

function Bomb() {
  if (shouldThrow) {
    throw new Error('screen boom');
  }
  return React.createElement('Text', { testID: 'child-ok' }, 'ok');
}

describe('ScreenErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    shouldThrow = true;
    reportClientError.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders a fallback with Try again and Back to Home when a screen throws', () => {
    let tree: renderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        tree = renderer.create(
          <ScreenErrorBoundary screen="Deck" onGoHome={() => {}}>
            <Bomb />
          </ScreenErrorBoundary>,
        );
      });
    }).not.toThrow();

    expect(tree!.root.findAllByProps({ testID: 'screen-error-boundary' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ children: 'Try again' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ children: 'Back to Home' }).length).toBeGreaterThan(0);
    expect(tree!.root.findAllByProps({ testID: 'child-ok' })).toHaveLength(0);
  });

  it('Back to Home calls onGoHome', () => {
    const onGoHome = vi.fn();
    let tree: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ScreenErrorBoundary screen="Deck" onGoHome={onGoHome}>
          <Bomb />
        </ScreenErrorBoundary>,
      );
    });

    act(() => {
      tree!.root.findByProps({ testID: 'screen-error-home' }).props.onPress();
    });
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('reports the render error with the screen name', () => {
    act(() => {
      renderer.create(
        <ScreenErrorBoundary screen="Deck" onGoHome={() => {}}>
          <Bomb />
        </ScreenErrorBoundary>,
      );
    });

    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'screen boom' }),
      { screen: 'Deck', kind: 'boundary' },
    );
  });
});

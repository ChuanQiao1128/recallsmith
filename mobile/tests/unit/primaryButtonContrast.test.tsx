import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { composite, contrastRatio, flattenStyle } from '../helpers/contrast';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { PrimaryButton } from '../../src/components/ui/PrimaryButton';

describe('PrimaryButton active text contrast', () => {
  it.each(['primary', 'gold', 'danger'] as const)('%s keeps the rendered label, eyebrow and hint readable in both states', (tone) => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<PrimaryButton label="Continue" eyebrow="Ready" hint="3 draws available" tone={tone} />); });
    const button = tree.root.find((node) => (node.type as any) === 'Pressable');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toEqual({ disabled: false });
    const texts = tree.root.findAll((node) => (node.type as any) === 'Text');
    expect(texts).toHaveLength(3);
    for (const pressed of [false, true]) {
      const background = flattenStyle(button.props.style({ pressed })).backgroundColor;
      for (const node of texts) {
        const text = flattenStyle(node.props.style);
        const renderedForeground = composite(text.color, background, text.opacity ?? 1);
        expect(contrastRatio(renderedForeground, background), `${tone}/${pressed}/${node.props.children}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    act(() => { tree.unmount(); });
  });

  it('preserves the disabled treatment and suppresses its action', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<PrimaryButton label="Continue" disabled onPress={vi.fn()} />); });
    const button = tree.root.find((node) => (node.type as any) === 'Pressable');
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    expect(button.props.onPress).toBeUndefined();
    expect(flattenStyle(button.props.style({ pressed: true })).opacity).toBe(0.5);
    act(() => { tree.unmount(); });
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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

import { McqActionDock } from '../../src/features/gacha/components/McqActionDock';
import { MCQ_COPY, MCQ_TEST_IDS } from '../../src/features/gacha/mcq/mcqConstants';

type Overrides = Partial<React.ComponentProps<typeof McqActionDock>>;

function renderDock(overrides: Overrides = {}) {
  const props = {
    stage: 'options' as const,
    requiredCount: 1,
    selectedCount: 1,
    isLastNode: false,
    onShowOptions: vi.fn(),
    onSubmit: vi.fn(),
    onDontKnow: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<McqActionDock {...props} />);
  });
  return { tree, props };
}

function row(tree: renderer.ReactTestRenderer) {
  return tree.root.find((node) => (node.type as any) === 'View' && node.props.testID === MCQ_TEST_IDS.dockRow);
}

function hasTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props.testID === testID).length > 0;
}

function flatStyle(style: any): Record<string, any> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

describe('McqActionDock (compact options row)', () => {
  it('renders the three options-stage actions in one row', () => {
    for (const requiredCount of [1, 2]) {
      const { tree } = renderDock({ requiredCount, selectedCount: requiredCount });
      const rowNode = row(tree);
      const rowButtons = rowNode.findAll((node) => (node.type as any) === 'Pressable');
      expect(rowButtons.map((node) => node.props.testID)).toEqual([
        MCQ_TEST_IDS.submitSure,
        MCQ_TEST_IDS.submitUnsure,
        MCQ_TEST_IDS.dontKnow,
      ]);
    }
  });

  it('moves the confidence hint into the accessibility hint of the submit buttons', () => {
    const { tree } = renderDock();
    expect(hasTestId(tree, 'mcq-dock-hint')).toBe(false);
    const rowNode = row(tree);
    const byId = (id: string) => rowNode.find((node) => (node.type as any) === 'Pressable' && node.props.testID === id);
    expect(byId(MCQ_TEST_IDS.submitSure).props.accessibilityHint).toBe(MCQ_COPY.confidenceHint);
    expect(byId(MCQ_TEST_IDS.submitUnsure).props.accessibilityHint).toBe(MCQ_COPY.confidenceHint);
    expect(byId(MCQ_TEST_IDS.dontKnow).props.accessibilityHint).toBe(MCQ_COPY.dontKnowHint);
  });

  it('keeps every options-stage action at least 44pt tall', () => {
    const { tree } = renderDock();
    const rowButtons = row(tree).findAll((node) => (node.type as any) === 'Pressable');
    expect(rowButtons).toHaveLength(3);
    for (const button of rowButtons) {
      const style = flatStyle(button.props.style({ pressed: false }));
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });
});

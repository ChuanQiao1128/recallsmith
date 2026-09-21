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
import { MCQ_COPY } from '../../src/features/gacha/mcq/mcqConstants';

type Overrides = Partial<React.ComponentProps<typeof McqActionDock>>;

function renderDock(overrides: Overrides = {}) {
  const props = {
    stage: 'stem' as const,
    requiredCount: 1,
    selectedCount: 0,
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

function pressables(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Pressable');
}

function pressable(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === testID);
}

function textById(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Text' && node.props.testID === testID);
}

function hasTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props.testID === testID).length > 0;
}

describe('McqActionDock', () => {
  it('shows one button per stage and gates submit on a full pick', () => {
    // Stem: only Show options.
    const stem = renderDock({ stage: 'stem' });
    const stemButtons = pressables(stem.tree);
    expect(stemButtons).toHaveLength(1);
    expect(stemButtons[0].props.testID).toBe('mcq-show-options');
    expect(
      pressable(stem.tree, 'mcq-show-options')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === 'Show options'),
    ).toBe(true);
    act(() => {
      pressable(stem.tree, 'mcq-show-options').props.onPress();
    });
    expect(stem.props.onShowOptions).toHaveBeenCalledTimes(1);
    for (const id of ['mcq-submit-sure', 'mcq-submit-unsure', 'mcq-dont-know', 'mcq-next']) {
      expect(hasTestId(stem.tree, id)).toBe(false);
    }

    // Options, single-select, nothing picked → submit disabled, no count row.
    const empty = renderDock({ stage: 'options', requiredCount: 1, selectedCount: 0 });
    expect(textById(empty.tree, 'mcq-dock-hint').props.children).toBe('How confident are you?');
    expect(hasTestId(empty.tree, 'mcq-selected-count')).toBe(false);
    expect(pressable(empty.tree, 'mcq-submit-sure').props.disabled).toBe(true);
    expect(pressable(empty.tree, 'mcq-submit-sure').props.accessibilityState.disabled).toBe(true);
    expect(pressable(empty.tree, 'mcq-submit-unsure').props.disabled).toBe(true);
    expect(pressable(empty.tree, 'mcq-dont-know').props.disabled).toBe(false);
    expect(
      pressable(empty.tree, 'mcq-submit-sure')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === 'Sure'),
    ).toBe(true);
    expect(
      pressable(empty.tree, 'mcq-submit-unsure')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === 'Not sure'),
    ).toBe(true);
    expect(
      pressable(empty.tree, 'mcq-dont-know')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === "I don't know"),
    ).toBe(true);

    // A full single pick enables submit; each button routes.
    const picked = renderDock({ stage: 'options', requiredCount: 1, selectedCount: 1 });
    expect(pressable(picked.tree, 'mcq-submit-sure').props.disabled).toBe(false);
    expect(pressable(picked.tree, 'mcq-submit-unsure').props.disabled).toBe(false);
    act(() => {
      pressable(picked.tree, 'mcq-submit-sure').props.onPress();
      pressable(picked.tree, 'mcq-submit-unsure').props.onPress();
      pressable(picked.tree, 'mcq-dont-know').props.onPress();
    });
    expect((picked.props.onSubmit as any).mock.calls.map((call: any[]) => call[0])).toEqual(['sure', 'unsure']);
    expect(picked.props.onDontKnow).toHaveBeenCalledTimes(1);

    // Multi-select shows the count and keeps submit disabled until the pick is full.
    const partial = renderDock({ stage: 'options', requiredCount: 2, selectedCount: 1 });
    expect(textById(partial.tree, 'mcq-selected-count').props.children).toBe('1 of 2 selected');
    expect(pressable(partial.tree, 'mcq-submit-sure').props.disabled).toBe(true);
    const full = renderDock({ stage: 'options', requiredCount: 2, selectedCount: 2 });
    expect(pressable(full.tree, 'mcq-submit-sure').props.disabled).toBe(false);

    // disabled disables every pressable in every stage.
    for (const stage of ['stem', 'options', 'verdict'] as const) {
      const off = renderDock({ stage, requiredCount: 2, selectedCount: 2, disabled: true });
      for (const node of pressables(off.tree)) expect(node.props.disabled).toBe(true);
    }

    // Verdict: only Next.
    const verdict = renderDock({ stage: 'verdict' });
    const verdictButtons = pressables(verdict.tree);
    expect(verdictButtons).toHaveLength(1);
    expect(verdictButtons[0].props.testID).toBe('mcq-next');
    expect(
      pressable(verdict.tree, 'mcq-next')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === 'Next'),
    ).toBe(true);
    act(() => {
      pressable(verdict.tree, 'mcq-next').props.onPress();
    });
    expect(verdict.props.onNext).toHaveBeenCalledTimes(1);
  });

  it('says Finish run on the last node', () => {
    const last = renderDock({ stage: 'verdict', isLastNode: true });
    expect(
      pressable(last.tree, 'mcq-next')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === 'Finish run'),
    ).toBe(true);

    const notLast = renderDock({ stage: 'verdict', isLastNode: false });
    expect(
      pressable(notLast.tree, 'mcq-next')
        .findAll((node) => (node.type as any) === 'Text')
        .some((node) => node.props.children === MCQ_COPY.next),
    ).toBe(true);

    // isLastNode changes nothing in the other stages (no crash, no next button).
    const stem = renderDock({ stage: 'stem', isLastNode: true });
    expect(hasTestId(stem.tree, 'mcq-next')).toBe(false);
  });

  it('carries a button role and disabled state on every pressable', () => {
    for (const stage of ['stem', 'options', 'verdict'] as const) {
      // A full pick so submit's disabled state equals props.disabled.
      const on = renderDock({ stage, requiredCount: 1, selectedCount: 1, disabled: false });
      for (const node of pressables(on.tree)) {
        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityState.disabled).toBe(false);
      }
      const off = renderDock({ stage, requiredCount: 1, selectedCount: 1, disabled: true });
      for (const node of pressables(off.tree)) {
        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityState.disabled).toBe(true);
      }
    }

    // The root View carries the dock testID — 'review-rating-bar' by default, the given id otherwise.
    const def = renderDock({ stage: 'verdict' });
    const roots = def.tree.root.findAll((node) => (node.type as any) === 'View' && node.props.testID === 'review-rating-bar');
    expect(roots).toHaveLength(1);
    const custom = renderDock({ stage: 'verdict', testID: 'my-dock' });
    expect(custom.tree.root.findAll((node) => (node.type as any) === 'View' && node.props.testID === 'my-dock')).toHaveLength(1);
    expect(custom.tree.root.findAll((node) => (node.type as any) === 'View' && node.props.testID === 'review-rating-bar')).toHaveLength(0);
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
    StyleSheet: { create: (styles: any) => styles },
  };
});
import { TranslationAvailability } from '../../src/features/gacha/study/TranslationAvailability';
import type { DeckTranslationsState } from '../../src/features/gacha/study/useDeckTranslations';

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
function render(state: DeckTranslationsState) {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<TranslationAvailability state={state} />); });
  return tree;
}
function copy(tree: renderer.ReactTestRenderer) {
  return tree.root.findAllByType('Text' as any).map((node) => node.props.children).join(' ');
}
describe('TranslationAvailability', () => {
  it('explains an English-only pack instead of silently omitting the language control', () => {
    const tree = render({ status: 'none' });
    expect(copy(tree)).toBe('This pack is available in English only.');
    expect(tree.root.findAllByProps({ testID: 'card-translation-retry' })).toHaveLength(0);
  });
  it('separates loading from a failed read and exposes a usable retry', () => {
    const loading = render({ status: 'loading' });
    expect(copy(loading)).toBe('Checking card languages…');
    const retry = vi.fn();
    const failure = render({ status: 'error', retry });
    expect(copy(failure)).toContain('You can keep studying in English.');
    const button = failure.root.findByProps({ testID: 'card-translation-retry' });
    expect(button.props.style.minHeight).toBeGreaterThanOrEqual(44);
    act(() => button.props.onPress());
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('leaves the existing bilingual toggle to show availability after a successful read', () => {
    expect(render({ status: 'ready', map: new Map() }).toJSON()).toBeNull();
  });
});

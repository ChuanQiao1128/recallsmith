import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheme = vi.hoisted(() => ({ current: 'light' as 'light' | 'dark' }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Alert: { alert: () => {} },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (styles: any) => styles },
    useColorScheme: () => scheme.current,
  };
});

import { INLINE_CODE_TEST_ID, InlineCodeText } from '../../src/features/gacha/components/InlineCodeText';
import { renderSimpleMarkdown } from '../../src/features/gacha/session/reviewContentHelpers';
import { buildLibraryCardRows } from '../../src/features/gacha/library/libraryMapper';

const flatStyle = (style: any): Record<string, any> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

function mount(element: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

const codeSegments = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === INLINE_CODE_TEST_ID);

function strings(node: any): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  return strings(node.children ?? []);
}

describe('InlineCodeText', () => {
  beforeEach(() => {
    scheme.current = 'light';
  });

  it('renders text without a span as one plain Text, exactly as before', () => {
    const tree = mount(<InlineCodeText style={{ fontSize: 16 }} testID="t" text="Which S3 class is cheapest?" />);
    const json = tree.toJSON() as any;
    expect(json.type).toBe('Text');
    expect(json.children).toEqual(['Which S3 class is cheapest?']);
    expect(json.props.accessibilityLabel).toBeUndefined();
    expect(codeSegments(tree)).toHaveLength(0);
  });

  it('renders spans as nested monospace Text, slightly smaller, with no backticks and a stripped label', () => {
    const tree = mount(<InlineCodeText style={[{ fontSize: 20 }, { color: '#000' }]} text="Use `List<int>` and `Add(4)`." />);
    const segments = codeSegments(tree);
    expect(segments.map((node) => node.props.children)).toEqual(['List<int>', 'Add(4)']);
    const style = flatStyle(segments[0].props.style);
    expect(style.fontFamily).toBe('Menlo');
    expect(style.fontSize).toBe(18);
    expect(style.backgroundColor).toBe('rgba(67,42,18,0.08)');
    expect(style.paddingHorizontal).toBeGreaterThan(0);
    expect(strings(tree.toJSON()).join('')).toBe('Use List<int> and Add(4).');
    expect((tree.toJSON() as any).props.accessibilityLabel).toBe('Use List<int> and Add(4).');
  });

  it('uses a light-on-dark background in dark mode', () => {
    scheme.current = 'dark';
    const tree = mount(<InlineCodeText text="Call `Dispose()`." />);
    expect(flatStyle(codeSegments(tree)[0].props.style).backgroundColor).toBe('rgba(255,255,255,0.14)');
  });

  it('keeps a caller label and leaves an unmatched backtick literal', () => {
    const labelled = mount(<InlineCodeText accessibilityLabel="custom" text="`x` here" />);
    expect((labelled.toJSON() as any).props.accessibilityLabel).toBe('custom');
    const stray = mount(<InlineCodeText text="a lone ` tick" />);
    expect((stray.toJSON() as any).children).toEqual(['a lone ` tick']);
  });
});

describe('renderSimpleMarkdown (REAL USAGE)', () => {
  const styles = { mdText: { fontSize: 15 }, mdBullet: {}, mdBulletRow: {} };

  it('renders inline code in paragraphs and bullets without backticks', () => {
    const tree = mount(
      <>{renderSimpleMarkdown('We call `ConfigureAwait(false)` in the SDK.\n- Cache a `HttpClient`\n* Avoid `async void`', styles)}</>,
    );
    expect(codeSegments(tree).map((node) => node.props.children)).toEqual([
      'ConfigureAwait(false)',
      'HttpClient',
      'async void',
    ]);
    expect(strings(tree.toJSON()).some((text) => text.includes('`'))).toBe(false);
  });

  it('renders an AWS paragraph without spans as plain Text', () => {
    const tree = mount(<>{renderSimpleMarkdown('We archive logs to S3 Glacier.', styles)}</>);
    expect((tree.toJSON() as any).children).toEqual(['We archive logs to S3 Glacier.']);
    expect(codeSegments(tree)).toHaveLength(0);
  });
});

describe('library rows', () => {
  it('show the question without inline-code backticks', () => {
    const rows = buildLibraryCardRows({
      deck: {
        Slug: 'dotnet',
        Title: '.NET',
        Locale: 'en-US',
        Version: '1',
        DeckType: 1,
        TotalCards: 1,
        Cards: [{ StableUid: 'u1', OrderInDeck: 1, Difficulty: 1, Question: 'When is `ConfigureAwait(false)` needed?' }],
      } as any,
      progress: [],
    });
    expect(rows[0].question).toBe('When is ConfigureAwait(false) needed?');
  });
});

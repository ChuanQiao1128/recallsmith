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
    // CodeBlock (imported by CardAnswerSections) reads Platform.select at module scope.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
    useColorScheme: () => scheme.current,
  };
});

import { INLINE_CODE_TEST_ID, InlineCodeText } from '../../src/features/gacha/components/InlineCodeText';
import { CardAnswerSections } from '../../src/features/gacha/components/CardAnswerSections';
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

// 2026-10-14 learning flow (B3): the highlighted 答 line is card text like any other, so its spans
// render as code too, and its spoken label drops the backticks.
describe('the answer key line', () => {
  beforeEach(() => {
    scheme.current = 'light';
  });

  const card = (explanation: string): any => ({ StableUid: 'k', OrderInDeck: 1, Difficulty: 1, Question: 'Q', Explanation: explanation });

  it('renders inline code in the key line and in the lines after it, without backticks', () => {
    const tree = mount(<CardAnswerSections card={card('答：用 `aws s3 sync` 同步。\n因为：它只传 `changed` 的文件。')} />);
    const key = tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'answer-key-line');
    expect(key).toHaveLength(1);
    const keySegments = key[0].findAll((node) => typeof node.type === 'string' && node.props.testID === INLINE_CODE_TEST_ID);
    expect(keySegments.map((node) => node.props.children)).toEqual(['aws s3 sync']);
    expect(flatStyle(keySegments[0].props.style).fontFamily).toBe('Menlo');
    const keyText = key[0].findAll((node) => (node.type as any) === 'Text' && node.props.accessibilityLabel !== undefined);
    expect(keyText.map((node) => node.props.accessibilityLabel)).toEqual(['Highlighted line, 答：用 aws s3 sync 同步。']);
    expect(codeSegments(tree).map((node) => node.props.children)).toEqual(['aws s3 sync', 'changed']);
    expect(strings(tree.toJSON()).some((text) => text.includes('`'))).toBe(false);
  });

  it('keeps an English explanation with a span as one body Text, with no key line', () => {
    const tree = mount(<CardAnswerSections card={card('Use `List<int>` here.')} />);
    const body = tree.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Use List<int> here.');
    expect(body).toHaveLength(1);
    expect(flatStyle(body[0].props.style)).toEqual({ fontSize: 15, lineHeight: 22, color: '#3A2C1F', fontWeight: '500' });
    expect(codeSegments(tree).map((node) => node.props.children)).toEqual(['List<int>']);
    expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'answer-key-line')).toHaveLength(0);
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

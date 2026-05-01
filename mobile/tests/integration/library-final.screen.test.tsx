import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) => React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return { SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children) };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return { LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children) };
});

import { LibraryScreen } from '../../src/screens/LibraryScreen';
import { SortFilterScreen } from '../../src/screens/SortFilterScreen';
import { AudienceFilterScreen } from '../../src/screens/AudienceFilterScreen';
import { PoolOverviewScreen } from '../../src/screens/PoolOverviewScreen';
import { TagExplorerScreen } from '../../src/screens/TagExplorerScreen';
import { CardDetailScreen } from '../../src/screens/CardDetailScreen';

function collectText(node: renderer.ReactTestInstance): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      parts.push(child);
      continue;
    }
    parts.push(collectText(child));
  }
  return parts.join(' ');
}

function textBlob(tree: renderer.ReactTestRenderer): string {
  return collectText(tree.root).replace(/\s+/g, ' ').trim();
}

function findPressableByText(tree: renderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as any) === 'Pressable' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.children === label).length > 0,
  );
}

describe('library final flow', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('uses collection-first copy and clear inventory statuses on the library landing page', async () => {
    const navigate = vi.fn();
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<LibraryScreen navigation={{ navigate } as any} route={{ key: 'lib', name: 'Library' } as any} />);
    });

    const blob = textBlob(tree);
    expect(blob).toContain('Your card library');
    expect(blob).toContain('Collection snapshot');
    expect(blob).toContain('Browse by status');
    expect(blob).toContain('New');
    expect(blob).toContain('Learning');
    expect(blob).toContain('Mastered');
    expect(blob).toContain('Owned cards');
    expect(blob).not.toContain('Phase B');
    expect(blob).not.toContain('warmer cabinet');
    expect(blob).not.toContain('Curate the shelf');

    act(() => {
      findPressableByText(tree, 'Filter library').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('SortFilter');
  });

  it('keeps the filter and audience sheets productized instead of placeholder spec language', async () => {
    const navigate = vi.fn();

    let sortTree!: renderer.ReactTestRenderer;
    await act(async () => {
      sortTree = renderer.create(<SortFilterScreen navigation={{ navigate } as any} route={{ key: 'sort', name: 'SortFilter' } as any} />);
    });
    const sortBlob = textBlob(sortTree);
    expect(sortBlob).toContain('Filter library');
    expect(sortBlob).toContain('Status');
    expect(sortBlob).toContain('This only changes how your library is browsed right now');
    expect(sortBlob).not.toContain('phase-B sheet equivalent');
    expect(sortBlob).not.toContain('without losing the route');

    act(() => {
      findPressableByText(sortTree, 'Audience focus').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('AudienceFilter');

    let audienceTree!: renderer.ReactTestRenderer;
    await act(async () => {
      audienceTree = renderer.create(<AudienceFilterScreen navigation={{ navigate } as any} route={{ key: 'audience', name: 'AudienceFilter' } as any} />);
    });
    const audienceBlob = textBlob(audienceTree);
    expect(audienceBlob).toContain('Choose an audience focus');
    expect(audienceBlob).toContain('Due review stays the same');
    expect(audienceBlob).not.toContain('Temporary audience override for library browsing');
  });

  it('keeps the deeper library pages focused on inventory detail and exploration', async () => {
    const navigate = vi.fn();

    let poolTree!: renderer.ReactTestRenderer;
    await act(async () => {
      poolTree = renderer.create(<PoolOverviewScreen navigation={{ navigate } as any} route={{ key: 'pool', name: 'PoolOverview', params: { poolId: 'csharp' } } as any} />);
    });
    const poolBlob = textBlob(poolTree);
    expect(poolBlob).toContain('Pool progress');
    expect(poolBlob).toContain('Collection progress');
    expect(poolBlob).toContain('Mastery progress');
    expect(poolBlob).not.toContain('dashboard layer for one archive');

    act(() => {
      findPressableByText(poolTree, 'Explore tags').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('TagExplorer', { poolId: 'csharp' });

    let tagTree!: renderer.ReactTestRenderer;
    await act(async () => {
      tagTree = renderer.create(<TagExplorerScreen navigation={{ navigate } as any} route={{ key: 'tag', name: 'TagExplorer', params: { poolId: 'csharp' } } as any} />);
    });
    const tagBlob = textBlob(tagTree);
    expect(tagBlob).toContain('Tag coverage');
    expect(tagBlob).toContain('Filter library by tag');
    expect(tagBlob).not.toContain('bridge from pool overview');

    let cardTree!: renderer.ReactTestRenderer;
    await act(async () => {
      cardTree = renderer.create(<CardDetailScreen navigation={{ navigate } as any} route={{ key: 'card', name: 'CardDetail', params: { cardId: 'card-1' } } as any} />);
    });
    const cardBlob = textBlob(cardTree);
    expect(cardBlob).toContain('Card details');
    expect(cardBlob).toContain('Study status');
    expect(cardBlob).toContain('Related tags');
    expect(cardBlob).not.toContain('phase-B stand-in');
  });
});

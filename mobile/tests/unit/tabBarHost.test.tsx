import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement('Pressable', { ...props, onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

vi.mock('expo-status-bar', () => {
  const React = require('react');
  return {
    StatusBar: (props: any) => React.createElement('StatusBar', props),
  };
});

vi.mock('../../src/components/BottomTabBar', () => {
  const React = require('react');
  return {
    default: (props: any) => React.createElement('BottomTabBar', props),
  };
});

import { TabBarHost } from '../../src/navigation/TabBarHost';
import { createRouteNameStore } from '../../src/navigation/routeNameStore';
import { statusBarStyleForRoute } from '../../src/navigation/statusBarStyle';

function findBottomTabBars(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'BottomTabBar');
}

function findStatusBar(tree: renderer.ReactTestRenderer) {
  return tree.root.find((node) => (node.type as any) === 'StatusBar');
}

async function renderHost(routeName: string | undefined, navigate = vi.fn()) {
  const store = createRouteNameStore();
  store.set(routeName);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TabBarHost routeStore={store} navigate={navigate} />);
  });
  return { store, tree, navigate };
}

describe('TabBarHost', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders the tab bar only for main-tab routes', async () => {
    const onMainTab = await renderHost('Home');
    expect(findBottomTabBars(onMainTab.tree)).toHaveLength(1);

    const offMainTab = await renderHost('Settings');
    expect(findBottomTabBars(offMainTab.tree)).toHaveLength(0);
  });

  it('re-renders from the route store without the app root', async () => {
    const { store, tree } = await renderHost('Home');
    expect(findBottomTabBars(tree)[0].props.active).toBe('home');

    act(() => {
      store.set('Library');
    });

    expect(findBottomTabBars(tree)[0].props.active).toBe('library');
  });

  it('uses a light status bar on cosmic routes and dark elsewhere', async () => {
    const { store, tree } = await renderHost('More');
    expect(findStatusBar(tree).props.style).toBe('light');

    act(() => {
      store.set('Home');
    });

    expect(findStatusBar(tree).props.style).toBe('dark');
  });

  it('calls the navigate callback when a tab is pressed', async () => {
    const { tree, navigate } = await renderHost('Home');

    act(() => {
      findBottomTabBars(tree)[0].props.navigate('SessionCard');
    });

    expect(navigate).toHaveBeenCalledWith('SessionCard');
  });

  it('notifies route store subscribers only when the route changes', () => {
    const store = createRouteNameStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set('Home');
    expect(listener).toHaveBeenCalledTimes(1);

    // Setting the same name again must not notify.
    store.set('Home');
    expect(listener).toHaveBeenCalledTimes(1);

    store.set('Library');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('maps the cosmic Me, Help and Debug routes to a light status bar', () => {
    expect(statusBarStyleForRoute('More')).toBe('light');
    expect(statusBarStyleForRoute('HelpFAQ')).toBe('light');
    expect(statusBarStyleForRoute('DebugMenu')).toBe('light');
    expect(statusBarStyleForRoute('Home')).toBe('dark');
    expect(statusBarStyleForRoute(undefined)).toBe('dark');
  });
});

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

import { MoreScreen } from '../../src/screens/MoreScreen';
import { ProfileScreen } from '../../src/screens/ProfileScreen';
import { HelpFAQScreen } from '../../src/screens/HelpFAQScreen';

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

describe('me final flow', () => {
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

  it('uses profile-and-support product language on the me landing flow', async () => {
    const navigate = vi.fn();
    let moreTree!: renderer.ReactTestRenderer;
    await act(async () => {
      moreTree = renderer.create(<MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />);
    });

    const moreBlob = textBlob(moreTree);
    expect(moreBlob).toContain('Your profile and support');
    expect(moreBlob).toContain('Profile');
    expect(moreBlob).toContain('Settings');
    expect(moreBlob).toContain('Help');
    expect(moreBlob).not.toContain('Developer tools');
    expect(moreBlob).not.toContain('Profile, settings, support, and QA');
    expect(moreBlob).not.toContain('Phase C');
    expect(moreBlob).not.toContain('QA lane');

    act(() => {
      findPressableByText(moreTree, 'Help').props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('HelpFAQ');

    let profileTree!: renderer.ReactTestRenderer;
    await act(async () => {
      profileTree = renderer.create(<ProfileScreen navigation={{ navigate } as any} route={{ key: 'profile', name: 'Profile' } as any} />);
    });
    const profileBlob = textBlob(profileTree);
    expect(profileBlob).toContain('Your study profile');
    expect(profileBlob).toContain('Current setup');
    expect(profileBlob).not.toContain('Learner #local');
    expect(profileBlob).toContain('Momentum this week');
    expect(profileBlob).not.toContain('Next best return point');
    expect(profileBlob).not.toContain('premium learner card');

    let faqTree!: renderer.ReactTestRenderer;
    await act(async () => {
      faqTree = renderer.create(<HelpFAQScreen navigation={{ navigate } as any} route={{ key: 'faq', name: 'HelpFAQ' } as any} />);
    });
    const faqBlob = textBlob(faqTree);
    expect(faqBlob).toContain('Help and answers');
    expect(faqBlob).toContain('Top questions');
    expect(faqBlob).not.toContain('cosmic support treatment');
  });
});

import { describe, expect, it, vi } from 'vitest';

// The *_COPY constants live next to their section components, so importing them
// pulls in react-native, whose Flow-typed entry point the bundler cannot parse.
// Only the primitives these sections reference at module scope are needed here.
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { ACCOUNT_COPY } from '../../src/features/gacha/settings/account/AccountSection';
import { CONTENT_COPY } from '../../src/features/gacha/settings/content/ContentSection';
import { REMINDERS_COPY } from '../../src/features/gacha/settings/reminders/RemindersSection';
import { APPEARANCE_COPY } from '../../src/features/gacha/settings/appearance/AppearanceSection';
import { ABOUT_COPY } from '../../src/features/gacha/settings/about/AboutSection';
import { DEBUG_COPY } from '../../src/features/gacha/settings/debug/DebugSection';

const FORBIDDEN = ['wipe', 'delete all'];

describe('settings section copy', () => {
  it('keeps destructive wording out of primary settings sections', () => {
    const all = JSON.stringify([
      ACCOUNT_COPY,
      CONTENT_COPY,
      REMINDERS_COPY,
      APPEARANCE_COPY,
      ABOUT_COPY,
      DEBUG_COPY,
    ]).toLowerCase();

    for (const word of FORBIDDEN) {
      expect(all).not.toContain(word);
    }
  });
});

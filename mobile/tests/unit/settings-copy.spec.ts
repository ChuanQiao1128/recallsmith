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
import { FEEDBACK_COPY } from '../../src/features/gacha/settings/feedback/FeedbackSection';

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

  // R24B §1/§3: learner settings copy uses plain words (debug copy is dev-only).
  it('uses plain words for draws, sessions and pack opening', () => {
    expect(FEEDBACK_COPY.soundBody).toBe('Pack opening sounds. They stay quiet when your ringer is on silent.');
    expect(ACCOUNT_COPY.deleteBody).toBe(
      'Permanently deletes your account and the progress, cards and saved draws stored for it on our servers and on this device. This cannot be undone.',
    );
    const learnerCopy = JSON.stringify([
      ACCOUNT_COPY.deleteBody,
      ACCOUNT_COPY,
      CONTENT_COPY,
      REMINDERS_COPY,
      APPEARANCE_COPY,
      ABOUT_COPY,
      FEEDBACK_COPY,
    ]);
    expect(learnerCopy).not.toMatch(/\b(pulls?|pity|wallet|reserve|run|runs|ceremony|momentum|rescue)\b/i);
  });
});

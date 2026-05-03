import { describe, expect, it } from 'vitest';
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

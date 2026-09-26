import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve against the mobile package root so paths read the same whether the
// suite runs from mobile/ or the repo root.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');

// The 48 routes retired in G20 (plan §4.5's 47 dead screens plus EditProfile).
// A future link must not be able to reach a mock/unreachable screen, so this
// list stays deleted from App.tsx and RootStackParamList.
const RETIRED_ROUTES = [
  'Deck',
  'Challenge',
  'Level',
  'DailyDose',
  'TagExplorer',
  'SortFilter',
  'CoachOverlay',
  'Settlement',
  'FreePullGrant',
  'FreePullInventory',
  'SettingsMain',
  'SettingsAppearance',
  'SettingsAudience',
  'SettingsNotifications',
  'SettingsPools',
  'About',
  'AudienceFilter',
  'EditProfile',
  'Achievements',
  'BacklogBurst',
  'BacklogWarning',
  'CollectionMilestone',
  'DailyDigest',
  'DormantNudge',
  'ErrorGeneric',
  'ErrorNetwork',
  'FreshStartConfirm',
  'FreshStartLanding',
  'MasteredCelebration',
  'MasteryMilestone',
  'MilestoneDetail',
  'MilestoneHall',
  'MonthRewind',
  'MonthSummary',
  'OfflineBanner',
  'PausedPool',
  'PlanMonth',
  'PlanOverview',
  'PlanToday',
  'PlanWeek',
  'PoolLaunch',
  'PoolOverview',
  'PoolPicker',
  'StreakMilestone',
  'ToastHost',
  'WeekPlannerPrompt',
  'WeekStreakMilestone',
  'WeekSummary',
] as const;

describe('retired screens stay retired', () => {
  it('App.tsx imports no retired screen', () => {
    const app = read('App.tsx');
    for (const name of RETIRED_ROUTES) {
      expect(app).not.toMatch(new RegExp(`screens/${name}Screen['"]`));
      expect(app).not.toContain(`name="${name}"`);
    }
  });

  it('RootStackParamList declares no retired route', () => {
    const types = read('src/navigation/types.ts');
    for (const name of RETIRED_ROUTES) {
      expect(types).not.toMatch(new RegExp(`^\\s*${name}\\s*:`, 'm'));
    }
    expect(types).not.toContain('mockState');
    expect(types).not.toContain('completionRoute');
  });

  it('the mock data folder and the v6 shell components are gone', () => {
    expect(existsSync(ROOT + 'src/mock')).toBe(false);
    expect(existsSync(ROOT + 'src/features/gacha/components/V6ShellScreen.tsx')).toBe(false);
    expect(existsSync(ROOT + 'src/features/gacha/components/V6DataScreen.tsx')).toBe(false);
    expect(existsSync(ROOT + 'src/features/gacha/components/V6QuickNavBar.tsx')).toBe(false);
    expect(existsSync(ROOT + 'src/components/ParchmentScaffold.tsx')).toBe(false);
    expect(existsSync(ROOT + 'src/content/contentConfig.ts')).toBe(false);
    expect(existsSync(ROOT + 'src/auth/AuthGateModal.tsx')).toBe(false);
    expect(existsSync(ROOT + 'src/features/gacha/settlement/settlementVm.ts')).toBe(false);
    expect(existsSync(ROOT + 'src/features/gacha/session/levelFlow.ts')).toBe(false);
  });
});

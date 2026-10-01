import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let streakSnapshotFixture = {
  currentDailyStreak: 0,
  longestDailyStreak: 0,
  weekCompletedDays: 0,
  totalQualifiedSessions: 0,
  lastQualifiedDateKey: null as string | null,
  currentWeekKey: null as string | null,
};
let drawStateFixture: Record<string, string[]> = {
  csharp: ['c-001', 'c-002', 'c-003'],
  'aws-saa-c03': ['a-001', 'a-002'],
};
let audienceFixture: 'junior' | 'both' | 'all' = 'both';
const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn(async () => undefined) }));

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
    Linking: { openURL: openUrlMock },
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
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

vi.mock('../../src/features/gacha/streaks/streakTracker', () => ({
  loadStreakSnapshot: vi.fn(async () => streakSnapshotFixture),
}));

vi.mock('../../src/features/gacha/draw/drawStateStore', () => ({
  listDrawStateSlugs: vi.fn(async () => Object.keys(drawStateFixture)),
  loadDrawState: vi.fn(async (slug: string) => ({ owned: drawStateFixture[slug] ?? [], pity: null })),
}));

vi.mock('../../src/features/gacha/audience/audiencePrefs', () => ({
  getAudiencePreference: vi.fn(async () => audienceFixture),
}));

vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn() }));
const authState = vi.hoisted(() => ({ status: 'signed_in' as string }));
vi.mock('../../src/auth/authStore', () => ({ useAuthStore: { getState: () => authState } }));

import { apiJson } from '../../src/api/apiClient';
import { getFreshAccessToken } from '../../src/auth/freshToken';
import { FRIENDLY_ERROR_COPY } from '../../src/api/errorKind';
import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { MoreScreen, MORE_LINKS } from '../../src/screens/MoreScreen';
import { MyReportsScreen, reportBadgeLabel } from '../../src/screens/MyReportsScreen';
import { CHROME_MAX_FONT_SCALE } from '../../src/theme/dynamicType';

const flagOn = () => applyRemoteFeatures({ features: { cardReport: { enabled: true } } } as unknown as RemoteConfig);

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

function textOf(node: renderer.ReactTestInstance): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}

async function renderMore(navigate = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<MoreScreen navigation={{ navigate } as any} route={{ key: 'more', name: 'More' } as any} />);
  });
  await flush();
  return tree;
}

async function renderReports(goBack = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <MyReportsScreen navigation={{ goBack, navigate: vi.fn() } as any} route={{ key: 'r', name: 'MyReports' } as any} />,
    );
  });
  await flush();
  return tree;
}

const REPORTS = [
  {
    reportId: 4,
    deckSlug: 'csharp',
    stableUid: 'cs-4',
    question: 'What does a using statement do?',
    reason: 'wrong_answer',
    status: 'open',
    resolution: null,
    resolutionNote: null,
    createdAt: '2026-09-30T10:00:00Z',
    resolvedAt: null,
  },
  {
    reportId: 3,
    deckSlug: 'csharp',
    stableUid: 'cs-3',
    question: 'Explain async void',
    reason: 'outdated',
    status: 'resolved',
    resolution: 'fixed',
    resolutionNote: 'Updated for .NET 8',
    createdAt: '2026-09-20T10:00:00Z',
    resolvedAt: '2026-09-21T10:00:00Z',
  },
  {
    reportId: 2,
    deckSlug: 'aws-saa-c03',
    stableUid: 'a-2',
    question: 'S3 storage classes',
    reason: 'typo',
    status: 'resolved',
    resolution: 'wont_fix',
    resolutionNote: null,
    createdAt: '2026-09-10T10:00:00Z',
    resolvedAt: '2026-09-11T10:00:00Z',
  },
];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiJson).mockReset();
  vi.mocked(getFreshAccessToken).mockReset();
  vi.mocked(getFreshAccessToken).mockResolvedValue('tok-9');
  authState.status = 'signed_in';
  openUrlMock.mockClear();
});

afterEach(() => {
  applyRemoteFeatures(null);
});

describe('MoreScreen — My reports row', () => {
  it('is hidden when the flag is off (the default)', async () => {
    const tree = await renderMore();
    expect(byTestId(tree, 'more-row-reports')).toHaveLength(0);
    expect(byTestId(tree, 'more-row-support')).toHaveLength(1);
  });

  it('shows with the flag on, navigates to MyReports and leaves Support unchanged', async () => {
    flagOn();
    const navigate = vi.fn();
    const tree = await renderMore(navigate);
    const row = byTestId(tree, 'more-row-reports');
    expect(row).toHaveLength(1);
    expect(row[0].props.accessibilityRole).toBe('button');
    const texts = row[0].findAll((n) => (n.type as unknown) === 'Text').map(textOf);
    expect(texts[0]).toBe('My reports');
    act(() => {
      row[0].props.onPress();
    });
    expect(navigate).toHaveBeenCalledWith('MyReports');

    const support = byTestId(tree, 'more-row-support')[0];
    expect(support.findAll((n) => (n.type as unknown) === 'Text').map(textOf)).toEqual([
      'Support',
      'Report a wrong card or ask a question',
    ]);
    act(() => {
      support.props.onPress();
    });
    expect(openUrlMock).toHaveBeenCalledWith(MORE_LINKS.support);
  });
});

describe('MyReportsScreen', () => {
  it('maps every status and resolution to a badge label', () => {
    expect(reportBadgeLabel({ status: 'open', resolution: null })).toBe('Open');
    expect(reportBadgeLabel({ status: 'resolved', resolution: 'fixed' })).toBe('Fixed');
    expect(reportBadgeLabel({ status: 'resolved', resolution: 'wont_fix' })).toBe("Won't fix");
    expect(reportBadgeLabel({ status: 'resolved', resolution: 'duplicate' })).toBe('Duplicate');
    expect(reportBadgeLabel({ status: 'resolved', resolution: 'invalid' })).toBe('Invalid');
    expect(reportBadgeLabel({ status: 'resolved', resolution: null })).toBe('Closed');
  });

  it('lists reports newest first with badges and the resolution note', async () => {
    vi.mocked(apiJson).mockResolvedValue({ success: true, data: { items: REPORTS } });
    const tree = await renderReports();

    expect(apiJson).toHaveBeenCalledWith('/api/v1/user/card-reports?limit=50', expect.objectContaining({ method: 'GET', accessToken: 'tok-9' }));
    const rows = byTestId(tree, 'my-reports-item');
    expect(rows).toHaveLength(3);
    expect(byTestId(tree, 'my-reports-badge').map(textOf)).toEqual(['Open', 'Fixed', "Won't fix"]);
    expect(byTestId(tree, 'my-reports-question').map(textOf)).toEqual([
      'What does a using statement do?',
      'Explain async void',
      'S3 storage classes',
    ]);
    const notes = byTestId(tree, 'my-reports-resolution-note');
    expect(notes).toHaveLength(1);
    expect(textOf(notes[0])).toBe('Updated for .NET 8');
    expect(byTestId(tree, 'my-reports-empty')).toHaveLength(0);
    for (const row of rows) expect(typeof row.props.accessibilityLabel).toBe('string');
    expect(rows[1].props.accessibilityLabel).toContain('Fixed');
  });

  // F01 y-correctness-3: the API echoes the raw question; a fenced code block must show as prose
  // only (no backticks, no code), like every other row surface.
  it('shows the prose only for a reported question with a fenced code block', async () => {
    const fenced = {
      ...REPORTS[0],
      question: 'What does this print?\n```csharp\nvar xs = new[]{1,2,3};\nConsole.WriteLine(xs.Length);\n```\n',
    };
    const fenceOnly = { ...REPORTS[1], question: '```csharp\nConsole.WriteLine(1 + 1);\n```\n' };
    vi.mocked(apiJson).mockResolvedValue({ success: true, data: { items: [fenced, fenceOnly, REPORTS[2]] } });
    const tree = await renderReports();

    expect(byTestId(tree, 'my-reports-question').map(textOf)).toEqual([
      'What does this print?',
      'What does this code do?',
      'S3 storage classes',
    ]);
    const rows = byTestId(tree, 'my-reports-item');
    expect(rows[0].props.accessibilityLabel.startsWith('Open. What does this print?. ')).toBe(true);
    for (const row of rows) {
      expect(row.props.accessibilityLabel).not.toContain('`');
      expect(row.props.accessibilityLabel).not.toContain('Console.WriteLine');
    }
  });

  // F01 z-tests-2: inline code spans in a reported question show without backticks, in the row
  // and in its label.
  it('drops inline-code backticks from a reported question', async () => {
    const inline = { ...REPORTS[0], question: 'Why does `List<int>` regrow on `Add(4)`?' };
    vi.mocked(apiJson).mockResolvedValue({ success: true, data: { items: [inline] } });
    const tree = await renderReports();

    expect(byTestId(tree, 'my-reports-question').map(textOf)).toEqual(['Why does List<int> regrow on Add(4)?']);
    const row = byTestId(tree, 'my-reports-item')[0];
    expect(row.props.accessibilityLabel.startsWith('Open. Why does List<int> regrow on Add(4)?. ')).toBe(true);
  });

  it('shows the empty state when there are no reports', async () => {
    vi.mocked(apiJson).mockResolvedValue({ data: { items: [] } });
    const tree = await renderReports();
    expect(byTestId(tree, 'my-reports-empty')).toHaveLength(1);
    expect(byTestId(tree, 'my-reports-item')).toHaveLength(0);
  });

  it('shows a sign-in message when signed out, without calling the API', async () => {
    authState.status = 'anonymous';
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const tree = await renderReports();
    expect(textOf(byTestId(tree, 'my-reports-signed-out')[0])).toBe('Sign in to see your reports');
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('shows offline copy and Try again, not the sign-in message, when signed in but the token refresh failed', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const tree = await renderReports();
    expect(byTestId(tree, 'my-reports-signed-out')).toHaveLength(0);
    expect(textOf(byTestId(tree, 'my-reports-error')[0])).toBe(FRIENDLY_ERROR_COPY.offline);
    expect(byTestId(tree, 'my-reports-retry')).toHaveLength(1);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('shows friendly error copy and retries', async () => {
    const offline: any = new Error('Network request failed');
    offline.kind = 'offline';
    vi.mocked(apiJson).mockRejectedValueOnce(offline).mockResolvedValueOnce({ data: { items: REPORTS.slice(0, 1) } });
    const tree = await renderReports();
    expect(textOf(byTestId(tree, 'my-reports-error')[0])).toBe(FRIENDLY_ERROR_COPY.offline);
    const retry = byTestId(tree, 'my-reports-retry')[0];
    expect(retry.props.accessibilityRole).toBe('button');
    await act(async () => {
      retry.props.onPress();
    });
    await flush();
    expect(byTestId(tree, 'my-reports-item')).toHaveLength(1);
    expect(byTestId(tree, 'my-reports-error')).toHaveLength(0);
  });

  it('shows the unavailable copy on 503', async () => {
    const err: any = new Error('off');
    err.status = 503;
    vi.mocked(apiJson).mockRejectedValue(err);
    const tree = await renderReports();
    expect(textOf(byTestId(tree, 'my-reports-error')[0])).toBe('Reporting is unavailable right now');
  });

  it('has an accessible back button and capped chrome text', async () => {
    vi.mocked(apiJson).mockResolvedValue({ data: { items: [] } });
    const goBack = vi.fn();
    const tree = await renderReports(goBack);
    const back = byTestId(tree, 'my-reports-back')[0];
    expect(back.props.accessibilityRole).toBe('button');
    expect(back.props.accessibilityLabel).toBe('Back');
    const rawStyle = typeof back.props.style === 'function' ? back.props.style({ pressed: false }) : back.props.style;
    const style = Object.assign({}, ...[rawStyle].flat(Infinity).filter(Boolean));
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    act(() => {
      back.props.onPress();
    });
    expect(goBack).toHaveBeenCalledTimes(1);
    const title = byTestId(tree, 'my-reports-title')[0];
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
  });
});

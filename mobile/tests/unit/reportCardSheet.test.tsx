import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return {
    View: host('View'),
    Text: host('Text'),
    Modal: host('Modal'),
    TextInput: host('TextInput'),
    Pressable: ({ children, onPress, style, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress, style: typeof style === 'function' ? style({ pressed: false }) : style },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
  };
});

vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));
vi.mock('../../src/auth/freshToken', () => ({ getFreshAccessToken: vi.fn() }));
const authState = vi.hoisted(() => ({ status: 'signed_in' as string }));
vi.mock('../../src/auth/authStore', () => ({ useAuthStore: { getState: () => authState } }));

import { apiJson } from '../../src/api/apiClient';
import { getFreshAccessToken } from '../../src/auth/freshToken';
import { FRIENDLY_ERROR_COPY } from '../../src/api/errorKind';
import { ReportCardSheet } from '../../src/features/cardReport/ReportCardSheet';
import { CARD_REPORT_REASONS } from '../../src/features/cardReport/cardReportApi';
import { CHROME_MAX_FONT_SCALE } from '../../src/theme/dynamicType';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiJson).mockReset();
  vi.mocked(getFreshAccessToken).mockReset();
  vi.mocked(getFreshAccessToken).mockResolvedValue('tok-abc');
  authState.status = 'signed_in';
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

// Lets every in-flight submit (dynamic import + token + POST) run to completion.
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function hosts(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID);
}

function one(tree: renderer.ReactTestRenderer, testID: string) {
  const found = hosts(tree, testID);
  expect(found).toHaveLength(1);
  return found[0];
}

function textOf(node: renderer.ReactTestInstance): string {
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children ?? '');
}

async function renderSheet(onClose = vi.fn()) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<ReportCardSheet deckSlug="csharp" stableUid="cs-1" onClose={onClose} />);
  });
  await flush();
  return tree;
}

async function press(node: renderer.ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
  });
  await flush();
}

describe('ReportCardSheet', () => {
  it('renders a Modal with five plain-English reason chips and no pre-selection', async () => {
    const tree = await renderSheet();
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Modal')).toHaveLength(1);
    expect(CARD_REPORT_REASONS.map((r) => r.value)).toEqual(['wrong_answer', 'outdated', 'unclear', 'typo', 'other']);
    for (const reason of CARD_REPORT_REASONS) {
      const chip = one(tree, `report-reason-${reason.value}`);
      expect(chip.props.accessibilityRole).toBe('radio');
      expect(chip.props.accessibilityLabel).toBe(reason.label);
      expect(chip.props.accessibilityState.selected).toBe(false);
      expect(reason.label).not.toMatch(/_/);
    }
    const submit = one(tree, 'report-card-submit');
    expect(submit.props.disabled).toBe(true);
  });

  it('caps the note at 500 characters and shows a counter', async () => {
    const tree = await renderSheet();
    const input = one(tree, 'report-card-note');
    expect(input.props.maxLength).toBe(500);
    await act(async () => {
      input.props.onChangeText('x'.repeat(620));
    });
    expect(one(tree, 'report-card-note').props.value).toHaveLength(500);
    expect(textOf(one(tree, 'report-card-note-counter'))).toBe('500/500');
  });

  it('submits the selected reason and note, then shows the thank-you state', async () => {
    vi.mocked(apiJson).mockResolvedValue({ data: { reportId: 1, status: 'open', duplicate: false } });
    const tree = await renderSheet();
    await press(one(tree, 'report-reason-outdated'));
    expect(one(tree, 'report-reason-outdated').props.accessibilityState.selected).toBe(true);
    await act(async () => {
      one(tree, 'report-card-note').props.onChangeText('Uses the .NET 6 API');
    });
    await press(one(tree, 'report-card-submit'));

    expect(apiJson).toHaveBeenCalledTimes(1);
    const [path, opts] = vi.mocked(apiJson).mock.calls[0];
    expect(path).toBe('/api/v1/user/card-reports');
    expect(opts.method).toBe('POST');
    expect(opts.accessToken).toBe('tok-abc');
    expect(opts.body).toMatchObject({ deckSlug: 'csharp', stableUid: 'cs-1', reason: 'outdated', note: 'Uses the .NET 6 API' });
    expect(typeof opts.body.clientVersion).toBe('string');
    expect(textOf(one(tree, 'report-card-success'))).toBe('Thanks — the author will review it');
    expect(hosts(tree, 'report-card-form')).toHaveLength(0);
  });

  it('shows the duplicate message when the server returns duplicate:true', async () => {
    vi.mocked(apiJson).mockResolvedValue({ data: { reportId: 1, status: 'open', duplicate: true } });
    const tree = await renderSheet();
    await press(one(tree, 'report-reason-typo'));
    await press(one(tree, 'report-card-submit'));
    expect(textOf(one(tree, 'report-card-duplicate'))).toBe('You already reported this card');
    expect(hosts(tree, 'report-card-success')).toHaveLength(0);
  });

  it('keeps the form and shows the daily-limit copy on 429', async () => {
    const err: any = new Error('limit');
    err.status = 429;
    err.apiErrorCode = 'REPORT_DAILY_LIMIT';
    vi.mocked(apiJson).mockRejectedValue(err);
    const tree = await renderSheet();
    await press(one(tree, 'report-reason-unclear'));
    await press(one(tree, 'report-card-submit'));
    const error = one(tree, 'report-card-error');
    expect(textOf(error)).toBe("You have reached today's report limit");
    expect(error.props.accessibilityRole).toBe('alert');
    expect(hosts(tree, 'report-card-form')).toHaveLength(1);
  });

  it('shows friendly copy for 503 and offline failures', async () => {
    const unavailable: any = new Error('off');
    unavailable.status = 503;
    const offline: any = new Error('Network request failed');
    offline.kind = 'offline';
    vi.mocked(apiJson).mockRejectedValueOnce(unavailable).mockRejectedValueOnce(offline);
    const tree = await renderSheet();
    await press(one(tree, 'report-reason-other'));
    await press(one(tree, 'report-card-submit'));
    expect(textOf(one(tree, 'report-card-error'))).toBe('Reporting is unavailable right now');
    await press(one(tree, 'report-card-submit'));
    expect(textOf(one(tree, 'report-card-error'))).toBe(FRIENDLY_ERROR_COPY.offline);
  });

  it('sends one POST and ends on success when Submit is tapped twice in the same frame', async () => {
    let resolvePost!: (value: unknown) => void;
    vi.mocked(apiJson)
      .mockImplementationOnce(() => new Promise((resolve) => (resolvePost = resolve)))
      .mockResolvedValue({ data: { reportId: 1, status: 'open', duplicate: true } });
    const tree = await renderSheet();
    await press(one(tree, 'report-reason-typo'));
    const submit = one(tree, 'report-card-submit');
    await act(async () => {
      submit.props.onPress();
      submit.props.onPress();
    });
    await settle();
    await act(async () => {
      resolvePost({ data: { reportId: 1, status: 'open', duplicate: false } });
    });
    await settle();
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(textOf(one(tree, 'report-card-success'))).toBe('Thanks — the author will review it');
    expect(hosts(tree, 'report-card-duplicate')).toHaveLength(0);
  });

  it('shows offline copy with the form, not the sign-in message, when signed in but the token refresh failed', async () => {
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const tree = await renderSheet();
    expect(hosts(tree, 'report-card-signed-out')).toHaveLength(0);
    expect(hosts(tree, 'report-card-form')).toHaveLength(1);
    expect(textOf(one(tree, 'report-card-error'))).toBe(FRIENDLY_ERROR_COPY.offline);

    await press(one(tree, 'report-reason-typo'));
    await press(one(tree, 'report-card-submit'));
    expect(apiJson).not.toHaveBeenCalled();
    expect(hosts(tree, 'report-card-signed-out')).toHaveLength(0);
    expect(textOf(one(tree, 'report-card-error'))).toBe(FRIENDLY_ERROR_COPY.offline);

    vi.mocked(getFreshAccessToken).mockResolvedValue('tok-abc');
    vi.mocked(apiJson).mockResolvedValue({ data: { reportId: 2, status: 'open', duplicate: false } });
    await press(one(tree, 'report-card-submit'));
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(hosts(tree, 'report-card-success')).toHaveLength(1);
  });

  it('shows the sign-in message and no form when signed out', async () => {
    authState.status = 'anonymous';
    vi.mocked(getFreshAccessToken).mockResolvedValue(null);
    const onClose = vi.fn();
    const tree = await renderSheet(onClose);
    expect(textOf(one(tree, 'report-card-signed-out'))).toBe('Sign in to report a problem');
    expect(hosts(tree, 'report-card-form')).toHaveLength(0);
    expect(hosts(tree, 'report-card-submit')).toHaveLength(0);
    expect(hosts(tree, 'report-card-note')).toHaveLength(0);
    await press(one(tree, 'report-card-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('Cancel closes without submitting', async () => {
    const onClose = vi.fn();
    const tree = await renderSheet(onClose);
    await press(one(tree, 'report-reason-typo'));
    await press(one(tree, 'report-card-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('gives every control a role, label, 44pt target and capped chrome text', async () => {
    const tree = await renderSheet();
    const controls = tree.root.findAll((n) => (n.type as unknown) === 'Pressable');
    expect(controls.length).toBe(7);
    for (const control of controls) {
      expect(['button', 'radio']).toContain(control.props.accessibilityRole);
      expect(typeof control.props.accessibilityLabel).toBe('string');
      const style = [control.props.style].flat(3).filter(Boolean);
      const minHeight = Math.max(...style.map((s: any) => s.minHeight ?? 0));
      expect(minHeight).toBeGreaterThanOrEqual(44);
    }
    for (const id of ['report-card-submit', 'report-card-cancel']) {
      expect(typeof one(tree, id).props.accessibilityHint).toBe('string');
    }
    for (const text of tree.root.findAll((n) => (n.type as unknown) === 'Text')) {
      expect(text.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
    }
  });
});

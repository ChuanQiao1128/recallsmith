import React from 'react';
import * as RN from 'react-native';
import { Text } from 'react-native';
import type { StyleProp, TextProps, TextStyle } from 'react-native';

import { splitInlineCode, stripInlineCode } from '../../../content/inlineCode';

export const INLINE_CODE_TEST_ID = 'inline-code';

// Vitest supplies react-native without Platform / useColorScheme / StyleSheet.flatten —
// guarded lookup so suites that mock a minimal react-native keep rendering (MistakeBookScreen pattern).
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const useColorScheme: () => string | null | undefined = readRN('useColorScheme', () => 'light');
const platformOS: string = readRN<{ OS?: string } | null>('Platform', null)?.OS ?? 'ios';

// The monospace family CodeBlock uses.
export const INLINE_CODE_FONT = platformOS === 'ios' ? 'Menlo' : 'monospace';

// Code is set a touch smaller than the prose around it so the wider monospace
// glyphs sit level with the sentence.
const CODE_SCALE = 0.9;

const CODE_BACKGROUND = {
  light: 'rgba(67,42,18,0.08)',
  dark: 'rgba(255,255,255,0.14)',
} as const;

// Last fontSize set in a (possibly nested) style array — StyleSheet.flatten without
// relying on it, since test mocks of react-native leave it out.
function fontSizeOf(style: unknown): number | undefined {
  if (!style || typeof style !== 'object') return undefined;
  if (Array.isArray(style)) {
    let size: number | undefined;
    for (const entry of style) size = fontSizeOf(entry) ?? size;
    return size;
  }
  const size = (style as TextStyle).fontSize;
  return typeof size === 'number' ? size : undefined;
}

export function inlineCodeStyle(parent: StyleProp<TextStyle>, scheme: string | null | undefined): TextStyle {
  const parentSize = fontSizeOf(parent);
  return {
    fontFamily: INLINE_CODE_FONT,
    ...(typeof parentSize === 'number' ? { fontSize: Math.round(parentSize * CODE_SCALE * 10) / 10 } : null),
    fontWeight: 'normal',
    backgroundColor: scheme === 'dark' ? CODE_BACKGROUND.dark : CODE_BACKGROUND.light,
    // Nested <Text> stays in the parent's line box, so the span wraps with the
    // sentence; the padding and radius only show where the platform honours them.
    paddingHorizontal: 3,
    borderRadius: 4,
  };
}

/** The code-span style for prose in `parent` style, in the current colour scheme. */
export function useInlineCodeStyle(parent: StyleProp<TextStyle>, codeStyle?: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const scheme = useColorScheme();
  return [inlineCodeStyle(parent, scheme), codeStyle];
}

/**
 * The children for a <Text> holding `text`: the string itself when it has no
 * well-formed span (so plain text renders exactly as before), otherwise the
 * prose strings with each span as a nested monospace <Text> — no backticks.
 */
export function inlineCodeNodes(text: string | null | undefined, spanStyle: StyleProp<TextStyle>): React.ReactNode {
  const segments = typeof text === 'string' ? splitInlineCode(text) : [];
  if (!segments.some((segment) => segment.kind === 'code')) return text;
  return segments.map((segment, index) =>
    segment.kind === 'code' ? (
      <Text key={index} style={spanStyle} testID={INLINE_CODE_TEST_ID}>
        {segment.value}
      </Text>
    ) : (
      segment.value
    ),
  );
}

export type InlineCodeTextProps = Omit<TextProps, 'children'> & {
  /** Card text; null renders an empty <Text>, as `{null}` did. */
  text: string | null | undefined;
  /** Style for the code segments, merged over the monospace defaults. */
  codeStyle?: StyleProp<TextStyle>;
};

// Card text with markdown inline code spans (`List<int>`) rendered as nested
// <Text>: prose in the parent style, each span in monospace on a subtle
// background, no backticks. Text without a span renders exactly as a plain
// <Text>{text}</Text> would. The spoken label is the text without backticks,
// unless the caller passes its own.
export function InlineCodeText(props: InlineCodeTextProps) {
  const { text, codeStyle, ...rest } = props;
  const spanStyle = useInlineCodeStyle(rest.style, codeStyle);
  const nodes = inlineCodeNodes(text, spanStyle);

  if (nodes === text) return <Text {...rest}>{text}</Text>;
  return (
    <Text {...rest} accessibilityLabel={rest.accessibilityLabel ?? stripInlineCode(text as string)}>
      {nodes}
    </Text>
  );
}

export default InlineCodeText;

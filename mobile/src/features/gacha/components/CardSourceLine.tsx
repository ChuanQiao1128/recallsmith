import React, { useEffect, useState } from 'react';
import * as RN from 'react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { getFeatureFlags } from '../../../config/featureFlags';
import { openCardSourceUrl } from '../../../content/cardSourceLink';
import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

// U3 (user-perspective review 2026-10-04): the card's source on the review screens — the MCQ
// verdict (right or wrong) and the Q/A answer after reveal — as one compact line,
// "Source: docs.aws.amazon.com". Published sources carry a URL and a quote, no title, so the line
// names the host. The text comes from the installed deck file (cardSource.ts), so it shows offline;
// tapping hands the URL to the browser through openCardSourceUrl (http/https only). No source, the
// cardSource flag off, or a failed read: nothing renders. Callers key it by card.
export const CARD_SOURCE_LINE_COPY = {
  prefix: 'Source: ',
  hint: 'Opens the source in your browser',
} as const;

type LoadedSource = { url: string; host: string };

// Same lazy, guarded read as LearningStudyView and CardDetail: the reader reaches expo-file-system
// and aws-amplify, so it is imported only when a source is wanted.
async function loadSourceSafe(slug: string, uid: string): Promise<LoadedSource | null> {
  try {
    const mod = await import('../../../content/cardSource');
    const s = await mod?.getCardSource?.(slug, uid);
    if (!s) return null;
    const host = mod.sourceHostLabel(s.url);
    return host ? { url: s.url, host } : null;
  } catch {
    return null;
  }
}

export type CardSourceLineProps = { deckSlug: string; stableUid: string; testID?: string };

export function CardSourceLine({ deckSlug, stableUid, testID = 'card-source-line' }: CardSourceLineProps) {
  const [source, setSource] = useState<LoadedSource | null>(null);

  useEffect(() => {
    setSource(null);
    // Defensive read: other suites mock getFeatureFlags without the key.
    if (getFeatureFlags()?.cardSource?.enabled === false) return undefined;
    let cancelled = false;
    void loadSourceSafe(deckSlug, stableUid).then((loaded) => {
      if (!cancelled) setSource(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [deckSlug, stableUid]);

  if (!source) return null;
  const label = `${CARD_SOURCE_LINE_COPY.prefix}${source.host}`;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={CARD_SOURCE_LINE_COPY.hint}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      // Read Linking off the namespace at the tap: test suites mock react-native without it.
      onPress={() => openCardSourceUrl(source.url, (RN as any).Linking)}
    >
      <Text testID={`${testID}-text`} style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default CardSourceLine;

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-start',
    minHeight: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  text: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.inkSecondary,
    textDecorationLine: 'underline',
  },
  pressed: { opacity: 0.75 },
});

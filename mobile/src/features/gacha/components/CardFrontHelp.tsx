import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseFrontHelp } from '../../../content/frontHelp';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { cardTextA11yProps, useCardTextLang } from './CardTextLang';

/** Question-side vocabulary only; opening help never flips or grades the card. */
export function CardFrontHelp({ help }: { help: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const lang = useCardTextLang();
  const entries = parseFrontHelp(help);
  if (!entries?.length) return null;
  const label = lang === 'zh-CN' ? '\u8bcd\u8bed\u5e2e\u52a9' : 'Word help';
  const action = lang === 'zh-CN'
    ? `${expanded ? '\u6536\u8d77' : '\u5c55\u5f00'}${label}`
    : `${expanded ? 'Hide' : 'Show'} ${label.toLowerCase()}`;
  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityLabel={action} accessibilityState={{ expanded }}
        {...cardTextA11yProps(lang)} onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
        <Text style={styles.label} {...cardTextA11yProps(lang)}>{label}</Text>
      </Pressable>
      {expanded ? entries.map(({ term, definition }) => (
        <View key={term} style={styles.entry}>
          <Text style={styles.term} {...cardTextA11yProps(lang)}>{term}</Text>
          <Text style={styles.definition} {...cardTextA11yProps(lang)}>{definition}</Text>
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.xs, alignSelf: 'stretch' },
  toggle: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  label: { fontSize: typography.body, fontWeight: '600', color: colors.inkSecondary, flexShrink: 1 },
  entry: { marginBottom: spacing.sm },
  term: { fontSize: typography.body, lineHeight: 22, fontWeight: '600', color: colors.ink },
  definition: { fontSize: typography.body, lineHeight: 22, color: colors.inkSecondary },
});

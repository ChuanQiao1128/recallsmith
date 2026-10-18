import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardDisplayLang } from '../../../../content/localizeCard';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

// Settings › Study: the remembered card language (cardLangPrefs), the same choice the study
// screen's EN | 中文 toggle makes. Two choices, one selected.
export const CARD_LANG_ROW_COPY = {
  label: 'Card language',
  body: 'Applies to decks that include a Chinese translation. Your progress is the same in both.',
  en: 'English',
  zh: '中文',
} as const;

const CHOICES: ReadonlyArray<{ value: CardDisplayLang; label: string; testID: string; a11yLabel: string }> = [
  { value: 'en', label: CARD_LANG_ROW_COPY.en, testID: 'settings-card-lang-en', a11yLabel: 'English' },
  { value: 'zh-CN', label: CARD_LANG_ROW_COPY.zh, testID: 'settings-card-lang-zh', a11yLabel: 'Chinese' },
];

export function CardLangRow(props: { value: CardDisplayLang; onSelect: (next: CardDisplayLang) => void }) {
  const { value, onSelect } = props;
  return (
    <View style={styles.row} testID="settings-card-lang-row">
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {CARD_LANG_ROW_COPY.label}
        </Text>
        <Text style={styles.rowBody}>{CARD_LANG_ROW_COPY.body}</Text>
      </View>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={CARD_LANG_ROW_COPY.label}>
        {CHOICES.map((choice) => {
          const selected = value === choice.value;
          return (
            <Pressable
              key={choice.value}
              testID={choice.testID}
              accessibilityRole="radio"
              accessibilityLabel={choice.a11yLabel}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (!selected) onSelect(choice.value);
              }}
              style={({ pressed }) => [styles.choice, selected ? styles.choiceOn : styles.choiceOff, pressed && styles.pressed]}
            >
              <Text style={[styles.choiceText, selected ? styles.choiceTextOn : styles.choiceTextOff]} numberOfLines={1}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default CardLangRow;

const styles = StyleSheet.create({
  row: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  rowText: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.ink,
  },
  rowBody: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  choices: {
    flexDirection: 'row',
    gap: 6,
  },
  choice: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  choiceOn: {
    backgroundColor: colors.pokeBlue,
    borderColor: colors.pokeBlue,
  },
  choiceOff: {
    backgroundColor: 'rgba(42,34,24,0.06)',
    borderColor: colors.hairline,
  },
  choiceText: {
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  choiceTextOn: {
    color: '#FFFFFF',
  },
  choiceTextOff: {
    color: colors.inkSecondary,
  },
  pressed: {
    opacity: 0.85,
  },
});

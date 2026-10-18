import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardDisplayLang } from '../../../content/localizeCard';
import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../../../theme/dynamicType';
import { typography } from '../../../theme/typography';

// Card translations contract §5: the one-tap switch between a card's English text and its
// built-in Chinese translation, "EN | 中文", with the language on screen highlighted. Callers
// render it only for a card that has a complete translation; the tap flips the device-wide card
// language (cardLangPrefs), which is remembered. It is a display switch only — the card's
// progress, grading and option order never depend on it.
export const CARD_LANG_TOGGLE_COPY = {
  en: 'EN',
  zh: '中文',
  a11yLabel: 'Show card in Chinese',
  a11yHint: 'Switches the card text between English and Chinese. Your progress is not affected.',
} as const;

export const CARD_LANG_TOGGLE_TEST_ID = 'card-lang-toggle';

export type CardLangToggleProps = {
  lang: CardDisplayLang;
  onChange: (next: CardDisplayLang) => void;
  testID?: string;
};

export function CardLangToggle({ lang, onChange, testID = CARD_LANG_TOGGLE_TEST_ID }: CardLangToggleProps) {
  const zh = lang === 'zh-CN';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={CARD_LANG_TOGGLE_COPY.a11yLabel}
      accessibilityHint={CARD_LANG_TOGGLE_COPY.a11yHint}
      accessibilityState={{ checked: zh }}
      hitSlop={6}
      onPress={() => onChange(zh ? 'en' : 'zh-CN')}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <View style={[styles.segment, !zh && styles.segmentOn]}>
        <Text
          testID={`${testID}-en`}
          style={[styles.segmentText, !zh && styles.segmentTextOn]}
          numberOfLines={1}
          maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
        >
          {CARD_LANG_TOGGLE_COPY.en}
        </Text>
      </View>
      <View style={[styles.segment, zh && styles.segmentOn]}>
        <Text
          testID={`${testID}-zh`}
          style={[styles.segmentText, zh && styles.segmentTextOn]}
          numberOfLines={1}
          maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
        >
          {CARD_LANG_TOGGLE_COPY.zh}
        </Text>
      </View>
    </Pressable>
  );
}

export default CardLangToggle;

const styles = StyleSheet.create({
  pill: {
    minHeight: a11y.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 999,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  segment: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: {
    backgroundColor: colors.inkSoft,
  },
  segmentText: {
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.inkSecondary,
    letterSpacing: 0.3,
  },
  segmentTextOn: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.85,
  },
});

import React, { useContext } from 'react';

// Card translations contract §5: the language of the card text on screen, for the parts of the
// card that do not get it from their props — the in-card labels (EXPLANATION → 解析, …) and the
// accessibility language of every card text node. The study screen and Card Detail provide
// 'zh-CN' around a card shown in Chinese; everywhere else it is undefined and every label and
// text node renders exactly as it did before translations existed. The outer app chrome (header,
// dock buttons, banners) never reads it and stays English.

export type CardTextLang = 'zh-CN' | undefined;

export const CardTextLangContext = React.createContext<CardTextLang>(undefined);

export function useCardTextLang(): CardTextLang {
  return useContext(CardTextLangContext);
}

/** `{ accessibilityLanguage: 'zh-CN' }` for Chinese card text, `{}` otherwise (no prop at all). */
export function cardTextA11yProps(lang: CardTextLang): { accessibilityLanguage?: string } {
  return lang ? { accessibilityLanguage: lang } : {};
}

/** The labels inside a card that follow the card's language. English values are today's copy. */
export const CARD_SECTION_LABELS = Object.freeze({
  en: Object.freeze({
    question: 'QUESTION',
    explanation: 'EXPLANATION',
    code: 'CODING SAMPLE',
    usage: 'REAL USAGE',
    correctAnswer: 'CORRECT ANSWER',
    source: 'SOURCE',
  }),
  'zh-CN': Object.freeze({
    question: '题目',
    explanation: '解析',
    code: '代码示例',
    usage: '实际应用',
    correctAnswer: '正确答案',
    source: '来源',
  }),
});

export function cardSectionLabels(lang: CardTextLang) {
  return lang === 'zh-CN' ? CARD_SECTION_LABELS['zh-CN'] : CARD_SECTION_LABELS.en;
}

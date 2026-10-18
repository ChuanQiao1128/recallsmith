// Device-global card language (card translations contract §5): which language a card that ships a
// built-in translation is shown in. 'en' (the default) or 'zh-CN'. Remembered: the study toggle
// and the Settings row both write it, and every translated card follows it. Decks without a
// translation ignore it and stay in English. It is a display choice only: progress belongs to the
// card, never to the language.
//
// Same shape as feedbackPrefs.ts / studyPrefs.ts: an in-memory value read synchronously on the hot
// path, refreshed by loadCardLangPref() (App.tsx at boot, Settings on focus). Screens subscribe
// with useCardLangPref(). Every storage error is fail-closed onto the current in-memory value.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CardDisplayLang } from '../../../content/localizeCard';

export const CARD_LANG_KEY = 'recallsmith:card-lang:v1';
export const DEFAULT_CARD_LANG: CardDisplayLang = 'en';

// The one in-memory copy. loadCardLangPref() and setCardLangPref() are the only writers.
let current: CardDisplayLang = DEFAULT_CARD_LANG;
// Bumped by every set: a load that started before the learner's tap must not undo it.
let writes = 0;
const listeners = new Set<() => void>();

function publish(next: CardDisplayLang): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // a listener's failure never blocks the others
    }
  }
}

function parse(raw: string | null): CardDisplayLang {
  return raw === 'zh-CN' ? 'zh-CN' : DEFAULT_CARD_LANG;
}

/** The in-memory value ('en' until loadCardLangPref() has run). */
export function getCardLangSync(): CardDisplayLang {
  return current;
}

/** Reads CARD_LANG_KEY; anything other than 'zh-CN' reads as 'en'. A storage error keeps the in-memory value. */
export async function loadCardLangPref(): Promise<CardDisplayLang> {
  const writesBefore = writes;
  try {
    const raw = await AsyncStorage.getItem(CARD_LANG_KEY);
    if (writes === writesBefore) publish(parse(raw));
  } catch {
    // Storage error: keep whatever is already in memory.
  }
  return current;
}

/**
 * Updates the in-memory value first (subscribers re-render at once), then persists it. A storage
 * error is swallowed — the in-memory value still holds for this launch.
 */
export async function setCardLangPref(next: CardDisplayLang): Promise<CardDisplayLang> {
  writes += 1;
  publish(next === 'zh-CN' ? 'zh-CN' : DEFAULT_CARD_LANG);
  const saved = current;
  try {
    await AsyncStorage.setItem(CARD_LANG_KEY, saved);
  } catch {
    // Swallowed: the in-memory value stays authoritative for this launch.
  }
  return saved;
}

export function subscribeCardLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current card language, re-rendering on every change. */
export function useCardLangPref(): CardDisplayLang {
  return useSyncExternalStore(subscribeCardLang, getCardLangSync, getCardLangSync);
}

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CardProgress } from '../../../review/model';
import { getStudyGoal } from '../../goal/studyGoal';
import { normalizeMcq } from '../mcq/normalizeMcq';
import { getOnboardingStage } from '../onboarding/onboardingPrefs';
import { isLearnedProgress } from '../selectors/progressSelectors';

/**
 * R22 §1.2 / §4: a new learner learns before drawing. The starter lesson is an ordinary session of the
 * first STARTER_LESSON_SIZE non-MCQ cards of the goal deck, in deck order. Those cards are studiable
 * without being owned: resolveEffectiveOwned unions them into the owned gate while the lesson is open
 * (onboarding stage 'starter'), and they are never written into drawState.owned -- that would make the
 * pack look drawn and stop ensureDeckBootstrap, which is the first-pack reward for finishing.
 *
 * This module only reads and records lesson state; it imports nothing from the wallet, so the wallet
 * (deckWallet) and the owned gate (effectiveOwned) can both ask it whether the lesson is open.
 * Finishing the lesson lives in starterLesson.ts.
 */
export const STARTER_LESSON_SIZE = 5;

// Global like the onboarding stage it belongs to: the lesson is a first run of this install.
export const STARTER_LESSON_KEY = 'recallsmith:starter-lesson:v1';

export type StarterLesson = {
  slug: string;
  /** The lesson's cards, in deck order. */
  uids: string[];
};

type StarterCardLike = { StableUid: string; OrderInDeck: number; Mcq?: unknown };
type StarterDeckLike = { Slug: string; Cards?: ReadonlyArray<StarterCardLike> | null };

/** The first `size` cards in deck order, MCQ cards excluded (the lesson teaches; MCQ comes later). */
export function pickStarterUids(cards: ReadonlyArray<StarterCardLike>, size = STARTER_LESSON_SIZE): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Ties keep array order (Array.prototype.sort is stable), the same rule cardRank uses.
  for (const card of [...cards].sort((a, b) => a.OrderInDeck - b.OrderInDeck)) {
    if (out.length >= size) break;
    const uid = typeof card?.StableUid === 'string' ? card.StableUid : '';
    if (!uid || seen.has(uid)) continue;
    if (normalizeMcq(card.Mcq) !== null) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

function parseLesson(raw: string | null): StarterLesson | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StarterLesson> | null;
    if (!parsed || typeof parsed.slug !== 'string' || !parsed.slug || !Array.isArray(parsed.uids)) return null;
    const uids = parsed.uids.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0);
    return { slug: parsed.slug, uids };
  } catch {
    return null;
  }
}

/** True only while onboarding is in the 'starter' stage. Existing users (stage 'done') never are. */
export async function isStarterLessonOpen(): Promise<boolean> {
  try {
    return (await getOnboardingStage()) === 'starter';
  } catch {
    return false;
  }
}

/** The open lesson, or null when the lesson is closed or has not picked its cards yet. Never throws. */
export async function loadStarterLesson(): Promise<StarterLesson | null> {
  if (!(await isStarterLessonOpen())) return null;
  try {
    return parseLesson(await AsyncStorage.getItem(STARTER_LESSON_KEY));
  } catch {
    return null;
  }
}

/** The deck the lesson teaches: the study goal's deck, else the caller's fallback (the active deck). */
export async function resolveStarterSlug(fallback: string | null): Promise<string | null> {
  const goal = await getStudyGoal();
  return goal?.deckSlug ?? fallback;
}

/**
 * Records the lesson's cards from the deck in hand, once. Returns the lesson (existing or new), or null
 * when the lesson is closed or `deck` is not the lesson's deck. The first pick is kept even if the deck
 * updates later, so the lesson a learner started is the lesson they finish. Never throws.
 */
export async function ensureStarterLesson(deck: StarterDeckLike): Promise<StarterLesson | null> {
  if (!(await isStarterLessonOpen())) return null;
  try {
    const existing = parseLesson(await AsyncStorage.getItem(STARTER_LESSON_KEY));
    if (existing) return existing.slug === deck.Slug ? existing : null;
    const slug = await resolveStarterSlug(deck.Slug);
    if (slug !== deck.Slug) return null;
    const lesson: StarterLesson = { slug, uids: pickStarterUids(deck.Cards ?? []) };
    await AsyncStorage.setItem(STARTER_LESSON_KEY, JSON.stringify(lesson));
    return lesson;
  } catch {
    return null;
  }
}

/** The lesson's cards for `slug` while the lesson is open; empty otherwise. What the owned gate unions. */
export async function loadStarterUids(slug: string): Promise<Set<string>> {
  const lesson = await loadStarterLesson();
  return lesson && lesson.slug === slug ? new Set(lesson.uids) : new Set();
}

/** True when `stableUid` is a card of the open lesson for `slug` (pays no R1 pull). */
export async function isStarterLessonCard(slug: string, stableUid: string): Promise<boolean> {
  return (await loadStarterUids(slug)).has(stableUid);
}

/**
 * The lesson is complete once every one of its cards that the deck still holds has been studied
 * (isLearnedProgress -- the same predicate the Library and the gate use). A card the deck no longer
 * holds (no progress entry) cannot block the lesson forever. Pass the deck's full progress.
 */
export function isStarterLessonComplete(lesson: StarterLesson, progress: readonly CardProgress[]): boolean {
  const byUid = new Map(progress.map((entry) => [entry?.stableUid, entry]));
  return lesson.uids.every((uid) => {
    const entry = byUid.get(uid);
    return !entry || isLearnedProgress(entry);
  });
}

/** Drops the recorded lesson (the stage is what closes it; this just stops the record lingering). */
export async function clearStarterLesson(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STARTER_LESSON_KEY);
  } catch {
    // best effort: a closed stage already hides the record from every reader
  }
}

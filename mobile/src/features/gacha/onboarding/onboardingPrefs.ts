import AsyncStorage from '@react-native-async-storage/async-storage';

// R22 §4: 'starter' sits between the goal step and 'done' -- the learner studies the 5-card starter
// lesson before the first pack. Existing installs already at 'done' never see it.
export type OnboardingStage = 'welcome' | 'audience' | 'starter' | 'done';

const ONBOARDING_STAGE_KEY = 'recallsmith:onboarding:stage:v1';

export async function getOnboardingStage(): Promise<OnboardingStage> {
  try {
    const raw = (await AsyncStorage.getItem(ONBOARDING_STAGE_KEY))?.trim().toLowerCase();
    if (raw === 'audience' || raw === 'starter' || raw === 'done') return raw;
    return 'welcome';
  } catch {
    return 'welcome';
  }
}

export async function setOnboardingStage(stage: OnboardingStage): Promise<OnboardingStage> {
  await AsyncStorage.setItem(ONBOARDING_STAGE_KEY, stage);
  return stage;
}

export async function completeWelcome(): Promise<OnboardingStage> {
  return setOnboardingStage('audience');
}

/** The goal step is done: the starter lesson opens (Home routes into it). */
export async function startStarterLesson(): Promise<OnboardingStage> {
  return setOnboardingStage('starter');
}

/** The starter lesson is done (starterLesson.completeStarterLesson), or onboarding is skipped outright. */
export async function completeOnboarding(): Promise<OnboardingStage> {
  return setOnboardingStage('done');
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_STAGE_KEY);
}

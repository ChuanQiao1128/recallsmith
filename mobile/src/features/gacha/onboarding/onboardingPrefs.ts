import AsyncStorage from '@react-native-async-storage/async-storage';

export type OnboardingStage = 'welcome' | 'audience' | 'done';

const ONBOARDING_STAGE_KEY = 'recallsmith:onboarding:stage:v1';

export async function getOnboardingStage(): Promise<OnboardingStage> {
  try {
    const raw = (await AsyncStorage.getItem(ONBOARDING_STAGE_KEY))?.trim().toLowerCase();
    if (raw === 'audience' || raw === 'done') return raw;
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

export async function completeOnboarding(): Promise<OnboardingStage> {
  return setOnboardingStage('done');
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_STAGE_KEY);
}

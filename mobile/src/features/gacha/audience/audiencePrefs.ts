import AsyncStorage from '@react-native-async-storage/async-storage';

export type AudiencePreference = 'junior' | 'both' | 'all';

const AUDIENCE_PREF_KEY = 'recallsmith:audience-preference:v1';

export async function getAudiencePreference(): Promise<AudiencePreference> {
  try {
    const raw = (await AsyncStorage.getItem(AUDIENCE_PREF_KEY))?.trim().toLowerCase();
    if (raw === 'junior' || raw === 'both' || raw === 'all') return raw;
    return 'both';
  } catch {
    return 'both';
  }
}

export async function setAudiencePreference(next: AudiencePreference): Promise<AudiencePreference> {
  await AsyncStorage.setItem(AUDIENCE_PREF_KEY, next);
  return next;
}

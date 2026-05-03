import {
  getAudiencePreference,
  setAudiencePreference,
  type AudiencePreference,
} from '../../audience/audiencePrefs';

export async function loadAudiencePreference(): Promise<AudiencePreference> {
  return getAudiencePreference();
}

export async function saveAudiencePreference(next: AudiencePreference): Promise<AudiencePreference> {
  return setAudiencePreference(next);
}

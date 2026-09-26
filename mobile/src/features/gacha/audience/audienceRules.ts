import type { AudiencePreference } from './audiencePrefs';

export type AudienceCandidateRow = {
  difficulty: number;
};

// One vocabulary for the audience preference, shared by the survey, the
// Settings chips and Profile. These three words are the single label source.
export const AUDIENCE_LABELS: Readonly<Record<AudiencePreference, string>> = {
  junior: 'Junior',
  both: 'Balanced',
  all: 'Stretch',
};

export function getAudiencePreferenceLabel(pref: AudiencePreference): string {
  return AUDIENCE_LABELS[pref] ?? AUDIENCE_LABELS.both;
}

function matchesPreference(pref: AudiencePreference, difficulty: number): boolean {
  if (pref === 'junior') return difficulty <= 2;
  if (pref === 'all') return difficulty >= 2;
  return true;
}

export function filterAudienceCandidateRows<T extends AudienceCandidateRow>(rows: T[], pref: AudiencePreference): T[] {
  const filtered = rows.filter((row) => matchesPreference(pref, Number(row.difficulty) || 0));
  return filtered.length > 0 ? filtered : rows;
}

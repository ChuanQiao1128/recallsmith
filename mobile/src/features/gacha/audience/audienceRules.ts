import type { AudiencePreference } from './audiencePrefs';

export type AudienceCandidateRow = {
  difficulty: number;
};

export function getAudiencePreferenceLabel(pref: AudiencePreference): string {
  if (pref === 'junior') return 'Junior';
  if (pref === 'all') return 'Stretch';
  return 'Balanced';
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

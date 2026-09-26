// mobile/src/auth/passwordPolicy.ts
//
// The password rules the Cognito pool enforces (infra/modules/identity
// /cognito.tf:114-121: min length 8, plus lower, upper, number and symbol).
// Mirroring them here lets sign-up / reset show a live checklist and block
// submit before Amplify round-trips an InvalidPasswordException. Pure module.

export type PasswordRuleId = 'length' | 'upper' | 'lower' | 'number' | 'symbol';

export const PASSWORD_RULES: ReadonlyArray<{
  id: PasswordRuleId;
  label: string;
  test: (pw: string) => boolean;
}> = [
  { id: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { id: 'upper', label: 'An uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'A lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'number', label: 'A number', test: (pw) => /[0-9]/.test(pw) },
  { id: 'symbol', label: 'A symbol', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function evaluatePassword(
  pw: string,
): Array<{ id: PasswordRuleId; label: string; ok: boolean }> {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, ok: rule.test(pw) }));
}

export function isPasswordValid(pw: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(pw));
}

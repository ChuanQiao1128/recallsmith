// src/auth/authConfig.ts
export type AuthConfig = {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  scopes: string[];
};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function parseScopes(raw: string | undefined): string[] {
  const src = (raw ?? '').trim();
  if (!src) return ['openid', 'email', 'profile'];
  return src.split(/[\s,]+/g).map(s => s.trim()).filter(Boolean);
}

export const AUTH_CONFIG: AuthConfig = {
  domain: normalizeUrl(import.meta.env.VITE_COGNITO_DOMAIN ?? ''),
  clientId: (import.meta.env.VITE_COGNITO_CLIENT_ID ?? '').trim(),
  redirectUri: (import.meta.env.VITE_COGNITO_REDIRECT_URI ?? '').trim(),
  logoutUri: (import.meta.env.VITE_COGNITO_LOGOUT_URI ?? '').trim(),
  scopes: parseScopes(import.meta.env.VITE_COGNITO_SCOPES),
};

/** Legacy name for AUTH_CONFIG, kept for callers that still use it. */
export const cognitoConfig = AUTH_CONFIG;

export const AUTH_CONFIGURED =
  AUTH_CONFIG.domain.length > 0 &&
  AUTH_CONFIG.clientId.length > 0 &&
  AUTH_CONFIG.redirectUri.length > 0;

export function assertAuthConfig(): void {
  if (!AUTH_CONFIGURED) {
    throw new Error(
      'Cognito auth is not configured. Please set VITE_COGNITO_DOMAIN / CLIENT_ID / REDIRECT_URI.',
    );
  }
}
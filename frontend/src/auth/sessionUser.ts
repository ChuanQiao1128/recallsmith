import { getTokens } from './tokenStore';

export type SessionUser = {
  /**
   * The Cognito subject: the one claim that identifies the account rather than
   * describing it. Read for cache scoping in src/lib/sessionCache.ts, where an
   * email would have been the wrong choice -- it is mutable and it is not
   * guaranteed to be present, so two accounts can share the absence of one.
   */
  sub?: string;
  email?: string;
  username?: string;
  groups: string[];
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const b64url = parts[1];
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');

    const json = atob(b64);
    const parsed = JSON.parse(json);

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractGroups(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload['cognito:groups'] ?? payload['groups'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export function readSessionUser(): SessionUser | null {
  const tokens = getTokens();
  if (!tokens) return null;

  const idPayload = decodeJwtPayload(tokens.idToken);
  const accessPayload = decodeJwtPayload(tokens.accessToken);

  // groups: read the idToken first, fall back to the accessToken.
  const groupsFromId = extractGroups(idPayload);
  const groups = groupsFromId.length > 0 ? groupsFromId : extractGroups(accessPayload);

  const email =
    typeof idPayload?.email === 'string'
      ? idPayload.email
      : typeof accessPayload?.email === 'string'
        ? accessPayload.email
        : undefined;

  const usernameClaim =
    (idPayload?.['cognito:username'] ??
      idPayload?.username ??
      accessPayload?.['cognito:username'] ??
      accessPayload?.username) as unknown;

  const username = typeof usernameClaim === 'string' ? usernameClaim : undefined;

  // idToken first for the same reason as the rest: it is the token that carries
  // identity claims. A token with no `sub` at all leaves this undefined, and
  // every caller has to have an answer for that -- sessionCache's is to hold
  // nothing rather than to invent a shared bucket.
  const subClaim = idPayload?.sub ?? accessPayload?.sub;
  const sub = typeof subClaim === 'string' ? subClaim : undefined;

  return { sub, email, username, groups };
}

export function isSuperAdmin(user: SessionUser | null | undefined): boolean {
  return (user?.groups ?? []).includes('super_admin');
}
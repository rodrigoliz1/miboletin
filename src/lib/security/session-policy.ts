export const TRANSIENT_SESSION_SECONDS = 60 * 60 * 8;
export const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPolicy {
  tokenLifetimeSeconds: number;
  cookieMaxAge?: number;
}

/**
 * A regular login uses a browser-session cookie. "Mantener sesión abierta"
 * opts the device into a persistent, encrypted cookie with a bounded lifetime.
 */
export function sessionPolicy(remember: boolean): SessionPolicy {
  const tokenLifetimeSeconds = remember ? REMEMBERED_SESSION_SECONDS : TRANSIENT_SESSION_SECONDS;
  return {
    tokenLifetimeSeconds,
    ...(remember ? { cookieMaxAge: tokenLifetimeSeconds } : {}),
  };
}

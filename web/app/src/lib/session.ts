/**
 * An Access session is not the app's session.
 *
 * Cloudflare Access answers a *navigation* with a 302 to its login page, but it answers a
 * `fetch()` with a bare `401 {"error":"invalid_token"}`. An installed app whose shell comes from the
 * service worker therefore sits fully painted while every call is refused, and it has no navigation
 * left to trigger the login redirect — the app cannot recover on its own, no matter how long the
 * person waits.
 *
 * This module is the one place that recognises that answer, and `REAUTH_PATH` is the one path the
 * worker is told to keep its hands off (`navigateFallbackDenylist` in vite.config.ts): a real
 * navigation to it reaches the edge, Access redirects to its login, the cookie is set, and the
 * returned page reloads the app with a live session.
 */
export const REAUTH_PATH = "/reauth";

let expired = false;
const listeners = new Set<() => void>();

/** Called once per page load by `api.request` when Access refuses a call. */
export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of listeners) listener();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSessionExpired(): boolean {
  return expired;
}

/** Test seam only: module state must not leak between cases. */
export function resetSession(): void {
  expired = false;
}

/** The only recovery. A `fetch` cannot show a login page; a navigation can. */
export function reauthenticate(path: string = REAUTH_PATH): void {
  window.location.assign(path);
}

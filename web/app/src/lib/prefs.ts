/**
 * Small preferences the person sets once and expects to find again. They live here, not in a
 * component, so the composer and the paste page cannot disagree about them.
 */
export const WRAP_KEY = "mpaste:wrap";

/**
 * Wrap is one preference: stored wins, and the first visit follows the phone/desktop line the
 * composer already drew (a phone wraps, a wide screen numbers its lines).
 */
export function parseWrap(raw: string | null, narrow: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return narrow;
}

/** OS-specific keycaps. Chromium still ships navigator.platform; the UA check covers iPadOS. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || "") || /Mac OS X/.test(navigator.userAgent);
}

export const modKey = () => (isMac() ? "⌘" : "Ctrl");
export const enterKey = () => (isMac() ? "⏎" : "Enter");

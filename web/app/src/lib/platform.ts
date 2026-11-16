/** OS-specific keycaps. Chromium still ships navigator.platform; the UA check covers iPadOS. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x/i.test(navigator.userAgent);
}

export const modKey = () => (isMac() ? "⌘" : "Ctrl");
export const enterKey = () => (isMac() ? "⏎" : "Enter");

import { useCallback, useState } from "react";

import { parseWrap, WRAP_KEY } from "@/lib/prefs";

/**
 * One wrap preference for the whole app: the editor writes it, the read-only view honours it, and a
 * reload keeps it. This is why the paste page used to be the one place that never wrapped — the
 * toggle lived in the composer's own `useState`.
 */
export function useWrap(): [boolean, (next: boolean) => void] {
  const [wrap, setWrap] = useState(() => {
    try {
      return parseWrap(
        localStorage.getItem(WRAP_KEY),
        window.matchMedia("(max-width: 720px)").matches,
      );
    } catch {
      return false;
    }
  });

  const set = useCallback((next: boolean) => {
    setWrap(next);
    try {
      localStorage.setItem(WRAP_KEY, next ? "1" : "0");
    } catch {
      /* private mode: the preference lasts as long as the tab */
    }
  }, []);

  return [wrap, set];
}

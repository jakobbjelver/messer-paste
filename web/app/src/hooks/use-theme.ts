import { useCallback, useEffect, useState } from "react";

const KEY = "messer-theme";

function current(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** The family theme key: `.dark` on <html>, persisted in localStorage, prepainted in index.html. */
export function useTheme() {
  const [dark, setDark] = useState(current);

  useEffect(() => {
    setDark(current());
  }, []);

  const toggle = useCallback(() => {
    setDark((was) => {
      const next = !was;
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.style.colorScheme = next ? "dark" : "light";
      try {
        localStorage.setItem(KEY, next ? "dark" : "light");
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }, []);

  return { dark, toggle };
}

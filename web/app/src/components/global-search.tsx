import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { modKey } from "@/lib/platform";

/**
 * The one search field. In the top bar it is a fixed-width input with the shortcut badge; on a phone
 * the same field renders full width under the header, with no badge and autofocus, because there is
 * no keyboard to advertise and no room for it beside the brand.
 *
 * Typing writes ?q= on /recent, so a search is a URL a person can keep. ⌘K/Ctrl+K focuses the bar
 * from any page, which is also what stops the browser's own find-this-page.
 */
export function GlobalSearch({
  variant = "bar",
  onDone,
}: {
  variant?: "bar" | "inline";
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = useRouterState({ select: (s) => (s.location.search as { q?: string }).q ?? "" });
  const [value, setValue] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const inline = variant === "inline";

  useEffect(() => setValue(current), [current]);

  useEffect(() => {
    if (inline) {
      input.current?.focus();
      input.current?.select();
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inline]);

  useEffect(() => {
    if (pathname === "/recent") return;
    setValue("");
  }, [pathname]);

  const apply = (next: string) => {
    setValue(next);
    void navigate({ to: "/recent", search: next ? { q: next } : {} });
  };

  return (
    <label
      className={`relative flex h-8 items-center ${
        inline ? "w-full" : "hidden sm:flex"
      }`}
    >
      <MagnifyingGlass
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-2 text-[var(--text-3)]"
      />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => apply(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.blur();
            if (value) apply("");
            onDone?.();
          }
          if (event.key === "Enter") onDone?.();
        }}
        placeholder="Search pastes"
        aria-label="Search pastes"
        className={`h-8 border bg-[var(--surface)] pl-7 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-search-cancel-button]:hidden ${
          inline ? "w-full pr-2" : "w-[220px] pr-14"
        } ${focused ? "border-[var(--border-strong)]" : "border-[var(--border)]"}`}
      />
      {value || inline ? null : (
        <kbd className="m-kbd pointer-events-none absolute right-2" aria-hidden="true">
          {modKey()}K
        </kbd>
      )}
    </label>
  );
}

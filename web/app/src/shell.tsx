import { useState, type ComponentType } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { GearSix, MagnifyingGlass, X } from "@phosphor-icons/react";

import { useTrailRecorder } from "@/components/back";

import { AppShell, type NavItem } from "@/components/ui/app-shell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GlobalSearch } from "@/components/global-search";
import { Mark } from "@/components/mark";
import { SessionExpired } from "@/components/session-expired";
import { LiveContext, useLiveEvents } from "@/hooks/use-live-events";
import { useTheme } from "@/hooks/use-theme";
import { useConfig, useIsPublicHost } from "@/hooks/use-config";
import { BUILD_SHA, CANON_VERSION } from "@/lib/version";
import { Toaster } from "@/components/ui/sonner";
import { TouchProvider } from "@/components/ui/hybrid-tooltip";

type LinkProps = {
  href: string;
  className?: string;
  children: React.ReactNode;
  target?: string;
  rel?: string;
  "aria-current"?: "page";
};

const RouterLink = ({ href, children, ...rest }: LinkProps) => (
  <Link to={href as never} {...rest}>
    {children}
  </Link>
);

const linkComponent = RouterLink as unknown as ComponentType<LinkProps>;

const NAV: NavItem[] = [
  { href: "/", label: "New" },
  { href: "/recent", label: "Recent" },
];

export function Shell() {
  const { dark, toggle } = useTheme();
  const config = useConfig();
  const isPublic = useIsPublicHost();
  // No stream on the public host, and nothing is opened before the host question is answered.
  const live = useLiveEvents(!config.isPending && !isPublic);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  useTrailRecorder();
  // The public host serves the same bundle but not the app: only a paste URL has anything to show.
  const publicReady = isPublic && /^\/[2-9A-HJKMNP-Z]{8}$/i.test(pathname);
  const showSearch = pathname !== "/ui" && !isPublic;

  return (
    <TouchProvider>
      <LiveContext.Provider value={live}>
        <AppShell
          variant="topbar"
          container="default"
          brand={{ name: "Messer Paste", mark: <Mark />, href: "/" }}
          nav={isPublic ? [] : NAV}
          active={pathname}
          linkComponent={linkComponent}
          actions={
            <>
              {showSearch ? (
                <>
                  <GlobalSearch />
                  <button
                    type="button"
                    aria-label="Search pastes"
                    aria-expanded={searchOpen}
                    onClick={() => setSearchOpen((was) => !was)}
                    className="grid size-8 cursor-pointer place-items-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] sm:hidden"
                  >
                    <MagnifyingGlass size={16} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {isPublic ? null : (
                <Link
                  to="/settings"
                  aria-label="Settings"
                  aria-current={pathname === "/settings" ? "page" : undefined}
                  className={`grid size-8 place-items-center ${
                    pathname === "/settings"
                      ? "text-[var(--foreground)]"
                      : "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <GearSix size={16} aria-hidden="true" />
                </Link>
              )}
              <ThemeToggle dark={dark} onToggle={toggle} />
            </>
          }
          footer={
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
              messer-paste · {BUILD_SHA} · Messer UI {CANON_VERSION}
            </span>
          }
        >
          {searchOpen && showSearch ? (
            <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--background)] px-4 py-2 sm:hidden">
              <div className="min-w-0 flex-1">
                <GlobalSearch variant="inline" onDone={() => setSearchOpen(false)} />
              </div>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setSearchOpen(false)}
                className="grid size-8 shrink-0 cursor-pointer place-items-center border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {isPublic ? null : <SessionExpired />}
          {isPublic && !publicReady ? (
            <div className="mx-auto w-full max-w-[var(--shell)] px-4 py-16 md:px-8">
              <div className="border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
                <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                  Public reader
                </p>
                <p className="mx-auto mt-2 mb-0 max-w-[38ch] text-sm leading-relaxed text-[var(--text-2)]">
                  This host only opens the paste link you were given. Nothing is listed here.
                </p>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
          <Toaster dark={dark} />
        </AppShell>
      </LiveContext.Provider>
    </TouchProvider>
  );
}

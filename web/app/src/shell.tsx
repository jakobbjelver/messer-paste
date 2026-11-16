import type { ComponentType } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";

import { AppShell, type NavItem } from "@/components/ui/app-shell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Mark } from "@/components/mark";
import { LiveContext, useLiveEvents } from "@/hooks/use-live-events";
import { useTheme } from "@/hooks/use-theme";
import { BUILD_SHA, CANON_VERSION } from "@/lib/version";
import { Toaster } from "@/components/ui/sonner";

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
  const live = useLiveEvents();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <LiveContext.Provider value={live}>
      <AppShell
        variant="topbar"
        container="default"
        brand={{ name: "Messer Paste", mark: <Mark />, href: "/" }}
        nav={NAV}
        active={pathname}
        linkComponent={linkComponent}
        actions={
          <>
            <ThemeToggle dark={dark} onToggle={toggle} />
          </>
        }
        footer={
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
            messer-paste · {BUILD_SHA} · Messer UI {CANON_VERSION}
          </span>
        }
      >
        <Outlet />
        <Toaster dark={dark} />
      </AppShell>
    </LiveContext.Provider>
  );
}

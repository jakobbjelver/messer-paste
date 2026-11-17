import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import { BackLink } from "@/components/ui/back-link";

/**
 * "Back" is where you actually came from, not where the app guesses you came from.
 *
 * A single-page app has no referrer, so the tab keeps its own trail in sessionStorage: every route
 * change appends its path, and a back control points at the last entry that is not the current one.
 * The anchor is a real href, so a cold load, a new tab and a middle click all still work; when the
 * trail says the previous entry is the one we would navigate to, the click is handed to history
 * instead, which keeps the router's own scroll and state.
 */
const TRAIL = "mpaste:trail";
const LIMIT = 24;

function readTrail(): string[] {
  try {
    const raw = sessionStorage.getItem(TRAIL);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writeTrail(list: string[]) {
  try {
    sessionStorage.setItem(TRAIL, JSON.stringify(list.slice(-LIMIT)));
  } catch {
    /* private mode */
  }
}

/** A page's own name, for the sentence a back control carries. */
export function pageLabel(path: string): string {
  if (path === "/") return "the composer";
  if (path === "/recent") return "recent";
  if (path === "/settings") return "settings";
  if (path === "/ui") return "the canon sheet";
  if (/^\/[0-9A-HJKMNP-Z]{8}\/edit$/i.test(path)) return "the paste";
  if (/^\/[0-9A-HJKMNP-Z]{8}$/i.test(path)) return "the paste";
  return "the last page";
}

/** Mounted once in the shell: the trail is a property of the tab, not of a page. */
export function useTrailRecorder() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const list = readTrail();
    if (list[list.length - 1] === pathname) return;
    writeTrail([...list, pathname]);
  }, [pathname]);
}

type Target = { href: string; label: string; fromTrail: boolean };

/**
 * The destination for a back control: the previous entry in this tab, or the fallback the page names
 * for a cold load. It re-resolves after a route change so a back and a forward keep telling the truth.
 */
export function useBackTarget(fallbackHref: string, fallbackLabel: string): Target {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [target, setTarget] = useState<Target>({ href: fallbackHref, label: fallbackLabel, fromTrail: false });

  useEffect(() => {
    const previous = [...readTrail()].reverse().find((entry) => entry !== pathname);
    if (previous && previous !== fallbackHref) {
      setTarget({ href: previous, label: `Back to ${pageLabel(previous)}`, fromTrail: true });
    } else if (previous && previous === fallbackHref) {
      setTarget({ href: previous, label: `Back to ${pageLabel(previous)}`, fromTrail: true });
    } else {
      setTarget({ href: fallbackHref, label: fallbackLabel, fromTrail: false });
    }
  }, [pathname, fallbackHref, fallbackLabel]);

  return target;
}

/** The canon's one way back, pointed at the real previous page. */
export function AppBack({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) {
  const router = useRouter();
  const target = useBackTarget(fallbackHref, fallbackLabel);

  return (
    <BackLink
      href={target.href}
      label={target.label}
      className="mb-4"
      onNavigate={(event) => {
        if (!target.fromTrail) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        router.history.back();
      }}
    />
  );
}

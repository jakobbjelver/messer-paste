import { useEffect, useMemo } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import { BackLink } from "@/components/ui/back-link";
import { advance, backTarget, EMPTY_TRAIL, parseTrail, type Trail } from "@/lib/trail";

/**
 * "Back" is where you actually came from, not where the app guesses you came from.
 *
 * A single-page app has no referrer, so the tab keeps its own trail in sessionStorage as a stack with
 * a cursor (`lib/trail.ts`): every route change moves or pushes the cursor, and Back means exactly
 * one step back — never "some other page I have been to", which is what let Back bounce between a
 * paste and its editor. The anchor stays a real href, so a cold load, a new tab and a middle click
 * all still work; when the trail says the previous entry is the one we would navigate to, the click
 * is handed to history instead, which keeps the router's own scroll and state.
 */
const TRAIL = "mpaste:trail:v2";

/** A navigation that should overwrite the entry it leaves (an editor save), not push a new one. */
let pendingReplace: string | null = null;

export function expectReplace(path: string) {
  pendingReplace = path;
}

function readTrail(): Trail {
  try {
    return parseTrail(sessionStorage.getItem(TRAIL));
  } catch {
    return EMPTY_TRAIL;
  }
}

/**
 * The trail as it reads on this page. Both the recorder and the back control go through here: the
 * recorder writes the result, the control only needs to know where one step back is, and deriving it
 * the same way means the label cannot disagree with the click.
 */
function trailFor(pathname: string): Trail {
  return advance(readTrail(), pathname, pendingReplace === pathname);
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
    const replace = pendingReplace === pathname;
    if (replace) pendingReplace = null;
    const next = advance(readTrail(), pathname, replace);
    try {
      sessionStorage.setItem(TRAIL, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }, [pathname]);
}

type Target = { href: string; label: string; fromTrail: boolean };

/**
 * The destination for a back control: one step back in this tab, or the fallback the page names for
 * a cold load.
 */
export function useBackTarget(fallbackHref: string, fallbackLabel: string): Target {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return useMemo(() => {
    const previous = backTarget(trailFor(pathname));
    if (previous) {
      return { href: previous, label: `Back to ${pageLabel(previous)}`, fromTrail: true };
    }
    return { href: fallbackHref, label: fallbackLabel, fromTrail: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, fallbackHref, fallbackLabel]);
}

/** A canonical path back into the router. The trail stores hrefs, the router wants a route node. */
function navigateBack(router: ReturnType<typeof useRouter>, href: string) {
  const match = href.match(/^\/([0-9A-HJKMNP-Z]{8})(\/edit)?$/i);
  if (match) {
    const params = { slug: match[1].toUpperCase() };
    if (match[2]) return router.navigate({ to: "/$slug/edit", params });
    return router.navigate({ to: "/$slug", params });
  }
  switch (href) {
    case "/":
      return router.navigate({ to: "/", search: { duplicate: undefined } });
    case "/recent":
      return router.navigate({ to: "/recent" });
    case "/settings":
      return router.navigate({ to: "/settings" });
    case "/ui":
      return router.navigate({ to: "/ui" });
    default:
      window.location.assign(href);
      return undefined;
  }
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
        // Not history.back(): the browser's own stack still holds the entry a save replaced, so
        // going back there would land on the page you are on. The trail is the truth here.
        event.preventDefault();
        navigateBack(router, target.href);
      }}
    />
  );
}

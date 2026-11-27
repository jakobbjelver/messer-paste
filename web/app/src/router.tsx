import { createRootRoute, createRoute } from "@tanstack/react-router";

import { Shell } from "./shell";
import { ComposerPage } from "./pages/composer";
import { RecentPage } from "./pages/recent";
import { PastePage } from "./pages/paste";
import { EditPage } from "./pages/edit";
import { SettingsPage } from "./pages/settings";
import { SinkPage } from "./pages/sink";
import { NotFoundPage } from "./pages/not-found";
import { ReauthPage } from "./components/session-expired";
import { REAUTH_PATH } from "./lib/session";

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundPage });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>) => ({
    duplicate: typeof search.duplicate === "string" ? search.duplicate : undefined,
  }),
  component: ComposerPage,
});

const recentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recent",
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === "string" && search.q ? { q: search.q } : {},
  component: RecentPage,
});

const pasteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$slug",
  component: PastePage,
});

const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$slug/edit",
  component: EditPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const sinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ui",
  component: SinkPage,
});

// Registered before `/$slug` so a slug can never shadow it: a paste slug is 8 characters from an
// alphabet without a `-`, and this path is the one the service worker is forbidden to answer.
const reauthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: REAUTH_PATH,
  component: ReauthPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  recentRoute,
  settingsRoute,
  sinkRoute,
  reauthRoute,
  pasteRoute,
  editRoute,
]);

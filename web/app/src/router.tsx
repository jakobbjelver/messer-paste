import { createRootRoute, createRoute } from "@tanstack/react-router";

import { Shell } from "./shell";
import { ComposerPage } from "./pages/composer";
import { RecentPage } from "./pages/recent";
import { PastePage } from "./pages/paste";
import { EditPage } from "./pages/edit";
import { SinkPage } from "./pages/sink";
import { NotFoundPage } from "./pages/not-found";

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

const sinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ui",
  component: SinkPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  recentRoute,
  sinkRoute,
  pasteRoute,
  editRoute,
]);

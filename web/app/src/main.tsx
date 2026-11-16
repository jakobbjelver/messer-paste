import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";

import "./styles/app.css";
import { routeTree } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The worker is prompt-only: a new build asks before it takes over, so a paste being written is never
// swapped out from under the person writing it.
if (!import.meta.env.DEV) {
  const update = registerSW({
    onNeedRefresh() {
      toast("A new version is ready", {
        duration: Infinity,
        action: { label: "Reload", onClick: () => void update(true) },
      });
    },
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

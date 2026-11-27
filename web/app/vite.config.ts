import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The Go API in development. 8015 is dev-only: the container is never published.
const apiOrigin = process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8015";

export default defineConfig({
  // The SPA owns "/": the Go binary serves index.html for every non-/api path.
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    // A home-screen app, not an offline pastebin: the shell is precached, the archive never is. A
    // cached /api response would be a lie the moment another machine writes.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "favicon-dark.svg", "favicon-32.png", "apple-touch-icon.png"],
      // The manifest is a data file in public/, not source: a manifest cannot read a CSS token, and
      // keeping it out of TypeScript keeps the one legitimate hex value out of the source scan.
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // The shell is precached and a navigation is answered from it, which is what makes the app
        // open instantly — and, when Access has no session, what leaves it painted and refused.
        // `REAUTH_PATH` (src/lib/session.ts) is therefore denied: that one navigation has to reach
        // the edge so Access can answer with its login redirect, and the session comes back.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/reauth/],
        // No runtime caching at all. The API and the SSE stream are always live; the editor's own
        // autosaved draft lives in localStorage, not in a cache bucket.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: true,
    // Reached through a local proxy as something.local, as pub.localhost for the public reader, and
    // as paste-dev.messer.wtf through Caddy. The leading-dot form accepts every subdomain of each
    // suffix, so a new dev hostname never turns into a 403 "Blocked request" that looks like an app bug.
    allowedHosts: [".messer.wtf", ".local", ".localhost"],
    // changeOrigin: false keeps the browser's Host, which is how the dev server can answer as the
    // public host (http://pub.localhost:3015) without a second proxy.
    proxy: { "/api": { target: apiOrigin, changeOrigin: false } },
  },
});

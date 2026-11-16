import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Go API in development. 8015 is dev-only: the container is never published.
const apiOrigin = process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8015";

export default defineConfig({
  // The SPA owns "/": the Go binary serves index.html for every non-/api path.
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: true,
    // Reached through Caddy as paste-dev.example.com / paste-dev.local.
    allowedHosts: [".localhost", ".local", ".localhost"],
    // changeOrigin: false keeps the browser's Host, which is how the dev server can answer as the
    // public host (http://pub.localhost:3015) without a second proxy.
    proxy: { "/api": { target: apiOrigin, changeOrigin: false } },
  },
});

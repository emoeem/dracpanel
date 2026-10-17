import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Self-hosted build for the sing-box-panel UI directory.
// PWA/Service Worker is intentionally disabled: the panel serves the build
// from a stable path, and a cached shell would make upgrades/rollbacks unreliable.
export default defineConfig({
  base: "./",
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
  },
});

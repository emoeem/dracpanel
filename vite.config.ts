import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

/** Empty when built outside a git checkout (tarball, CI artifact). */
function buildCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/**
 * Records which source tree produced `dist/`. Arch ships the prebuilt assets
 * next to the sources, and packaging compares this against SOURCE_COMMIT so a
 * stale or hand-edited dist cannot be published unnoticed.
 */
function buildInfoPlugin(): Plugin {
  return {
    name: "dracpanel-build-info",
    apply: "build",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      writeFileSync(
        "dist/build-info.json",
        `${JSON.stringify(
          {
            name: pkg.name,
            version: pkg.version,
            commit: buildCommit(),
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    },
  };
}

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
  plugins: [react(), buildInfoPlugin()],
  // Baked into the bundle so the running UI can report which build it is.
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(buildCommit()),
  },
  server: {
    port: 5173,
  },
});

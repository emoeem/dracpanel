/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** package.json version, injected by vite.config.ts at build time. */
  readonly VITE_APP_VERSION?: string;
  /** Short git commit of the build, empty outside a checkout. */
  readonly VITE_BUILD_COMMIT?: string;
}

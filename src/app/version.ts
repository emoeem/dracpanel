/**
 * Build identity baked in by vite.config.ts (`define`), so a running panel can
 * tell you which UI build it is — the served assets are otherwise just hashes.
 */

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";

export const BUILD_COMMIT: string = import.meta.env.VITE_BUILD_COMMIT ?? "";

/** "v0.1.0 (a1b2c3d)", or just "v0.1.0" when built without git. */
export function buildLabel(): string {
  const version = `v${APP_VERSION.replace(/^v/i, "")}`;
  return BUILD_COMMIT === "" ? version : `${version} (${BUILD_COMMIT})`;
}

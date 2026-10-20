// src/gen/ and terminalThemes.generated.ts are build artifacts and are not
// committed, so a fresh clone cannot compile until `pnpm generate` has run.
// `prebuild` calls this script so `pnpm build` recovers on its own instead of
// failing with a wall of "cannot find module ..." errors.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const GENERATED = [
  "src/gen/daemon/started_service_pb.ts",
  "src/lib/terminalThemes.generated.ts",
];

const missing = GENERATED.filter((file) => !existsSync(new URL(`../${file}`, import.meta.url)));

if (missing.length === 0) {
  process.exit(0);
}

console.log(`[prebuild] missing generated files: ${missing.join(", ")}`);
console.log("[prebuild] running `pnpm generate` ...");

const result = spawnSync("pnpm", ["generate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error(
    "[prebuild] `pnpm generate` failed. If the iterm2-color-schemes submodule is empty, run:",
  );
  console.error("  git submodule update --init --depth 1");
}

process.exit(result.status ?? 1);

// Bundle size budget for dist/assets. Thresholds live here as constants so
// they can be tuned without touching CI YAML. Values are bytes; the budget is
// measured before gzip/compression because that is what the CDN ships.
//
// Current usage (2026-10): ~2.26 MB total, largest chunk JsonEditor at ~434 kB.
// Raise these deliberately when a feature genuinely needs the weight.
const MAX_TOTAL_BYTES = 2.5 * 1000 * 1000;
const MAX_CHUNK_BYTES = 800 * 1000;

import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = fileURLToPath(new URL("../dist/assets", import.meta.url));

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const mb = (bytes) => `${(bytes / 1000 / 1000).toFixed(2)} MB`;

async function collectJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectJs(path)));
    } else if (extname(entry.name) === ".js") {
      const { size } = await stat(path);
      files.push({ path, size });
    }
  }

  return files;
}

const rootRelative = (path) => path.slice(path.indexOf("dist/"));

async function main() {
  let files;

  try {
    files = await collectJs(ASSETS_DIR);
  } catch {
    console.error("[bundle-size] dist/assets is missing — run `pnpm build` first.");
    return false;
  }

  if (files.length === 0) {
    console.error("[bundle-size] no .js files found under dist/assets.");
    return false;
  }

  files.sort((a, b) => b.size - a.size);

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const largest = files[0];

  console.log(`[bundle-size] ${files.length} js files, total ${mb(total)}`);
  console.log(`[bundle-size] largest chunk ${kb(largest.size)} (${rootRelative(largest.path)})`);
  console.log("[bundle-size] top 10 files:");

  for (const file of files.slice(0, 10)) {
    console.log(`  ${kb(file.size).padStart(10)}  ${rootRelative(file.path)}`);
  }

  const failures = [];

  if (total > MAX_TOTAL_BYTES) {
    failures.push(`total ${mb(total)} exceeds budget ${mb(MAX_TOTAL_BYTES)}`);
  }

  if (largest.size > MAX_CHUNK_BYTES) {
    failures.push(
      `${rootRelative(largest.path)} (${kb(largest.size)}) exceeds chunk budget ${kb(MAX_CHUNK_BYTES)}`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[bundle-size] FAIL ${failure}`);
    }

    return false;
  }

  console.log("[bundle-size] PASS");
  return true;
}

process.exitCode = (await main()) ? 0 : 1;

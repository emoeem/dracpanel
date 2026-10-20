// @vitest-environment node

/**
 * `APP_VERSION` / `BUILD_COMMIT` are read from `import.meta.env` defines once,
 * at module load, so every case re-imports the module after stubbing the env.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function importVersion(): Promise<typeof import("./version")> {
  vi.resetModules();
  return import("./version");
}

async function importWith(version: string, commit: string): Promise<string> {
  vi.stubEnv("VITE_APP_VERSION", version);
  vi.stubEnv("VITE_BUILD_COMMIT", commit);
  const { buildLabel } = await importVersion();
  return buildLabel();
}

describe("build identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps both constants strings when the build defines are absent", async () => {
    const { APP_VERSION, BUILD_COMMIT, buildLabel } = await importVersion();
    expect(typeof APP_VERSION).toBe("string");
    expect(typeof BUILD_COMMIT).toBe("string");
    expect(buildLabel()).not.toContain("undefined");
  });

  it("adds the v prefix to a bare version", async () => {
    expect(await importWith("0.1.0", "")).toBe("v0.1.0");
  });

  it("does not double the v prefix", async () => {
    expect(await importWith("v0.1.0", "")).toBe("v0.1.0");
  });

  it("normalises an upper case prefix", async () => {
    expect(await importWith("V0.1.0", "")).toBe("v0.1.0");
  });

  it("appends the commit when git was available", async () => {
    expect(await importWith("0.1.0", "a1b2c3d")).toBe("v0.1.0 (a1b2c3d)");
    expect(await importWith("v0.1.0", "a1b2c3d")).toBe("v0.1.0 (a1b2c3d)");
  });

  it("shows a plain version when built without git", async () => {
    expect(await importWith("1.2.3", "")).toBe("v1.2.3");
  });
});

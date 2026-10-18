import { describe, expect, it } from "vitest";

import {
  capabilitiesFromFeatures,
  detectPanelCapabilities,
  type PanelProbe,
} from "./panelCapabilities";
import type { PanelState } from "./panel";

const STATE: PanelState = { ok: true, panel_version: "0.1.0" };

describe("capabilitiesFromFeatures", () => {
  it("treats the backend feature list as authoritative", () => {
    const caps = capabilitiesFromFeatures(["geoip", "logs"], "0.1.0");

    expect(caps.detected).toBe(true);
    expect(caps.source).toBe("backend");
    expect(caps.supports("geoip")).toBe(true);
    expect(caps.supports("logs")).toBe(true);
    expect(caps.supports("config.backup.download")).toBe(false);
    expect(caps.missing).toContain("config.backup.download");
  });

  it("ignores unknown feature keys", () => {
    const caps = capabilitiesFromFeatures(["geoip", "not-a-feature"]);
    expect(caps.supports("geoip")).toBe(true);
    expect(caps.missing).not.toContain("geoip");
  });
});

describe("detectPanelCapabilities", () => {
  it("uses the backend feature list without probing", async () => {
    let probed = false;
    const probe: PanelProbe = async () => {
      probed = true;
      return { supported: true };
    };

    const caps = await detectPanelCapabilities({ ...STATE, features: ["geoip"] }, probe);

    expect(probed).toBe(false);
    expect(caps.source).toBe("backend");
    expect(caps.supports("geoip")).toBe(true);
    expect(caps.supports("logs")).toBe(false);
  });

  it("marks every new route unavailable on an older panel", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const probe: PanelProbe = async (path, init) => {
      calls.push({ path, init });
      return { supported: false };
    };

    const caps = await detectPanelCapabilities(STATE, probe);

    expect(caps.detected).toBe(true);
    expect(caps.source).toBe("probe");
    expect(caps.missing).toEqual([
      "subscriptions.schedule",
      "subscriptions.managed",
      "subscriptions.userinfo",
      "config.backup.download",
      "logs",
      "clash.version",
      "geoip",
    ]);
    expect(calls.map((call) => call.path)).toContain("/geoip?ip=127.0.0.1");
    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
  });

  it("keeps all controls enabled when every probe is inconclusive", async () => {
    const caps = await detectPanelCapabilities(STATE, async () => ({ supported: null }));

    expect(caps.detected).toBe(false);
    expect(caps.source).toBe("unknown");
    expect(caps.supports("geoip")).toBe(true);
    expect(caps.missing).toEqual([]);
  });

  it("derives subscription userinfo support from the managed endpoint", async () => {
    const caps = await detectPanelCapabilities(STATE, async (path) => ({
      supported: path === "/subscriptions/managed",
    }));

    expect(caps.supports("subscriptions.managed")).toBe(true);
    expect(caps.supports("subscriptions.userinfo")).toBe(true);
    expect(caps.supports("geoip")).toBe(false);
  });
});

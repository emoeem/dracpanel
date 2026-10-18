import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadDashboardCardsConfig,
  saveDashboardCardsConfig,
  toggleCard,
  type DashboardCardsConfig,
} from "./dashboardCards";

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("loadDashboardCardsConfig", () => {
  it("enables the new history cards for a fresh config", () => {
    const config = loadDashboardCardsConfig(false);
    expect(config.enabled).toContain("trafficHistory");
    expect(config.enabled).toContain("connectionHistory");
    expect(config.order).toContain("trafficHistory");
  });

  it("migrates a saved config without re-enabling intentionally disabled cards", () => {
    const saved: DashboardCardsConfig = {
      enabled: ["uploadTraffic", "downloadTraffic", "connections"],
      order: ["uploadTraffic", "downloadTraffic", "status", "connections", "systemProxy", "clashMode", "profile"],
    };
    saveDashboardCardsConfig(saved);
    const config = loadDashboardCardsConfig(false);
    expect(config.enabled).toContain("trafficHistory");
    expect(config.enabled).toContain("connectionHistory");
    expect(config.enabled).not.toContain("status");
    expect(config.order).toContain("trafficHistory");
    expect(config.order).toContain("connectionHistory");
  });

  it("does not re-enable a new card after the user hides it", () => {
    const initial = loadDashboardCardsConfig(false);
    saveDashboardCardsConfig(toggleCard(initial, "trafficHistory"));
    const reloaded = loadDashboardCardsConfig(false);
    expect(reloaded.enabled).not.toContain("trafficHistory");
  });
});

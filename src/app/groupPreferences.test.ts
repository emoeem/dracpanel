import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadAutoTestInterval,
  loadGroupSort,
  loadHideUnavailable,
  saveAutoTestInterval,
  saveGroupSort,
  saveHideUnavailable,
} from "./groupPreferences";

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

describe("group preferences", () => {
  it("restores sort and hide-unavailable preferences", () => {
    saveGroupSort("latency");
    saveHideUnavailable(true);
    expect(loadGroupSort()).toBe("latency");
    expect(loadHideUnavailable()).toBe(true);
  });

  it("falls back to config order for an invalid value", () => {
    localStorage.setItem("sing-box-dashboard.group-sort", JSON.stringify("sideways"));
    expect(loadGroupSort()).toBe("config");
  });

  it("scopes auto-test intervals per server and defaults to off", () => {
    expect(loadAutoTestInterval("a")).toBe("off");
    saveAutoTestInterval("a", "15");
    saveAutoTestInterval("b", "30");
    expect(loadAutoTestInterval("a")).toBe("15");
    expect(loadAutoTestInterval("b")).toBe("30");
    expect(loadAutoTestInterval("c")).toBe("off");
  });
});

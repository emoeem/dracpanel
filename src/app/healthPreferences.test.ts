// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_HEALTH_SETTINGS,
  loadHealthRun,
  loadHealthSettings,
  normalizeHealthRun,
  normalizeHealthSettings,
  saveHealthRun,
  saveHealthSettings,
  thresholdsOf,
} from "./healthPreferences";

describe("health settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the defaults", () => {
    expect(loadHealthSettings()).toEqual(DEFAULT_HEALTH_SETTINGS);
    expect(normalizeHealthSettings(null)).toEqual(DEFAULT_HEALTH_SETTINGS);
    expect(normalizeHealthSettings("nope")).toEqual(DEFAULT_HEALTH_SETTINGS);
  });

  it("round trips", () => {
    saveHealthSettings({ notify: false, autoSwitch: true, degradedMs: 200, downMs: 800 });
    expect(loadHealthSettings()).toEqual({
      notify: false,
      autoSwitch: true,
      degradedMs: 200,
      downMs: 800,
    });
  });

  it("clamps nonsense thresholds and keeps down above degraded", () => {
    const settings = normalizeHealthSettings({ degradedMs: 900, downMs: 100 });
    expect(settings.degradedMs).toBe(900);
    expect(settings.downMs).toBe(910);
    expect(normalizeHealthSettings({ degradedMs: -5, downMs: 1e9 }).degradedMs).toBe(20);
    expect(normalizeHealthSettings({ degradedMs: 100, downMs: 1e9 }).downMs).toBe(600_000);
  });

  it("derives thresholds for the classifier", () => {
    expect(thresholdsOf({ notify: true, autoSwitch: false, degradedMs: 150, downMs: 400 })).toEqual({
      degradedMs: 150,
      downMs: 400,
    });
  });
});

describe("health run state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is per server", () => {
    saveHealthRun("a", { lastRunAt: 10, statuses: { node: "down" } });
    saveHealthRun("b", { lastRunAt: 20, statuses: {} });
    expect(loadHealthRun("a")).toEqual({ lastRunAt: 10, statuses: { node: "down" } });
    expect(loadHealthRun("b").lastRunAt).toBe(20);
    expect(loadHealthRun("c")).toEqual({ lastRunAt: 0, statuses: {} });
  });

  it("drops unknown statuses", () => {
    expect(normalizeHealthRun({ lastRunAt: 1, statuses: { a: "down", b: "wat" } })).toEqual({
      lastRunAt: 1,
      statuses: { a: "down" },
    });
  });

  it("survives malformed payloads", () => {
    expect(normalizeHealthRun(null)).toEqual({ lastRunAt: 0, statuses: {} });
    expect(normalizeHealthRun({ lastRunAt: "x" })).toEqual({ lastRunAt: 0, statuses: {} });
  });
});

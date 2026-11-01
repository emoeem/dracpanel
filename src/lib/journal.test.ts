import { describe, expect, it } from "vitest";

import { filterBySeverity, groupJournalByDay, isEventEntry, severityRank } from "./journal";

const HOUR = 3600;

function entry(t: number, overrides: Partial<Parameters<typeof isEventEntry>[0]> = {}) {
  return {
    t,
    kind: "config",
    severity: "info",
    category: "operation",
    title: "x",
    ok: true,
    ...overrides,
  };
}

describe("groupJournalByDay", () => {
  const now = new Date(2026, 10, 1, 12, 0, 0).getTime();
  const todayStart = Math.floor(new Date(2026, 10, 1, 0, 0, 0).getTime() / 1000);

  it("labels today and yesterday", () => {
    const groups = groupJournalByDay(
      [entry(todayStart + HOUR), entry(todayStart - HOUR)],
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(["today", "yesterday"]);
    expect(groups[0].items).toHaveLength(1);
  });

  it("uses a date label for older entries", () => {
    const groups = groupJournalByDay([entry(todayStart - 72 * HOUR)], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).not.toBe("today");
    expect(groups[0].key).not.toBe("yesterday");
  });
});

describe("isEventEntry", () => {
  it("keeps health events and failures", () => {
    expect(isEventEntry(entry(1, { category: "event" }))).toBe(true);
    expect(isEventEntry(entry(1, { severity: "warn" }))).toBe(true);
    expect(isEventEntry(entry(1, { ok: false, severity: "error" }))).toBe(true);
  });

  it("drops successful operations", () => {
    expect(isEventEntry(entry(1))).toBe(false);
  });
});

describe("severity helpers", () => {
  it("ranks severity", () => {
    expect(severityRank("error")).toBeGreaterThan(severityRank("warn"));
    expect(severityRank("info")).toBe(0);
  });

  it("filters by severity", () => {
    const entries = [entry(1, { severity: "warn" }), entry(2, { severity: "error" }), entry(3)];
    expect(filterBySeverity(entries, "warn")).toHaveLength(1);
    expect(filterBySeverity(entries, "error")).toHaveLength(1);
    expect(filterBySeverity(entries, "")).toHaveLength(3);
  });
});

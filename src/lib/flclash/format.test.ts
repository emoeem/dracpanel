import { describe, expect, it } from "vitest";

import {
  daysUntil,
  formatExpiryDays,
  formatPeak,
  formatRate,
  formatUptimeClock,
  percentLabel,
  usageSummary,
} from "./format";

describe("formatUptimeClock", () => {
  it("renders FlClash's HH:MM:SS form", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(formatUptimeClock(now - 11_000, now)).toBe("00:00:11");
    expect(formatUptimeClock(now - (3600_000 + 720_000 + 34_000), now)).toBe("01:12:34");
    expect(formatUptimeClock(now - (40 * 3600_000), now)).toBe("40:00:00");
    expect(formatUptimeClock(now + 1000, now)).toBe("00:00:00");
  });
});

describe("usageSummary", () => {
  it("combines upload and download", () => {
    const summary = usageSummary(100, 300, 1000);
    expect(summary.used).toBe(400);
    expect(summary.ratio).toBeCloseTo(0.4);
    expect(summary.hasTotal).toBe(true);
  });

  it("handles missing totals", () => {
    const summary = usageSummary(100, 100, undefined);
    expect(summary.hasTotal).toBe(false);
    expect(summary.ratio).toBe(0);
  });
});

describe("daysUntil", () => {
  it("rounds up partial days and flags expiry", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(daysUntil(Math.floor(now / 1000) + 3 * 86400, now)).toBe(3);
    expect(daysUntil(Math.floor(now / 1000) + 3600, now)).toBe(1);
    expect(daysUntil(Math.floor(now / 1000) - 3600, now)).toBeLessThanOrEqual(0);
    expect(daysUntil(undefined, now)).toBeNull();
  });
});

describe("formatters", () => {
  it("formats rate, peak, percent and expiry text", () => {
    expect(formatRate(1024)).toBe("1 KB/s");
    expect(formatPeak([1, 2048, 3])).toBe("2 KB/s");
    expect(formatPeak([])).toBe("0 B/s");
    expect(percentLabel(0.34)).toBe("34%");
    expect(formatExpiryDays(49)).toBe("剩余 49 天");
    expect(formatExpiryDays(0)).toBe("已过期");
    expect(formatExpiryDays(null)).toBe("—");
  });
});

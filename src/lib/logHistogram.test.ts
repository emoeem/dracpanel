import { describe, expect, it } from "vitest";

import { LogLevel } from "../gen/daemon/started_service_pb";
import {
  HISTOGRAM_BUCKET_MS,
  arrivalsPerMinute,
  buildLogHistogram,
  histogramMax,
} from "./logHistogram";

const BASE = Date.UTC(2026, 10, 2, 10, 0, 0); // aligned to 15 minutes

describe("buildLogHistogram", () => {
  it("returns empty for degenerate windows instead of dividing by zero", () => {
    expect(buildLogHistogram([], BASE, 0, 12)).toEqual([]);
    expect(buildLogHistogram([], BASE, 1000, 0)).toEqual([]);
  });

  it("aligns buckets backwards from the current window and counts by level", () => {
    const buckets = buildLogHistogram(
      [
        { at: BASE + 1000, level: LogLevel.ERROR },
        { at: BASE + 2000, level: LogLevel.WARN },
        { at: BASE + 3000, level: LogLevel.INFO },
        { at: BASE + 4000, level: LogLevel.DEBUG },
      ],
      BASE + 5000,
      HISTOGRAM_BUCKET_MS,
      4,
    );
    expect(buckets).toHaveLength(4);
    const last = buckets[3];
    expect(last.start).toBe(BASE);
    expect(last).toMatchObject({ error: 1, warn: 1, info: 2, total: 4 });
    expect(buckets[0].total).toBe(0);
  });

  it("drops samples outside the window and clamps the trailing edge", () => {
    const buckets = buildLogHistogram(
      [
        { at: BASE - 40 * 60_000, level: LogLevel.ERROR }, // before the first bucket
        { at: BASE + HISTOGRAM_BUCKET_MS + 900, level: LogLevel.WARN }, // beyond `now`
        { at: Number.NaN, level: LogLevel.INFO },
      ],
      BASE + 1000,
      HISTOGRAM_BUCKET_MS,
      3,
    );
    expect(buckets.every((bucket) => bucket.total === 0)).toBe(true);
  });

  it("counts an arrival exactly on a boundary into the later bucket", () => {
    const buckets = buildLogHistogram(
      [{ at: BASE + HISTOGRAM_BUCKET_MS, level: LogLevel.INFO }],
      BASE + HISTOGRAM_BUCKET_MS + 1000,
      HISTOGRAM_BUCKET_MS,
      3,
    );
    expect(buckets[1].total).toBe(0);
    expect(buckets[2].total).toBe(1);
  });

  it("reports the tallest bucket", () => {
    const buckets = buildLogHistogram(
      [
        { at: BASE, level: LogLevel.INFO },
        { at: BASE + 1, level: LogLevel.INFO },
        { at: BASE + 2, level: LogLevel.ERROR },
      ],
      BASE + 1000,
      HISTOGRAM_BUCKET_MS,
      3,
    );
    expect(histogramMax(buckets)).toBe(3);
  });
});

describe("arrivalsPerMinute", () => {
  it("scales the trailing window to a per-minute rate", () => {
    const arrivals = [
      { at: BASE, level: LogLevel.INFO },
      { at: BASE + 10_000, level: LogLevel.INFO },
    ];
    // Two arrivals in the last 30s → 4/min.
    expect(arrivalsPerMinute(arrivals, BASE + 20_000, 30_000)).toBe(4);
  });

  it("ignores old samples and degenerate windows", () => {
    expect(arrivalsPerMinute([{ at: BASE, level: LogLevel.INFO }], BASE + 120_000, 60_000)).toBe(0);
    expect(arrivalsPerMinute([{ at: BASE, level: LogLevel.INFO }], BASE, 0)).toBe(0);
  });
});

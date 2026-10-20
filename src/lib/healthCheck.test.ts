import { describe, expect, it } from "vitest";

import {
  averageDelay,
  bestCandidate,
  classifyDelay,
  DEFAULT_THRESHOLDS,
  HEALTH_STALE_MS,
  healthOf,
  isDue,
  isNewOutage,
  isRecovered,
  nextDueIn,
  summarizeHealth,
  type LatencySample,
} from "./healthCheck";

describe("classifyDelay", () => {
  it("sorts latencies into bands", () => {
    expect(classifyDelay(80, DEFAULT_THRESHOLDS)).toBe("healthy");
    expect(classifyDelay(300, DEFAULT_THRESHOLDS)).toBe("degraded");
    expect(classifyDelay(1200, DEFAULT_THRESHOLDS)).toBe("down");
  });

  it("treats a failed or missing probe as down", () => {
    expect(classifyDelay(0, DEFAULT_THRESHOLDS)).toBe("down");
    expect(classifyDelay(-1, DEFAULT_THRESHOLDS)).toBe("down");
    expect(classifyDelay(Number.NaN, DEFAULT_THRESHOLDS)).toBe("down");
  });
});

describe("healthOf", () => {
  const now = 1_000_000;

  it("reports unknown without samples", () => {
    expect(healthOf([], DEFAULT_THRESHOLDS, now)).toEqual({ status: "unknown", delay: 0, at: 0 });
  });

  it("uses the newest sample", () => {
    const samples: LatencySample[] = [
      { at: now - 2000, delay: 50 },
      { at: now - 1000, delay: 1500 },
    ];
    expect(healthOf(samples, DEFAULT_THRESHOLDS, now).status).toBe("down");
  });

  it("goes back to unknown when the newest sample is stale", () => {
    const samples: LatencySample[] = [{ at: now - HEALTH_STALE_MS - 1, delay: 40 }];
    const verdict = healthOf(samples, DEFAULT_THRESHOLDS, now);
    expect(verdict.status).toBe("unknown");
    expect(verdict.delay).toBe(40);
  });
});

describe("summarizeHealth", () => {
  it("counts each band", () => {
    expect(summarizeHealth(["healthy", "healthy", "degraded", "down", "unknown"])).toEqual({
      total: 5,
      healthy: 2,
      degraded: 1,
      down: 1,
      unknown: 1,
    });
  });
});

describe("transitions", () => {
  it("only fires an outage once", () => {
    expect(isNewOutage("healthy", "down")).toBe(true);
    expect(isNewOutage("degraded", "down")).toBe(true);
    expect(isNewOutage("down", "down")).toBe(false);
    expect(isNewOutage("unknown", "down")).toBe(true);
  });

  it("reports recovery from down to healthy", () => {
    expect(isRecovered("down", "healthy")).toBe(true);
    expect(isRecovered("down", "degraded")).toBe(false);
    expect(isRecovered("healthy", "healthy")).toBe(false);
  });
});

describe("scheduling", () => {
  it("probes when there is no previous run", () => {
    expect(isDue(undefined, 1000, 300_000)).toBe(true);
    expect(nextDueIn(undefined, 1000, 300_000)).toBe(0);
  });

  it("waits for the interval to elapse", () => {
    expect(isDue(0, 299_000, 300_000)).toBe(false);
    expect(isDue(0, 300_000, 300_000)).toBe(true);
    expect(nextDueIn(0, 100_000, 300_000)).toBe(200_000);
    expect(nextDueIn(0, 900_000, 300_000)).toBe(0);
  });

  it("never schedules when disabled", () => {
    expect(isDue(undefined, 1000, 0)).toBe(false);
    expect(nextDueIn(undefined, 1000, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("bestCandidate", () => {
  it("picks the fastest usable node", () => {
    const tag = bestCandidate(
      [
        { tag: "slow", delay: 800 },
        { tag: "fast", delay: 120 },
        { tag: "broken", delay: 0 },
      ],
      900,
      DEFAULT_THRESHOLDS,
    );
    expect(tag).toBe("fast");
  });

  it("refuses to switch to something no better", () => {
    expect(
      bestCandidate([{ tag: "a", delay: 500 }], 400, DEFAULT_THRESHOLDS),
    ).toBeNull();
  });

  it("refuses when everything is down", () => {
    expect(
      bestCandidate(
        [
          { tag: "a", delay: 0 },
          { tag: "b", delay: 5000 },
        ],
        900,
        DEFAULT_THRESHOLDS,
      ),
    ).toBeNull();
  });
});

describe("averageDelay", () => {
  it("averages and tolerates an empty history", () => {
    expect(
      averageDelay([
        { at: 1, delay: 100 },
        { at: 2, delay: 200 },
      ]),
    ).toBe(150);
    expect(averageDelay([])).toBe(0);
  });
});

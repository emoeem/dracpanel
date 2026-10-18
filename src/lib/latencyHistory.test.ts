import { describe, expect, it } from "vitest";

import {
  appendLatencySample,
  LATENCY_HISTORY_LIMIT,
  latencyStats,
} from "./latencyHistory";

describe("appendLatencySample", () => {
  it("ignores non-positive delays and caps the history", () => {
    let history = appendLatencySample([], { at: 1, delay: 0 });
    expect(history).toEqual([]);
    for (let index = 1; index <= LATENCY_HISTORY_LIMIT + 5; index += 1) {
      history = appendLatencySample(history, { at: index, delay: index });
    }
    expect(history).toHaveLength(LATENCY_HISTORY_LIMIT);
    expect(history[history.length - 1].delay).toBe(LATENCY_HISTORY_LIMIT + 5);
  });

  it("replaces a sample with the same timestamp and rejects older samples", () => {
    const history = appendLatencySample([{ at: 2, delay: 100 }], { at: 2, delay: 120 });
    expect(history).toEqual([{ at: 2, delay: 120 }]);
    expect(appendLatencySample(history, { at: 1, delay: 80 })).toEqual(history);
  });
});

describe("latencyStats", () => {
  it("computes min, average, max and latest", () => {
    expect(
      latencyStats([
        { at: 1, delay: 100 },
        { at: 2, delay: 300 },
        { at: 3, delay: 200 },
      ]),
    ).toEqual({ min: 100, avg: 200, max: 300, latest: 200, count: 3 });
  });

  it("returns null without positive samples", () => {
    expect(latencyStats([])).toBeNull();
    expect(latencyStats([{ at: 1, delay: 0 }])).toBeNull();
  });
});

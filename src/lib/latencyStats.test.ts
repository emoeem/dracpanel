import { describe, expect, it } from "vitest";

import { countWithData, percentile, weightedPercentile } from "./latencyStats";

describe("percentile", () => {
  it("interpolates between neighbours", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([100, 200, 300], 0)).toBe(100);
    expect(percentile([100, 200, 300], 1)).toBe(300);
  });

  it("ignores empty and invalid values", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([0, -1, Number.NaN], 0.5)).toBeNull();
    expect(percentile([0, 50], 0.5)).toBe(50);
  });
});

describe("weightedPercentile", () => {
  it("weights by connection count", () => {
    // 90ms x1, 300ms x9 → weighted P50 sits at 300.
    expect(weightedPercentile([90, 300], [1, 9], 0.5)).toBe(300);
  });

  it("ignores zero weights", () => {
    expect(weightedPercentile([100, 200], [1, 0], 0.9)).toBe(100);
  });

  it("returns null without data", () => {
    expect(weightedPercentile([], [], 0.5)).toBeNull();
    expect(weightedPercentile([100], [0], 0.5)).toBeNull();
  });
});

describe("countWithData", () => {
  it("counts positive finite values", () => {
    expect(countWithData([0, 1, Number.NaN, 20])).toBe(2);
  });
});

import { describe, expect, it } from "vitest";

import { buildOffsets, findRowIndex, sliceWindow, totalHeight, windowRange } from "./virtualWindow";

describe("buildOffsets", () => {
  it("prefixes the heights and exposes the total", () => {
    const offsets = buildOffsets([10, 20, 30]);
    expect(offsets).toEqual([0, 10, 30, 60]);
    expect(totalHeight(offsets)).toBe(60);
  });

  it("handles an empty list", () => {
    expect(buildOffsets([])).toEqual([0]);
    expect(totalHeight([])).toBe(0);
  });
});

describe("findRowIndex", () => {
  const offsets = buildOffsets([10, 20, 30, 40]);

  it("finds the row containing an offset", () => {
    expect(findRowIndex(offsets, 0)).toBe(0);
    expect(findRowIndex(offsets, 9)).toBe(0);
    expect(findRowIndex(offsets, 10)).toBe(1);
    expect(findRowIndex(offsets, 29)).toBe(1);
    expect(findRowIndex(offsets, 30)).toBe(2);
    expect(findRowIndex(offsets, 59)).toBe(2);
  });

  it("clamps to the last row", () => {
    expect(findRowIndex(offsets, 60)).toBe(3);
    expect(findRowIndex(offsets, 9999)).toBe(3);
    expect(findRowIndex(offsets, -5)).toBe(0);
  });

  it("degrades gracefully for an empty list", () => {
    expect(findRowIndex([0], 50)).toBe(0);
  });
});

describe("windowRange", () => {
  const offsets = buildOffsets(new Array(100).fill(20));

  it("covers the viewport plus overscan", () => {
    const range = windowRange(offsets, 200, 200, 4);
    expect(range.start).toBe(6);
    expect(range.end).toBe(25);
  });

  it("never goes out of bounds at the ends", () => {
    expect(windowRange(offsets, 0, 200, 8)).toEqual({ start: 0, end: 19 });
    expect(windowRange(offsets, 1800, 200, 8)).toEqual({ start: 82, end: 100 });
  });

  it("returns an empty range for an empty list", () => {
    expect(windowRange([0], 0, 100, 4)).toEqual({ start: 0, end: 0 });
  });
});

describe("sliceWindow", () => {
  it("reports top and height for each visible row", () => {
    const items = ["a", "b", "c", "d"];
    const offsets = buildOffsets([10, 10, 10, 10]);
    const rows = sliceWindow(items, offsets, { start: 1, end: 3 });
    expect(rows).toEqual([
      { item: "b", index: 1, top: 10, height: 10 },
      { item: "c", index: 2, top: 20, height: 10 },
    ]);
  });

  it("skips holes left by a shrinking list", () => {
    const offsets = buildOffsets([10, 10]);
    expect(sliceWindow(["a"], offsets, { start: 0, end: 2 })).toHaveLength(1);
  });
});

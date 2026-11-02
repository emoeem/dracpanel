import { describe, expect, it } from "vitest";

import {
  DASHBOARD_GRID_COLUMNS,
  WIDGET_DEFS,
  WIDGET_IDS,
  clampRows,
  clampSpan,
  defaultLayout,
  effectiveSpan,
  findPlacement,
  hiddenCount,
  movePlacement,
  normalizeLayout,
  updatePlacement,
  visiblePlacements,
  widgetDef,
} from "./widgets";

describe("widget registry", () => {
  it("defines every widget exactly once with sane constraints", () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length);
    expect(WIDGET_IDS.length).toBe(WIDGET_DEFS.length);
    for (const def of WIDGET_DEFS) {
      expect(def.defaultSpan).toBeGreaterThanOrEqual(def.minSpan);
      expect(def.defaultSpan).toBeLessThanOrEqual(def.maxSpan);
      expect(def.maxSpan).toBeLessThanOrEqual(DASHBOARD_GRID_COLUMNS);
      expect(def.minSpan).toBeGreaterThanOrEqual(1);
      expect(def.minRows).toBeLessThanOrEqual(def.maxRows);
    }
  });

  it("default layout is the registry order with every widget visible", () => {
    const layout = defaultLayout();
    expect(layout.placements.map((placement) => placement.id)).toEqual(WIDGET_IDS);
    expect(layout.placements.every((placement) => placement.visible)).toBe(true);
  });
});

describe("normalizeLayout", () => {
  it("drops unknown ids and duplicates, keeps stored order, appends new widgets", () => {
    const stored = {
      version: 1,
      placements: [
        { id: "traffic", visible: false, span: 1, rows: 1 },
        { id: "removed-in-a-later-release", visible: true, span: 2, rows: 2 },
        { id: "traffic", visible: true, span: 3, rows: 2 },
        { id: "status", visible: true, span: 9, rows: 9 },
      ],
    };
    const layout = normalizeLayout(stored);
    expect(layout.placements).toHaveLength(WIDGET_IDS.length);
    expect(layout.placements.slice(0, 2).map((placement) => placement.id)).toEqual([
      "traffic",
      "status",
    ]);
    expect(new Set(layout.placements.map((placement) => placement.id)).size).toBe(WIDGET_IDS.length);
    const traffic = findPlacement(layout, "traffic");
    expect(traffic).toMatchObject({ visible: false, span: 1, rows: 1 });
    // Clamped to the status widget's max span/rows (4 / 3).
    expect(findPlacement(layout, "status")).toMatchObject({ span: 4, rows: 3 });
  });

  it("survives garbage instead of throwing", () => {
    for (const raw of [null, undefined, 42, "nope", { placements: "x" }, { placements: [null, 3] }]) {
      const layout = normalizeLayout(raw);
      expect(layout.placements).toHaveLength(WIDGET_IDS.length);
    }
  });

  it("treats a missing visible flag as visible and preserves rows=0 (auto)", () => {
    const layout = normalizeLayout({
      placements: [{ id: "cpu", span: 1, rows: 0 }],
    });
    expect(findPlacement(layout, "cpu")).toMatchObject({ visible: true, rows: 0 });
  });
});

describe("placement edits", () => {
  it("moves a widget and refuses to leave the list", () => {
    const layout = defaultLayout();
    const moved = movePlacement(layout, WIDGET_IDS[2], -1);
    expect(moved.placements[1].id).toBe(WIDGET_IDS[2]);
    expect(movePlacement(layout, WIDGET_IDS[0], -1)).toBe(layout);
    expect(movePlacement(layout, WIDGET_IDS[WIDGET_IDS.length - 1], 1)).toBe(layout);
    expect(movePlacement(layout, "missing", 1)).toBe(layout);
  });

  it("moves past hidden neighbours instead of swapping with them", () => {
    let layout = defaultLayout();
    const [first, second, third] = visiblePlacements(layout).map((placement) => placement.id);
    layout = updatePlacement(layout, second, { visible: false });
    const moved = movePlacement(layout, third, -1);
    // The visible order swaps first <-> third; the hidden widget keeps its slot.
    expect(visiblePlacements(moved).map((placement) => placement.id).slice(0, 2)).toEqual([
      third,
      first,
    ]);
    expect(findPlacement(moved, second)?.visible).toBe(false);
  });

  it("clamps sizes to the widget constraints and keeps auto height at 0", () => {
    const layout = defaultLayout();
    const small = updatePlacement(layout, "status", { span: 99, rows: 99 });
    expect(findPlacement(small, "status")).toMatchObject({ span: 4, rows: 3 });
    const auto = updatePlacement(layout, "status", { rows: 0 });
    expect(findPlacement(auto, "status")?.rows).toBe(0);
    const tiny = updatePlacement(layout, "cpu", { span: 0 });
    expect(findPlacement(tiny, "cpu")?.span).toBe(1);
  });

  it("ignores unknown widgets", () => {
    const layout = defaultLayout();
    expect(updatePlacement(layout, "nope", { visible: false })).toBe(layout);
  });
});

describe("grid helpers", () => {
  it("clamps the span to the breakpoint column count", () => {
    const layout = defaultLayout();
    const status = findPlacement(layout, "status");
    expect(status).not.toBeNull();
    if (status === null) {
      return;
    }
    expect(effectiveSpan(status, 4)).toBe(2);
    expect(effectiveSpan(status, 2)).toBe(2);
    expect(effectiveSpan({ ...status, span: 4 }, 2)).toBe(2);
    expect(effectiveSpan({ ...status, span: 4 }, 1)).toBe(1);
  });

  it("counts hidden widgets and filters them out of the visible list", () => {
    const layout = updatePlacement(defaultLayout(), "cpu", { visible: false });
    expect(hiddenCount(layout)).toBe(1);
    expect(visiblePlacements(layout).some((placement) => placement.id === "cpu")).toBe(false);
  });

  it("clamp helpers fall back to defaults for non-finite input", () => {
    const def = widgetDef("traffic");
    expect(def).not.toBeNull();
    if (def === null) {
      return;
    }
    expect(clampSpan(def, Number.NaN)).toBe(def.defaultSpan);
    expect(clampRows(def, Number.NaN)).toBe(def.defaultRows);
  });
});

import { describe, expect, it } from "vitest";

import { dashboardLayout } from "./layout";

describe("dashboardLayout", () => {
  it("uses one mobile column under 640", () => {
    const layout = dashboardLayout(390, 844);
    expect(layout.columns).toBe(1);
    expect(layout.showTables).toBe(false);
    expect(layout.gap).toBe(8);
  });

  it("uses two columns between 640 and 860", () => {
    expect(dashboardLayout(760, 900).columns).toBe(2);
    expect(dashboardLayout(760, 900).gap).toBe(12);
    expect(dashboardLayout(820, 900).gap).toBe(16);
  });

  it("uses four columns from 860 with compact for tight windows", () => {
    const roomy = dashboardLayout(1280, 900);
    expect(roomy.columns).toBe(4);
    expect(roomy.compact).toBe(false);
    expect(roomy.showTables).toBe(true);

    const compactWidth = dashboardLayout(900, 900);
    expect(compactWidth.compact).toBe(true);

    const compactHeight = dashboardLayout(1280, 700);
    expect(compactHeight.compact).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { modeForSegment, OUTBOUND_MODES, segmentOfMode } from "./mode";

describe("segmentOfMode", () => {
  it("maps canonical sing-box modes", () => {
    expect(segmentOfMode("Rule")).toBe("rule");
    expect(segmentOfMode("Global")).toBe("global");
    expect(segmentOfMode("Direct")).toBe("direct");
  });

  it("is case-insensitive and locale aware", () => {
    expect(segmentOfMode("GLOBAL")).toBe("global");
    expect(segmentOfMode("直连")).toBe("direct");
    expect(segmentOfMode("规则")).toBe("rule");
  });

  it("maps unknown custom modes to rule", () => {
    expect(segmentOfMode("Proxy")).toBe("rule");
    expect(segmentOfMode("RuleAllowAds")).toBe("rule");
    expect(segmentOfMode(null)).toBe("rule");
    expect(segmentOfMode(undefined)).toBe("rule");
  });
});

describe("modeForSegment", () => {
  it("prefers the exact casing advertised by the core", () => {
    expect(modeForSegment("rule", ["Rule", "Proxy", "Direct"])).toBe("Rule");
    expect(modeForSegment("global", ["Rule", "Global"])).toBe("Global");
  });

  it("falls back to canonical names when absent", () => {
    expect(modeForSegment("global", ["rule"])).toBe("Global");
    expect(modeForSegment("direct", [])).toBe("Direct");
  });

  it("uses the first custom mode for the rule segment", () => {
    expect(modeForSegment("rule", ["Proxy", "RuleAllowAds"])).toBe("Proxy");
  });

  it("exposes the three FlClash segments in order", () => {
    expect(OUTBOUND_MODES.map((mode) => mode.value)).toEqual(["rule", "global", "direct"]);
    expect(OUTBOUND_MODES.map((mode) => mode.label)).toEqual(["规则", "全局", "直连"]);
  });
});

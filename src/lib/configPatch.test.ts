import { describe, expect, it } from "vitest";

import {
  ConfigPatchError,
  patchConfigText,
  patchConfigTextMany,
  readConfigValue,
} from "./configPatch";

const TEXT = `{
  // route rules
  "route": {
    "rules": [
      { "domain": ["a.com"], "outbound": "direct" } // keep me
    ],
    "final": "Proxy"
  }
}
`;

describe("patchConfigText", () => {
  it("patches a value and keeps comments", () => {
    const next = patchConfigText(TEXT, ["route", "final"], "direct");
    expect(next).toContain("// route rules");
    expect(next).toContain("// keep me");
    expect(readConfigValue(next, ["route", "final"], null)).toBe("direct");
  });

  it("patches nested array entries", () => {
    const next = patchConfigText(TEXT, ["route", "rules", 0, "outbound"], "Proxy");
    expect(readConfigValue(next, ["route", "rules", 0, "outbound"], null)).toBe("Proxy");
    expect(next).toContain("// keep me");
  });

  it("inserts a missing section", () => {
    const next = patchConfigText(TEXT, ["dns", "servers"], [{ type: "https", tag: "cf", server: "1.1.1.1" }]);
    const servers = readConfigValue<{ tag: string }[]>(next, ["dns", "servers"], []);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.tag).toBe("cf");
  });

  it("rejects unparseable text", () => {
    expect(() => patchConfigText("{ bad", ["route"], 1)).toThrow(ConfigPatchError);
  });
});

describe("patchConfigTextMany", () => {
  it("applies patches in order", () => {
    const next = patchConfigTextMany(TEXT, [
      { path: ["route", "final"], value: "direct" },
      { path: ["route", "rules", 0, "domain"], value: ["b.com"] },
    ]);
    expect(readConfigValue(next, ["route", "final"], null)).toBe("direct");
    expect(readConfigValue(next, ["route", "rules", 0, "domain"], [])).toEqual(["b.com"]);
    expect(next).toContain("// route rules");
  });
});

describe("readConfigValue", () => {
  it("returns the fallback for missing paths", () => {
    expect(readConfigValue(TEXT, ["dns", "servers"], "missing")).toBe("missing");
  });

  it("returns the fallback for invalid text", () => {
    expect(readConfigValue("{ nope", ["a"], 42)).toBe(42);
  });
});

import { describe, expect, it } from "vitest";

import {
  draftIssue,
  draftToRule,
  emptyDraft,
  ruleToDraft,
  ruleValueToText,
  textToRuleValue,
  type RuleDraft,
} from "./ruleEditor";

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return { ...emptyDraft(), ...overrides };
}

describe("ruleValueToText", () => {
  it("joins arrays with commas", () => {
    expect(ruleValueToText(["a", "b"])).toBe("a, b");
  });

  it("keeps objects as JSON", () => {
    expect(ruleValueToText({ a: 1 })).toBe('{"a":1}');
  });

  it("stringifies scalars", () => {
    expect(ruleValueToText(80)).toBe("80");
    expect(ruleValueToText(true)).toBe("true");
  });
});

describe("ruleToDraft", () => {
  it("reads the action, outbound and matchers", () => {
    const result = ruleToDraft({
      action: "route",
      outbound: "proxy",
      domain_suffix: ["example.com", "example.org"],
    });
    expect(result.action).toBe("route");
    expect(result.target).toBe("proxy");
    expect(result.matchers).toEqual([{ key: "domain_suffix", value: "example.com, example.org" }]);
  });

  it("reads a DNS rule target from server", () => {
    expect(ruleToDraft({ action: "route", server: "local" }).target).toBe("local");
  });

  it("treats an outbound-only rule as a route rule", () => {
    expect(ruleToDraft({ outbound: "direct" }).action).toBe("route");
  });

  it("picks up invert", () => {
    expect(ruleToDraft({ invert: true, outbound: "direct" }).invert).toBe(true);
  });

  it("offers an empty matcher when the rule has none", () => {
    expect(ruleToDraft({ outbound: "block" }).matchers).toEqual([{ key: "domain_suffix", value: "" }]);
  });
});

describe("draftToRule", () => {
  it("writes outbound for route rules", () => {
    expect(
      draftToRule(draft({ action: "route", target: "proxy", matchers: [{ key: "geosite", value: "cn" }] }), "outbound"),
    ).toEqual({ action: "route", outbound: "proxy", geosite: "cn" });
  });

  it("writes server for DNS rules", () => {
    expect(draftToRule(draft({ target: "local" }), "server")).toEqual({
      action: "route",
      server: "local",
    });
  });

  it("splits a multi-value matcher into an array", () => {
    const rule = draftToRule(draft({ matchers: [{ key: "domain_suffix", value: "a.com, b.com" }] }), "outbound");
    expect(rule.domain_suffix).toEqual(["a.com", "b.com"]);
  });

  it("collapses a single multi-value matcher back to a scalar", () => {
    const rule = draftToRule(draft({ matchers: [{ key: "domain", value: "a.com" }] }), "outbound");
    expect(rule.domain).toBe("a.com");
  });

  it("stores numeric matchers as numbers", () => {
    expect(draftToRule(draft({ matchers: [{ key: "port", value: "443" }] }), "outbound").port).toBe(443);
    expect(draftToRule(draft({ matchers: [{ key: "port", value: "80,443" }] }), "outbound").port).toEqual([80, 443]);
  });

  it("leaves a non-numeric numeric matcher as text", () => {
    expect(draftToRule(draft({ matchers: [{ key: "port", value: "1000:2000" }] }), "outbound").port).toBe("1000:2000");
  });

  it("drops empty and reserved matcher rows", () => {
    const rule = draftToRule(
      draft({
        target: "proxy",
        matchers: [
          { key: "domain", value: "  " },
          { key: "", value: "x" },
          { key: "action", value: "reject" },
        ],
      }),
      "outbound",
    );
    expect(rule).toEqual({ action: "route", outbound: "proxy" });
  });

  it("emits invert only when set", () => {
    expect(draftToRule(draft({ invert: true }), "outbound").invert).toBe(true);
    expect("invert" in draftToRule(draft({ invert: false }), "outbound")).toBe(false);
  });

  it("round-trips through the draft", () => {
    const original = { action: "reject", domain_keyword: ["ads", "track"], invert: true };
    expect(draftToRule(ruleToDraft(original), "outbound")).toEqual(original);
  });
});

describe("textToRuleValue", () => {
  it("returns null for blank input", () => {
    expect(textToRuleValue("   ", undefined)).toBeNull();
  });

  it("reads a flag as a boolean", () => {
    expect(textToRuleValue("true", { key: "ip_is_private", flag: true })).toBe(true);
    expect(textToRuleValue("no", { key: "ip_is_private", flag: true })).toBe(false);
  });
});

describe("draftIssue", () => {
  it("requires a target for the route action", () => {
    expect(draftIssue(draft({ action: "route", target: "  " }))).toBe("The route action needs an outbound tag");
  });

  it("accepts a route rule with a target", () => {
    expect(draftIssue(draft({ action: "route", target: "proxy" }))).toBeNull();
  });

  it("accepts a catch-all rule without matchers", () => {
    expect(draftIssue(draft({ action: "reject", matchers: [] }))).toBeNull();
  });
});

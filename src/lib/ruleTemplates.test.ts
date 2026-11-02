import { describe, expect, it } from "vitest";

import { RULE_TEMPLATES, resolveTemplateRule } from "./ruleTemplates";

describe("RULE_TEMPLATES", () => {
  it("ships a non-empty static suffix list or a fixed rule for every template", () => {
    for (const template of RULE_TEMPLATES) {
      const covered =
        template.domainSuffixes.length > 0 || template.staticRule !== undefined;
      expect(covered, template.id).toBe(true);
      expect(template.nameKey, template.id).not.toBe("");
      expect(template.descriptionKey, template.id).not.toBe("");
    }
  });

  it("reject templates never depend on the outbound target", () => {
    for (const template of RULE_TEMPLATES) {
      if (template.action === "reject") {
        expect(["ads", "block-quic"], template.id).toContain(template.id);
      }
    }
  });
});

describe("resolveTemplateRule", () => {
  it("references every available preferred rule_set", () => {
    const template = RULE_TEMPLATES.find((entry) => entry.id === "streaming")!;
    const rule = resolveTemplateRule(template, "Proxy", [
      "geosite-cn",
      "geosite-netflix",
      "geosite-youtube",
    ]);
    expect(rule).toEqual({
      action: "route",
      outbound: "Proxy",
      rule_set: ["geosite-youtube", "geosite-netflix"],
    });
  });

  it("falls back to static suffixes when no rule_set exists", () => {
    const template = RULE_TEMPLATES.find((entry) => entry.id === "ai")!;
    const rule = resolveTemplateRule(template, "Proxy", []);
    expect(rule.action).toBe("route");
    expect(rule.outbound).toBe("Proxy");
    expect(rule.domain_suffix).toEqual(template.domainSuffixes);
  });

  it("omits the outbound on reject templates", () => {
    const template = RULE_TEMPLATES.find((entry) => entry.id === "ads")!;
    const rule = resolveTemplateRule(template, "Proxy", []);
    expect(rule).toEqual({ action: "reject", domain_suffix: template.domainSuffixes });
  });

  it("keeps the outbound out when no target is given", () => {
    const template = RULE_TEMPLATES.find((entry) => entry.id === "ai")!;
    const rule = resolveTemplateRule(template, "", []);
    expect(rule).toEqual({ action: "route", domain_suffix: template.domainSuffixes });
  });

  it("writes QUIC block and private fallback rules verbatim", () => {
    const quic = resolveTemplateRule(RULE_TEMPLATES.find((entry) => entry.id === "block-quic")!, "Proxy", [
      "geosite-anything",
    ]);
    expect(quic).toEqual({ network: "udp", port: 443, action: "reject" });
    const priv = resolveTemplateRule(
      RULE_TEMPLATES.find((entry) => entry.id === "private-direct")!,
      "Proxy",
      [],
    );
    expect(priv).toEqual({ ip_is_private: true, outbound: "direct" });
  });

  it("copies the static list instead of sharing the array", () => {
    const template = RULE_TEMPLATES.find((entry) => entry.id === "ai")!;
    const rule = resolveTemplateRule(template, "Proxy", []);
    (rule.domain_suffix as string[]).push("mutated");
    expect(template.domainSuffixes.at(-1)).not.toBe("mutated");
  });
});

import { describe, expect, it } from "vitest";

import {
  evalTraceRule,
  isPrivateIp,
  traceRules,
  type TraceInput,
} from "./ruleTrace";

const BASE: TraceInput = { domain: "www.example.com", ip: "93.184.216.34", port: "443", network: "tcp" };

function input(overrides: Partial<TraceInput> = {}): TraceInput {
  return { ...BASE, ...overrides };
}

describe("isPrivateIp", () => {
  it("recognises RFC1918, loopback and link-local IPv4", () => {
    expect(isPrivateIp("192.168.31.30")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("172.16.1.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.1.1")).toBe(true);
  });

  it("rejects public IPv4 and recognises IPv6 loopback/ULA", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd00::5")).toBe(true);
  });
});

describe("evalTraceRule", () => {
  it("matches domain suffixes including the bare suffix", () => {
    expect(
      evalTraceRule({ action: "route", outbound: "direct", domain_suffix: "example.com" }, input()),
    ).toEqual({ verdict: "match" });
    expect(
      evalTraceRule({ domain_suffix: ["example.com"] }, input({ domain: "example.com" })),
    ).toEqual({ verdict: "match" });
  });

  it("does not treat unrelated suffixes as matches", () => {
    expect(
      evalTraceRule({ domain_suffix: "notexample.com" }, input()),
    ).toEqual({ verdict: "no_match" });
  });

  it("supports keyword, exact domain and regex matchers", () => {
    expect(evalTraceRule({ domain_keyword: "exam" }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ domain: "www.example.com" }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ domain_regex: "^www\\." }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ domain_regex: ["^api\\."] }, input())).toEqual({ verdict: "no_match" });
  });

  it("evaluates ip_cidr containment and leaves IPv6 to the kernel", () => {
    expect(evalTraceRule({ ip_cidr: "93.184.216.0/24" }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ ip_cidr: ["10.0.0.0/8"] }, input())).toEqual({ verdict: "no_match" });
    expect(evalTraceRule({ ip_cidr: "2001:db8::/32" }, input())).toEqual({
      verdict: "unknown",
      reason: { key: "ip_cidr cannot be evaluated locally: {value}", params: { value: "2001:db8::/32" } },
    });
  });

  it("evaluates ports, ranges and network", () => {
    expect(evalTraceRule({ port: 443 }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ port: [80, 443] }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ port_range: "1000:2000" }, input())).toEqual({ verdict: "no_match" });
    expect(evalTraceRule({ port_range: "443:443" }, input())).toEqual({ verdict: "match" });
    expect(evalTraceRule({ network: "udp" }, input())).toEqual({ verdict: "no_match" });
    expect(evalTraceRule({ network: ["tcp", "udp"] }, input())).toEqual({ verdict: "match" });
  });

  it("treats geoip private as decidable and other geoip values as kernel-only", () => {
    expect(evalTraceRule({ geoip: "private" }, input({ ip: "192.168.1.2" }))).toEqual({
      verdict: "match",
    });
    expect(evalTraceRule({ geoip: ["cn"] }, input())).toEqual({
      verdict: "unknown",
      reason: { key: "The geoip database is evaluated by the core only" },
    });
  });

  it("reports undecidable rules when required input is missing", () => {
    expect(evalTraceRule({ domain_suffix: "example.com" }, input({ domain: "" }))).toEqual({
      verdict: "unknown",
      reason: { key: "No domain given, so domain matchers cannot be evaluated" },
    });
    expect(evalTraceRule({ ip_cidr: "10.0.0.0/8" }, input({ ip: "" }))).toEqual({
      verdict: "unknown",
      reason: { key: "No target IP given, so ip_cidr cannot be evaluated" },
    });
  });

  it("stops at matchers only the kernel can decide", () => {
    expect(evalTraceRule({ rule_set: ["geosite-openai"] }, input())).toEqual({
      verdict: "unknown",
      reason: { key: "“{matcher}” is evaluated by the core only", params: { matcher: "rule_set" } },
    });
  });

  it("applies invert after a proven result but not to unknown ones", () => {
    expect(
      evalTraceRule({ domain_suffix: "example.com", invert: true }, input()),
    ).toEqual({ verdict: "no_match" });
    expect(
      evalTraceRule({ domain_suffix: "other.com", invert: true }, input()),
    ).toEqual({ verdict: "match" });
    expect(
      evalTraceRule({ rule_set: ["geosite-x"], invert: true }, input()),
    ).toMatchObject({ verdict: "unknown" });
  });

  it("treats missing matchers as a catch-all", () => {
    expect(evalTraceRule({ action: "reject" }, input())).toEqual({ verdict: "match" });
  });

  it("marks nested logical rules as kernel-only", () => {
    expect(
      evalTraceRule(
        { type: "logical", mode: "and", rules: [{ port: 443 }, { network: "tcp" }] },
        input(),
      ),
    ).toEqual({ verdict: "unknown", reason: { key: "Logical rules (rules[]) are evaluated by the core only" } });
  });
});

describe("traceRules", () => {
  it("returns the first matching rule", () => {
    const rules = [
      { action: "reject", domain_suffix: "ads.example" },
      { action: "route", outbound: "direct", domain_suffix: ["example.com"] },
      { action: "route", outbound: "proxy" },
    ];
    const result = traceRules(rules, input(), "proxy");
    expect(result.outcome).toEqual({
      kind: "rule",
      index: 1,
      action: "route",
      target: "direct",
    });
    expect(result.steps).toEqual([
      { index: 0, verdict: "no_match", reason: null },
      { index: 1, verdict: "match", reason: null },
    ]);
  });

  it("falls back to the final outbound when nothing matches", () => {
    const result = traceRules(
      [{ action: "reject", domain_suffix: "ads.example" }],
      input(),
      "Proxy",
    );
    expect(result.outcome).toEqual({ kind: "final", target: "Proxy" });
  });

  it("stops the walk at the first rule needing the kernel", () => {
    const rules = [
      { action: "route", outbound: "direct", domain_suffix: "www.example.com" },
      { action: "route", outbound: "proxy", rule_set: ["geosite-openai"] },
      { action: "route", outbound: "proxy" },
    ];
    const result = traceRules(rules, input({ domain: "example.com" }), "proxy");
    expect(result.outcome).toEqual({
      kind: "unknown",
      index: 1,
      reason: { key: "“{matcher}” is evaluated by the core only", params: { matcher: "rule_set" } },
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.verdict).toBe("unknown");
  });

  it("reads rules without an action as route rules", () => {
    const result = traceRules(
      [{ outbound: "direct", domain_suffix: "example.com" }],
      input(),
      "proxy",
    );
    expect(result.outcome).toMatchObject({ kind: "rule", action: "route", target: "direct" });
  });
});

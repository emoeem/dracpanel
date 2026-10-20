import { describe, expect, it } from "vitest";

import { RuleHitAccumulator, UNKNOWN_RULE, parseRuleKey, type HitRow } from "./ruleHits";

const T0 = 1_700_000_000_000;

function row(overrides: Partial<HitRow> = {}): HitRow {
  return {
    rule: "3",
    uplinkTotal: 0n,
    downlinkTotal: 0n,
    closedAt: null,
    ...overrides,
  };
}

describe("RuleHitAccumulator", () => {
  it("counts a newly seen connection as one hit", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row()]], T0);
    expect(acc.get("3").hits).toBe(1);
    expect(acc.get("3").active).toBe(1);
  });

  it("does not recount a connection seen again in a later snapshot", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row()]], T0);
    acc.ingest([["a", row({ uplinkTotal: 100n })]], T0 + 1000);
    expect(acc.get("3").hits).toBe(1);
  });

  it("tracks live traffic from open connections", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest(
      [
        ["a", row({ uplinkTotal: 100n, downlinkTotal: 200n })],
        ["b", row({ uplinkTotal: 50n, downlinkTotal: 25n })],
      ],
      T0,
    );
    const stats = acc.get("3");
    expect(stats.liveBytesUp).toBe(150n);
    expect(stats.liveBytesDown).toBe(225n);
  });

  it("keeps buckets separate per rule", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest(
      [
        ["a", row({ rule: "3" })],
        ["b", row({ rule: "7" })],
      ],
      T0,
    );
    expect(acc.get("3").hits).toBe(1);
    expect(acc.get("7").hits).toBe(1);
    expect(acc.totalHits).toBe(2);
  });

  it("files a blank rule under the unknown bucket", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row({ rule: "   " })]], T0);
    expect(acc.get(UNKNOWN_RULE).hits).toBe(1);
  });

  it("settles traffic when a connection disappears from the snapshot", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row({ uplinkTotal: 900n, downlinkTotal: 400n })]], T0);
    acc.ingest([], T0 + 1000);
    const stats = acc.get("3");
    expect(stats.active).toBe(0);
    expect(stats.bytesUp).toBe(900n);
    expect(stats.bytesDown).toBe(400n);
    expect(stats.liveBytesUp).toBe(0n);
  });

  it("zeroes live traffic once the last open connection is gone", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row({ uplinkTotal: 900n })]], T0);
    acc.ingest([["a", row({ uplinkTotal: 900n, closedAt: T0 + 5 })]], T0 + 5);
    expect(acc.get("3").liveBytesUp).toBe(0n);
  });

  it("does not count an already closed connection as a hit", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row({ closedAt: T0 })]], T0);
    expect(acc.get("3").hits).toBe(0);
  });

  it("reports whether anything changed", () => {
    const acc = new RuleHitAccumulator();
    expect(acc.ingest([["a", row()]], T0)).toBe(true);
    expect(acc.ingest([["a", row({ uplinkTotal: 1n })]], T0)).toBe(false);
    expect(acc.ingest([["b", row()]], T0)).toBe(true);
  });

  it("sorts the snapshot by hits, then active", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest(
      [
        ["a", row({ rule: "1" })],
        ["b", row({ rule: "2" })],
        ["c", row({ rule: "2" })],
      ],
      T0,
    );
    expect(acc.snapshot().map((stats) => stats.rule)).toEqual(["2", "1"]);
  });

  it("returns zeroed stats for an unknown rule", () => {
    const acc = new RuleHitAccumulator();
    expect(acc.get("42").hits).toBe(0);
    expect(acc.get("42").active).toBe(0);
  });

  it("forgets everything on reset", () => {
    const acc = new RuleHitAccumulator();
    acc.ingest([["a", row()]], T0);
    acc.reset();
    expect(acc.totalHits).toBe(0);
    acc.ingest([["a", row()]], T0);
    expect(acc.get("3").hits).toBe(1);
  });
});

describe("parseRuleKey", () => {
  it("reads the bracketed config position", () => {
    expect(parseRuleKey("route.rules[3]")).toEqual({ section: "route", index: 3 });
    expect(parseRuleKey("dns.rules[0]")).toEqual({ section: "dns", index: 0 });
  });

  it("reads dotted and path style positions", () => {
    expect(parseRuleKey("route.rules.12")).toEqual({ section: "route", index: 12 });
    expect(parseRuleKey("dns/rules/7")).toEqual({ section: "dns", index: 7 });
  });

  it("gives up on descriptive labels and section-less keys", () => {
    expect(parseRuleKey("domain_suffix:example.com")).toBeNull();
    expect(parseRuleKey("route.final")).toBeNull();
    expect(parseRuleKey("")).toBeNull();
  });
});

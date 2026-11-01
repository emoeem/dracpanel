import { describe, expect, it } from "vitest";

import {
  breakdownStatus,
  failureRate,
  groupByUpstream,
  hasLatencyData,
  rankQueries,
  summarizeLatency,
  type DnsQueryRecord,
} from "./dnsStats";

function record(overrides: Partial<DnsQueryRecord> = {}): DnsQueryRecord {
  return {
    at: 1_700_000_000_000,
    domain: "example.com",
    type: "A",
    client: "192.168.1.5:5555",
    upstream: "tls://1.1.1.1",
    status: "ok",
    elapsedMs: 20,
    ...overrides,
  };
}

describe("summarizeLatency", () => {
  it("computes median and p95 over timed records only", () => {
    const summary = summarizeLatency([
      record({ elapsedMs: 10 }),
      record({ elapsedMs: 20 }),
      record({ elapsedMs: 30 }),
      record({ elapsedMs: 0 }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.median).toBe(20);
    expect(summary.p95).toBeGreaterThanOrEqual(29);
  });

  it("returns nulls when nothing was timed", () => {
    expect(summarizeLatency([record({ elapsedMs: 0 })])).toEqual({
      count: 0,
      median: null,
      p95: null,
    });
  });
});

describe("breakdownStatus", () => {
  it("splits answered / nxdomain / failed and estimates cache hits", () => {
    const breakdown = breakdownStatus([
      record(),
      record({ upstream: "https://dns.google" }),
      record({ status: "nxdomain" }),
      record({ status: "failed" }),
      record({ upstream: "" }),
    ]);
    expect(breakdown.answered).toBe(2);
    expect(breakdown.nxdomain).toBe(1);
    expect(breakdown.failed).toBe(1);
    expect(breakdown.cacheHit).toBe(1);
    expect(breakdown.total).toBe(5);
    expect(breakdown.cacheRate).toBeCloseTo(20);
  });

  it("reports null rates for an empty list", () => {
    const breakdown = breakdownStatus([]);
    expect(breakdown.cacheRate).toBeNull();
    expect(failureRate(breakdown)).toBeNull();
  });
});

describe("groupByUpstream", () => {
  it("groups records per upstream with medians and caps points", () => {
    const records = [
      record({ upstream: "tls://1.1.1.1", elapsedMs: 10 }),
      record({ upstream: "tls://1.1.1.1", elapsedMs: 30 }),
      record({ upstream: "https://dns.google", elapsedMs: 100 }),
      record({ upstream: "" }),
    ];
    const groups = groupByUpstream(records, 1);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ upstream: "tls://1.1.1.1", count: 2, median: 20 });
    expect(groups[0]?.points).toHaveLength(1);
    expect(groups[1]).toMatchObject({ upstream: "https://dns.google", count: 1 });
  });
});

describe("rankQueries", () => {
  it("ranks domains and clients by count", () => {
    const records = [
      record({ domain: "a.com" }),
      record({ domain: "a.com" }),
      record({ domain: "b.com", client: "10.0.0.2:1" }),
    ];
    expect(rankQueries(records, "domain", 5)).toEqual([
      { key: "a.com", count: 2 },
      { key: "b.com", count: 1 },
    ]);
    expect(rankQueries(records, "client", 5)[0]).toEqual({ key: "192.168.1.5:5555", count: 2 });
  });
});

describe("hasLatencyData", () => {
  it("distinguishes missing timings from missing records", () => {
    expect(hasLatencyData([])).toBe(false);
    expect(hasLatencyData([record({ elapsedMs: 0 })])).toBe(false);
    expect(hasLatencyData([record({ elapsedMs: 5 })])).toBe(true);
  });
});

/**
 * Aggregations behind the DNS statistics tab.
 *
 * sing-box exposes no DNS statistics endpoint, so every figure here is derived
 * from the per-query records the journal carries at log.level=debug. Two
 * honest caveats are encoded in the types rather than hidden:
 *   - the "cache hit" figure is an *estimate* (a repeated domain+type that the
 *     upstream list does not attribute to a server);
 *   - when no records exist the page shows the empty note instead of zeros.
 */

import { percentile } from "./latencyStats";

export type DnsStatus = "ok" | "nxdomain" | "failed";

export interface DnsQueryRecord {
  at: number;
  domain: string;
  type?: string;
  client?: string;
  upstream?: string;
  status: string;
  elapsedMs?: number;
}

export interface DnsLatencySummary {
  count: number;
  median: number | null;
  p95: number | null;
}

export interface DnsStatusBreakdown {
  cacheHit: number;
  answered: number;
  nxdomain: number;
  failed: number;
  total: number;
  /** cacheHit / total, in percent; null when total is zero. */
  cacheRate: number | null;
}

export interface DnsUpstreamLatency {
  upstream: string;
  count: number;
  median: number | null;
  points: { at: number; elapsedMs: number; status: DnsStatus }[];
}

export interface DnsRanking {
  key: string;
  count: number;
}

function normalizeStatus(status: string): DnsStatus {
  const lower = status.toLowerCase();
  if (lower === "nxdomain") {
    return "nxdomain";
  }
  if (lower === "failed" || lower === "fail" || lower === "error") {
    return "failed";
  }
  return "ok";
}

/** Latency figures over every record that carries an elapsed time. */
export function summarizeLatency(records: readonly DnsQueryRecord[]): DnsLatencySummary {
  const values = records
    .map((record) => record.elapsedMs ?? 0)
    .filter((value) => value > 0);
  if (values.length === 0) {
    return { count: 0, median: null, p95: null };
  }
  return {
    count: values.length,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

/**
 * Response mix. `cacheHit` is an estimate: records with no upstream and no
 * failure are treated as cache answers, which is the only signal the journal
 * gives us. It is surfaced in the UI as 「估算」.
 */
export function breakdownStatus(records: readonly DnsQueryRecord[]): DnsStatusBreakdown {
  let answered = 0;
  let nxdomain = 0;
  let failed = 0;
  let cacheHit = 0;
  for (const record of records) {
    const status = normalizeStatus(record.status);
    if (status === "nxdomain") {
      nxdomain += 1;
      continue;
    }
    if (status === "failed") {
      failed += 1;
      continue;
    }
    if ((record.upstream ?? "").trim() === "") {
      cacheHit += 1;
    } else {
      answered += 1;
    }
  }
  const total = records.length;
  return {
    cacheHit,
    answered,
    nxdomain,
    failed,
    total,
    cacheRate: total === 0 ? null : (cacheHit / total) * 100,
  };
}

/** Failure rate in percent (failed / total), null with no records. */
export function failureRate(breakdown: DnsStatusBreakdown): number | null {
  if (breakdown.total === 0) {
    return null;
  }
  return (breakdown.failed / breakdown.total) * 100;
}

/** One row per upstream, newest-last points capped for the strip chart. */
export function groupByUpstream(
  records: readonly DnsQueryRecord[],
  pointLimit = 120,
): DnsUpstreamLatency[] {
  const map = new Map<string, DnsUpstreamLatency>();
  for (const record of records) {
    const upstream = (record.upstream ?? "").trim();
    if (upstream === "") {
      continue;
    }
    const entry = map.get(upstream) ?? { upstream, count: 0, median: null, points: [] };
    entry.count += 1;
    const elapsed = record.elapsedMs ?? 0;
    if (elapsed > 0) {
      entry.points.push({ at: record.at, elapsedMs: elapsed, status: normalizeStatus(record.status) });
    }
    map.set(upstream, entry);
  }
  const result = [...map.values()];
  for (const entry of result) {
    const values = entry.points.map((point) => point.elapsedMs);
    entry.median = values.length > 0 ? percentile(values, 0.5) : null;
    if (entry.points.length > pointLimit) {
      entry.points = entry.points.slice(entry.points.length - pointLimit);
    }
  }
  return result.sort((left, right) => right.count - left.count || left.upstream.localeCompare(right.upstream));
}

/** Top domains or clients by query count. */
export function rankQueries(
  records: readonly DnsQueryRecord[],
  key: "domain" | "client",
  limit = 10,
): DnsRanking[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = (key === "domain" ? record.domain : (record.client ?? "")).trim();
    if (value === "") {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([entry, count]) => ({ key: entry, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, limit);
}

/** Distinguishes "no records at all" from "records without timings". */
export function hasLatencyData(records: readonly DnsQueryRecord[]): boolean {
  return records.some((record) => (record.elapsedMs ?? 0) > 0);
}

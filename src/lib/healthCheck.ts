/**
 * Health classification for periodic node probing.
 *
 * The daemon reports one latency number per node; turning that into "is this
 * node usable?" needs thresholds the user owns, plus a notion of staleness so a
 * node that stopped answering is not reported as healthy just because we still
 * remember an old good sample.
 */

import { latencyStats, type LatencySample } from "./latencyHistory";

export type { LatencySample };

export type HealthStatus = "unknown" | "healthy" | "degraded" | "down";

export interface HealthThresholds {
  /** Latency at or above this is slow but usable. */
  degradedMs: number;
  /** Latency at or above this (or a failed probe) counts as unusable. */
  downMs: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = { degradedMs: 300, downMs: 1000 };

/** Samples older than this say nothing about the node's current state. */
export const HEALTH_STALE_MS = 30 * 60_000;

export interface HealthVerdict {
  status: HealthStatus;
  /** Latest measured delay in ms, 0 when never measured. */
  delay: number;
  at: number;
}

export function classifyDelay(delay: number, thresholds: HealthThresholds): HealthStatus {
  if (!Number.isFinite(delay) || delay <= 0) {
    return "down";
  }
  if (delay >= thresholds.downMs) {
    return "down";
  }
  if (delay >= thresholds.degradedMs) {
    return "degraded";
  }
  return "healthy";
}

export function healthOf(
  samples: readonly LatencySample[],
  thresholds: HealthThresholds,
  now = Date.now(),
): HealthVerdict {
  const last = samples[samples.length - 1];
  if (last === undefined) {
    return { status: "unknown", delay: 0, at: 0 };
  }
  if (now - last.at > HEALTH_STALE_MS) {
    return { status: "unknown", delay: last.delay, at: last.at };
  }
  return { status: classifyDelay(last.delay, thresholds), delay: last.delay, at: last.at };
}

export interface HealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
}

export function summarizeHealth(statuses: Iterable<HealthStatus>): HealthSummary {
  const summary: HealthSummary = { total: 0, healthy: 0, degraded: 0, down: 0, unknown: 0 };
  for (const status of statuses) {
    summary.total++;
    summary[status]++;
  }
  return summary;
}

/** True when a node just became unusable and the user should hear about it. */
export function isNewOutage(before: HealthStatus, after: HealthStatus): boolean {
  return after === "down" && before !== "down";
}

export function isRecovered(before: HealthStatus, after: HealthStatus): boolean {
  return before === "down" && after === "healthy";
}

export function isDue(lastAt: number | undefined, now: number, intervalMs: number): boolean {
  if (intervalMs <= 0) {
    return false;
  }
  if (lastAt === undefined || !Number.isFinite(lastAt)) {
    return true;
  }
  return now - lastAt >= intervalMs;
}

/** Milliseconds until the next probe is due; never negative. */
export function nextDueIn(lastAt: number | undefined, now: number, intervalMs: number): number {
  if (intervalMs <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (lastAt === undefined || !Number.isFinite(lastAt)) {
    return 0;
  }
  return Math.max(0, intervalMs - (now - lastAt));
}

export interface Candidate {
  tag: string;
  delay: number;
}

/**
 * Picks the node a failing group should fall over to: the lowest recent average
 * among nodes that are currently usable. Returns null when nothing is better.
 */
export function bestCandidate(
  candidates: readonly Candidate[],
  currentDelay: number,
  thresholds: HealthThresholds,
): string | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (classifyDelay(candidate.delay, thresholds) === "down") {
      continue;
    }
    if (best === null || candidate.delay < best.delay) {
      best = candidate;
    }
  }
  if (best === null || best.delay >= currentDelay) {
    return null;
  }
  return best.tag;
}

/** Recent average used for ranking, falling back to the latest sample. */
export function averageDelay(samples: readonly LatencySample[]): number {
  const stats = latencyStats(samples);
  return stats === null ? 0 : stats.avg;
}

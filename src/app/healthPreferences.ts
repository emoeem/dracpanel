/**
 * Settings and last-run state for the periodic node health probe.
 *
 * The probe results themselves (per-node latency samples) are persisted by the
 * daemon stream; this module stores the schedule's own bookkeeping so a reload
 * knows when the last sweep happened and which nodes were already reported as
 * down — that is what keeps the panel from re-announcing the same outage.
 */

import { DEFAULT_THRESHOLDS, type HealthStatus, type HealthThresholds } from "../lib/healthCheck";
import { loadStoredJson, saveStoredJson } from "../lib/storage";

export interface HealthSettings {
  /** Toast + webhook when a node stops answering. */
  notify: boolean;
  /** Move a group off a node that is down, onto its fastest usable one. */
  autoSwitch: boolean;
  degradedMs: number;
  downMs: number;
}

export const HEALTH_SETTINGS_KEY = "health-settings";
export const HEALTH_SETTINGS_EVENT = "health-settings-change";
/** Fired by views that want a sweep right now; the monitor owns the schedule. */
export const HEALTH_RUN_NOW_EVENT = "health-run-now";
export const HEALTH_RUN_KEY = "health-run";

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  notify: true,
  autoSwitch: false,
  degradedMs: DEFAULT_THRESHOLDS.degradedMs,
  downMs: DEFAULT_THRESHOLDS.downMs,
};

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/** Tolerates hand-edited storage: anything unreadable falls back to defaults. */
export function normalizeHealthSettings(value: unknown): HealthSettings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_HEALTH_SETTINGS;
  }
  const record = value as Partial<Record<keyof HealthSettings, unknown>>;
  const degradedMs = readNumber(record.degradedMs, DEFAULT_THRESHOLDS.degradedMs, 20, 60_000);
  const downMs = readNumber(record.downMs, DEFAULT_THRESHOLDS.downMs, 50, 600_000);
  return {
    notify: record.notify !== false,
    autoSwitch: record.autoSwitch === true,
    degradedMs,
    downMs: Math.max(downMs, degradedMs + 10),
  };
}

export function loadHealthSettings(): HealthSettings {
  return normalizeHealthSettings(loadStoredJson(HEALTH_SETTINGS_KEY));
}

export function saveHealthSettings(settings: HealthSettings): void {
  const normalized = normalizeHealthSettings(settings);
  saveStoredJson(HEALTH_SETTINGS_KEY, normalized);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HEALTH_SETTINGS_EVENT));
  }
}

export function thresholdsOf(settings: HealthSettings): HealthThresholds {
  return { degradedMs: settings.degradedMs, downMs: settings.downMs };
}

export interface HealthRunState {
  lastRunAt: number;
  statuses: Record<string, HealthStatus>;
}

export const EMPTY_HEALTH_RUN: HealthRunState = { lastRunAt: 0, statuses: {} };

function healthRunKey(serverId: string): string {
  return `${HEALTH_RUN_KEY}:${serverId}`;
}

const HEALTH_STATUSES: HealthStatus[] = ["unknown", "healthy", "degraded", "down"];

export function normalizeHealthRun(value: unknown): HealthRunState {
  if (typeof value !== "object" || value === null) {
    return EMPTY_HEALTH_RUN;
  }
  const record = value as { lastRunAt?: unknown; statuses?: unknown };
  const lastRunAt =
    typeof record.lastRunAt === "number" && Number.isFinite(record.lastRunAt) ? record.lastRunAt : 0;
  const statuses: Record<string, HealthStatus> = {};
  if (typeof record.statuses === "object" && record.statuses !== null) {
    for (const [tag, status] of Object.entries(record.statuses)) {
      if (HEALTH_STATUSES.includes(status as HealthStatus)) {
        statuses[tag] = status as HealthStatus;
      }
    }
  }
  return { lastRunAt, statuses };
}

export function loadHealthRun(serverId: string): HealthRunState {
  return normalizeHealthRun(loadStoredJson(healthRunKey(serverId)));
}

export function saveHealthRun(serverId: string, state: HealthRunState): void {
  saveStoredJson(healthRunKey(serverId), normalizeHealthRun(state));
}

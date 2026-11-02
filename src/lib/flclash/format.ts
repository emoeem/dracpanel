import type { Translate } from "../../app/i18n";
import { formatBytes, pad2 } from "../../api/format";

export function formatRate(value: number | bigint): string {
  return `${formatBytes(value)}/s`;
}

export function formatPeak(history: readonly number[]): string {
  if (history.length === 0) {
    return "0 B/s";
  }
  return formatRate(Math.max(...history));
}

/** FlClash always renders uptime as HH:MM:SS, even past 99 hours. */
export function formatUptimeClock(startedAtMs: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export interface UsageSummary {
  used: number;
  total: number;
  ratio: number;
  hasTotal: boolean;
}

export function usageSummary(
  upload: number | undefined,
  download: number | undefined,
  total: number | undefined,
): UsageSummary {
  const used = (upload ?? 0) + (download ?? 0);
  const totalValue = typeof total === "number" && total > 0 ? total : 0;
  return {
    used,
    total: totalValue,
    ratio: totalValue > 0 ? Math.min(1.5, used / totalValue) : 0,
    hasTotal: totalValue > 0,
  };
}

export function formatUsagePair(used: number, total: number): string {
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

export function daysUntil(expireSeconds: number | undefined, nowMs: number): number | null {
  if (typeof expireSeconds !== "number" || expireSeconds <= 0) {
    return null;
  }
  return Math.ceil((expireSeconds * 1000 - nowMs) / 86_400_000);
}

/**
 * Expiry as data, not prose: the view renders it through `t()`, so the same
 * number reads "剩余 49 天" in Chinese and "49 days left" elsewhere instead of
 * leaking a hard-coded Chinese sentence into every language.
 */
export function expiryStatus(days: number | null): { expired: boolean; days: number } | null {
  if (days === null) {
    return null;
  }
  return { expired: days <= 0, days };
}

/** Expiry as text, in the reader's language. */
export function formatExpiryDays(days: number | null, t: Translate): string {
  const status = expiryStatus(days);
  if (status === null) {
    return "—";
  }
  return status.expired ? t("Expired") : t("{count} days left", { count: status.days });
}

export function percentLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function rateTone(delayMs: number): "good" | "medium" | "bad" | "neutral" {
  if (delayMs <= 0) {
    return "neutral";
  }
  if (delayMs < 600) {
    return "good";
  }
  return "medium";
}

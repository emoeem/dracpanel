import { loadStoredJson, removeStoredValue, saveStoredJson } from "../storage";
import type { TunInboundPreset } from "./configEdit";

interface StoredTunPreset {
  configPath: string;
  inbound: Record<string, unknown>;
  index: number;
  savedAt: number;
}

function storageKey(serverId: string): string {
  return `tun-preset:${serverId}`;
}

function isStoredTunPreset(value: unknown): value is StoredTunPreset {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<StoredTunPreset>;
  return (
    typeof record.configPath === "string" &&
    typeof record.inbound === "object" &&
    record.inbound !== null &&
    !Array.isArray(record.inbound) &&
    typeof record.index === "number" &&
    typeof record.savedAt === "number"
  );
}

export function loadTunPreset(
  serverId: string,
  configPath: string | null | undefined,
): TunInboundPreset | null {
  const stored = loadStoredJson(storageKey(serverId));
  if (!isStoredTunPreset(stored)) {
    return null;
  }
  if (configPath && stored.configPath !== "" && stored.configPath !== configPath) {
    return null;
  }
  return { inbound: stored.inbound, index: stored.index };
}

export function saveTunPreset(
  serverId: string,
  configPath: string | null | undefined,
  preset: TunInboundPreset,
) {
  saveStoredJson(storageKey(serverId), {
    configPath: configPath ?? "",
    inbound: preset.inbound,
    index: preset.index,
    savedAt: Date.now(),
  } satisfies StoredTunPreset);
}

export function clearTunPreset(serverId: string) {
  removeStoredValue(storageKey(serverId));
}

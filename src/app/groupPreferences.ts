import { loadStoredJson, saveStoredJson } from "../lib/storage";

export type GroupSort = "config" | "name" | "latency";
export type AutoTestInterval = "off" | "5" | "15" | "30";

export const AUTO_TEST_INTERVALS: AutoTestInterval[] = ["off", "5", "15", "30"];
export const AUTO_TEST_EVENT = "group-auto-test-change";

const GROUP_SORT_KEY = "group-sort";
const HIDE_UNAVAILABLE_KEY = "group-hide-unavailable";
const AUTO_TEST_KEY = "group-auto-test";

function autoTestKey(serverId: string): string {
  return `${AUTO_TEST_KEY}:${serverId}`;
}

export function loadGroupSort(): GroupSort {
  const value = loadStoredJson(GROUP_SORT_KEY);
  return value === "name" || value === "latency" ? value : "config";
}

export function saveGroupSort(value: GroupSort): void {
  saveStoredJson(GROUP_SORT_KEY, value);
}

export function loadHideUnavailable(): boolean {
  return loadStoredJson(HIDE_UNAVAILABLE_KEY) === true;
}

export function saveHideUnavailable(value: boolean): void {
  saveStoredJson(HIDE_UNAVAILABLE_KEY, value);
}

export function loadAutoTestInterval(serverId: string): AutoTestInterval {
  const value = loadStoredJson(autoTestKey(serverId));
  return AUTO_TEST_INTERVALS.find((interval) => interval === value) ?? "off";
}

export function saveAutoTestInterval(serverId: string, value: AutoTestInterval): void {
  saveStoredJson(autoTestKey(serverId), value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTO_TEST_EVENT));
  }
}

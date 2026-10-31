import { loadStoredString, saveStoredString } from "../lib/storage";

const OPEN_LOGS_KEY = "open-logs";

/** FlClash's General → 日志开关: shows the Logs page in the nav when on. */
export function openLogsEnabled(): boolean {
  return loadStoredString(OPEN_LOGS_KEY) === "true";
}

export function setOpenLogsEnabled(value: boolean) {
  saveStoredString(OPEN_LOGS_KEY, value ? "true" : "false");
  window.dispatchEvent(new Event("open-logs-changed"));
}

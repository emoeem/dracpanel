/**
 * Outbound notifications for events the user is not looking at.
 *
 * The panel only runs while the tab is open, so there is nothing that can push
 * to a closed browser: the one channel that survives that is a webhook the
 * user owns (Slack/DingTalk/ntfy/…). Delivery is best effort — a failing
 * webhook must never surface as a new error, or `showError` would recurse.
 */

import { isHttpUrl } from "../api/format";
import type { MessageKey } from "../app/translations";
import { loadStoredJson, removeStoredValue, saveStoredJson } from "./storage";

const STORAGE_KEY = "notifier";

export type NotifyEvent = "error" | "service" | "config" | "health";

/** Labels are i18n keys: render them through `t()` at the call site. */
export const NOTIFY_EVENTS: { id: NotifyEvent; label: MessageKey; hint: MessageKey }[] = [
  { id: "error", label: "Panel errors", hint: "Failed requests, expired tokens, and so on" },
  { id: "service", label: "Core fatal errors", hint: "sing-box failed to start or crashed" },
  { id: "config", label: "Config applied", hint: "After the config is written and the core restarts" },
  { id: "health", label: "Node health changes", hint: "A health check found a node down or recovered" },
];

export interface NotifierConfig {
  url: string;
  events: NotifyEvent[];
}

export interface NotifyPayload {
  event: NotifyEvent;
  title: string;
  detail: string;
  at: number;
}

export const EMPTY_NOTIFIER: NotifierConfig = { url: "", events: [] };

function isNotifyEvent(value: unknown): value is NotifyEvent {
  return value === "error" || value === "service" || value === "config" || value === "health";
}

/** Tolerates hand-edited storage: anything unreadable falls back to "off". */
export function normalizeNotifierConfig(value: unknown): NotifierConfig {
  if (typeof value !== "object" || value === null) {
    return EMPTY_NOTIFIER;
  }
  const record = value as { url?: unknown; events?: unknown };
  const url = typeof record.url === "string" && isHttpUrl(record.url.trim()) ? record.url.trim() : "";
  const events = Array.isArray(record.events) ? record.events.filter(isNotifyEvent) : [];
  return { url, events: [...new Set(events)] };
}

export function loadNotifierConfig(): NotifierConfig {
  return normalizeNotifierConfig(loadStoredJson(STORAGE_KEY));
}

export function saveNotifierConfig(config: NotifierConfig): void {
  if (config.url.trim() === "" || config.events.length === 0) {
    removeStoredValue(STORAGE_KEY);
    return;
  }
  saveStoredJson(STORAGE_KEY, normalizeNotifierConfig(config));
}

export function isNotifyEnabled(config: NotifierConfig, event: NotifyEvent): boolean {
  return config.url !== "" && config.events.includes(event);
}

export function notificationBody(payload: NotifyPayload): string {
  return JSON.stringify(payload);
}

type Sender = (url: string, init: RequestInit) => Promise<Response>;

/** Posts one event; returns whether the receiver accepted it. */
export async function sendNotification(
  payload: NotifyPayload,
  config: NotifierConfig,
  send: Sender = (url, init) => fetch(url, init),
  timeoutMs = 5000,
): Promise<boolean> {
  if (!isNotifyEnabled(config, payload.event)) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: notificationBody(payload),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget hook used at the few places that raise notable events. */
export function notify(event: NotifyEvent, title: string, detail = ""): void {
  const config = loadNotifierConfig();
  if (!isNotifyEnabled(config, event)) {
    return;
  }
  void sendNotification({ event, title, detail, at: Date.now() }, config).catch(() => false);
}
